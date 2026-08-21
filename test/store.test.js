import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JobStore } from '../src/store.js';

const job = (id) => ({
  id,
  inputXml: '<score-partwise version="4.0" />',
  formats: ['pdf'],
  constraints: {},
  facts: { partCount: 1 },
  priceUsd: '0.25',
  payment: { status: 'verified_pending_qc', amount_usd: '0.25' },
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

test('committed state is durable without a write-ahead log, which EFS cannot support', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-store-'));
  try {
    const store = new JobStore(dataDirectory);
    store.create(job('11111111-1111-4111-8111-111111111111'), 'durable-key');
    store.savePaymentWallet({
      provider: 'cdp_server_wallet',
      accountName: 'musicwire-x402-receiver',
      address: '0x2855fB60E630d6A9Ebe0beAE1E1d6392F630F86f',
      network: 'eip155:8453',
    });

    assert.equal(
      fs.existsSync(path.join(dataDirectory, 'musicwire.sqlite-wal')),
      false,
      'a -wal sidecar means write-ahead logging is active, which is unsafe on the EFS mount',
    );

    // A replacement task opens the same directory the way a redeployed container does.
    const replacement = new JobStore(dataDirectory);
    assert.notEqual(
      replacement.db.prepare('PRAGMA journal_mode').get().journal_mode.toLowerCase(),
      'wal',
    );
    assert.equal(replacement.db.prepare('PRAGMA synchronous').get().synchronous, 2);
    assert.equal(
      replacement.get('11111111-1111-4111-8111-111111111111').payment.amount_usd,
      '0.25',
    );
    assert.equal(replacement.getPaymentWallet('cdp_server_wallet').network, 'eip155:8453');
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('a job interrupted by task replacement becomes visibly failed_not_charged', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-store-recovery-'));
  try {
    const id = '22222222-2222-4222-8222-222222222222';
    const store = new JobStore(dataDirectory);
    store.create(job(id));
    store.update(id, { state: 'running' });

    const replacement = new JobStore(dataDirectory);
    replacement.recoverInterruptedJobs();
    const recovered = replacement.get(id);

    assert.equal(recovered.state, 'failed_not_charged');
    assert.equal(recovered.error.code, 'render_interrupted');
    assert.equal(recovered.payment.status, 'failed_not_charged');
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('payment proof outlives the idempotency window and is never swept', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-store-retention-'));
  try {
    const store = new JobStore(dataDirectory);
    const longAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    store.saveValidateResult({
      id: '33333333-3333-4333-8333-333333333333',
      idempotencyKey: 'settled-validation-key',
      httpStatus: 200,
      body: { valid: true },
      payment: { status: 'settled', tx_hash: '0xsettled', amount_usd: '0.10' },
      createdAt: longAgo,
    });
    store.claimPaymentAuthorization({
      fingerprint: 'long-past-authorization',
      endpoint: 'validate',
      idempotencyKey: 'settled-validation-key',
      createdAt: longAgo,
    });
    store.create(
      {
        ...job('44444444-4444-4444-8444-444444444444'),
        createdAt: longAgo,
      },
      'expired-render-key',
    );
    store.db
      .prepare('UPDATE idempotency_keys SET created_at = ? WHERE key = ?')
      .run(longAgo, 'expired-render-key');

    // Runs the sweep the way an ordinary later request does.
    store.expireIdempotencyKeys();

    assert.equal(
      store.getValidateResultByKey('settled-validation-key').payment.tx_hash,
      '0xsettled',
    );
    assert.equal(
      store.claimPaymentAuthorization({
        fingerprint: 'long-past-authorization',
        endpoint: 'validate',
        idempotencyKey: 'another-key',
        createdAt: new Date().toISOString(),
      }).claimed,
      false,
    );
    assert.equal(store.get('44444444-4444-4444-8444-444444444444').state, 'queued');

    // Only the replay-protection key ages out, freeing the key for a new render.
    assert.equal(store.getByIdempotencyKey('expired-render-key'), null);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
