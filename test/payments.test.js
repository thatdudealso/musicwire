import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { createApp } from '../src/app.js';
import { CdpX402Gateway, PaymentService, PaymentSettlementError } from '../src/payment.js';
import { JobStore } from '../src/store.js';

const musicxml = fs.readFileSync(
  new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
  'utf8',
);

test('CDP gateway decodes the standard payment-signature header before verification', async () => {
  const requirements = {
    scheme: 'exact',
    network: 'eip155:84532',
    amount: '250000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x1111111111111111111111111111111111111111',
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  };
  const payload = { x402Version: 2, accepted: requirements, payload: { signature: 'test' } };
  const gateway = new CdpX402Gateway({
    config: {
      x402Network: 'eip155:84532',
      x402PaymentTimeoutSeconds: 300,
      publicBaseUrl: '',
    },
    store: {},
    wallet: { address: async () => requirements.payTo },
  });
  gateway.serverPromise = Promise.resolve({
    buildPaymentRequirements: async () => [requirements],
    createPaymentRequiredResponse: async (_requirements, resource) => ({
      x402Version: 2,
      resource,
      accepts: [requirements],
    }),
    findMatchingRequirements: (available, signedPayload) =>
      JSON.stringify(signedPayload) === JSON.stringify(payload) ? available[0] : undefined,
    verifyPayment: async () => ({
      isValid: true,
      payer: '0x2222222222222222222222222222222222222222',
    }),
  });

  const result = await gateway.authorize({
    request: {
      protocol: 'https',
      originalUrl: '/v1/render',
      get: (name) =>
        name.toLowerCase() === 'payment-signature'
          ? encodePaymentSignatureHeader(payload)
          : 'musicwire.test',
    },
    endpoint: 'render',
    priceUsd: '0.25',
    outputSchema: {},
  });

  assert.equal(result.authorized, true);
  assert.deepEqual(result.payment.payment_payload, payload);
  assert.equal(result.payment.status, 'verified_pending_qc');
});

class RecordingGateway {
  constructor(events) {
    this.events = events;
  }

  async authorize({ request, endpoint, priceUsd, outputSchema }) {
    const requirements = {
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amount: usdToAtomic(priceUsd),
      payTo: '0x1111111111111111111111111111111111111111',
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' },
    };
    const paymentRequired = {
      x402Version: 2,
      resource: { url: `https://musicwire.test/v1/${endpoint}`, mimeType: 'application/json' },
      accepts: [requirements],
    };
    if (!request.get('payment-signature'))
      return {
        authorized: false,
        challenge: {
          headers: {
            'payment-required': encodePaymentRequiredHeader(paymentRequired),
            'cache-control': 'no-store',
          },
          body: {
            ...paymentRequired,
            quote: {
              currency: 'USDC',
              price_usd: priceUsd,
              settlement: 'after_qc_pass',
              output_schema: outputSchema,
            },
          },
        },
      };
    this.events.push('verify');
    return {
      authorized: true,
      payment: {
        provider: 'recording_gateway',
        status: 'verified_pending_qc',
        amount_usd: priceUsd,
        amount_atomic: requirements.amount,
        asset: requirements.asset,
        network: requirements.network,
        pay_to: requirements.payTo,
        payer: '0x2222222222222222222222222222222222222222',
        payment_payload: { test: true },
        payment_requirements: requirements,
      },
    };
  }

  async settle(payment) {
    this.events.push('settle');
    const settledAt = new Date().toISOString();
    return {
      ...payment,
      status: 'settled',
      tx_hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      settled_at: settledAt,
      captured_at: settledAt,
      settlement_response: {
        success: true,
        transaction: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        network: payment.network,
        amount: payment.amount_atomic,
      },
    };
  }

  async cancel(payment, reason) {
    this.events.push('cancel');
    return {
      ...payment,
      status: 'failed_not_charged',
      reason,
      tx_hash: null,
      captured_at: null,
      settled_at: null,
    };
  }

  async description() {
    return { provider: 'recording_gateway', network: 'eip155:84532', asset: 'USDC' };
  }
}

test('x402 challenge publishes exact Base Sepolia requirements and failed QC settles nothing', async () => {
  const events = [];
  const { base, close } = await startServer({
    events,
    renderer: {
      render: async () => {
        events.push('render');
        return { ok: false, error: { code: 'audio_silent', message: 'Audio QC found silence.' } };
      },
    },
  });
  try {
    const challenge = await renderRequest(base);
    assert.equal(challenge.status, 402);
    const required = decodePaymentRequiredHeader(challenge.headers.get('payment-required'));
    assert.deepEqual(required.accepts[0], {
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amount: '250000',
      payTo: '0x1111111111111111111111111111111111111111',
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' },
    });
    const challengeBody = await challenge.json();
    assert.deepEqual(challengeBody.quote.output_schema.completed_job_fields, [
      'qc',
      'artifacts',
      'receipt',
    ]);

    const accepted = await renderRequest(base, 'paid-failure');
    assert.equal(accepted.status, 202);
    const job = await waitForJob(base, (await accepted.json()).job_id);
    assert.equal(job.status, 'failed_not_charged');
    assert.equal(job.payment.status, 'failed_not_charged');
    assert.equal(job.receipt.tx_hash, null);
    assert.deepEqual(events, ['verify', 'render', 'cancel']);
  } finally {
    await close();
  }
});

test('successful QC settles once, persists a receipt, and idempotent retries do not double-charge', async () => {
  const events = [];
  const { base, close } = await startServer({
    events,
    renderer: {
      render: async () => {
        events.push('render');
        return {
          ok: true,
          artifacts: [],
          receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
        };
      },
    },
  });
  try {
    const accepted = await renderRequest(base, 'paid-success', 'a-single-render');
    assert.equal(accepted.status, 202);
    const acceptedBody = await accepted.json();
    const replay = await renderRequest(base, 'paid-success', 'a-single-render');
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).job_id, acceptedBody.job_id);

    const response = await fetch(`${base}/v1/jobs/${acceptedBody.job_id}`);
    let job = await response.json();
    while (job.status === 'queued' || job.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const current = await fetch(`${base}/v1/jobs/${acceptedBody.job_id}`);
      job = await current.json();
    }
    assert.equal(job.status, 'completed');
    assert.equal(
      job.receipt.tx_hash,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    assert.equal(job.receipt.amount_usd, '0.25');
    assert.equal(job.receipt.network, 'eip155:84532');
    assert.deepEqual(events, ['verify', 'render', 'settle']);

    const receiptArtifact = job.artifacts.find((artifact) => artifact.name === 'receipt.json');
    const receipt = await (await fetch(`${base}${receiptArtifact.url}`)).json();
    assert.equal(receipt.payment.tx_hash, job.receipt.tx_hash);
    assert.equal(receipt.payment.network, job.receipt.network);
  } finally {
    await close();
  }
});

test('validation uses the same 402 quote and settles only after a valid QC result', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const quote = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml }),
    });
    assert.equal(quote.status, 402);
    assert.equal(
      decodePaymentRequiredHeader(quote.headers.get('payment-required')).accepts[0].amount,
      '100000',
    );

    const paid = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'paid-validation' },
      body: JSON.stringify({ musicxml }),
    });
    const result = await paid.json();
    assert.equal(paid.status, 200);
    assert.equal(
      result.receipt.tx_hash,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    assert.ok(paid.headers.get('payment-response'));
    assert.deepEqual(events, ['verify', 'settle']);
  } finally {
    await close();
  }
});

test('a lost settle response leaves the job completed as settlement_pending until reconciliation confirms it', async () => {
  const events = [];
  const gateway = new (class extends RecordingGateway {
    async settle(payment) {
      this.events.push('settle_attempt');
      if (this.events.filter((event) => event === 'settle_attempt').length < 3)
        throw new PaymentSettlementError('settle response lost', { definitive: false });
      return super.settle(payment);
    }
  })(events);
  const { base, close } = await startServer({
    events,
    gateway,
    x402SettlementRetrySeconds: 0.01,
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [],
        receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
      }),
    },
  });
  try {
    const accepted = await renderRequest(base, 'paid-pending');
    assert.equal(accepted.status, 202);
    const job = await waitForJob(base, (await accepted.json()).job_id);
    assert.equal(job.status, 'completed');
    assert.equal(job.payment.status, 'settlement_pending');
    assert.equal(job.receipt.tx_hash, null);
    assert.equal(job.payment.payment_payload, undefined);
    assert.equal(job.payment.payment_requirements, undefined);
    const pendingReceiptArtifact = job.artifacts.find(
      (artifact) => artifact.name === 'receipt.json',
    );
    assert.ok(pendingReceiptArtifact, 'QC-passed artifacts must be delivered while pending');
    const pendingReceipt = await (await fetch(`${base}${pendingReceiptArtifact.url}`)).json();
    assert.equal(pendingReceipt.payment.status, 'settlement_pending');
    assert.equal(pendingReceipt.payment.tx_hash, null);

    let reconciled = job;
    for (let attempt = 0; attempt < 200 && reconciled.payment.status !== 'settled'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      reconciled = await (await fetch(`${base}/v1/jobs/${job.job_id}`)).json();
    }
    assert.equal(reconciled.payment.status, 'settled');
    assert.equal(
      reconciled.receipt.tx_hash,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    const settledReceiptArtifact = reconciled.artifacts.find(
      (artifact) => artifact.name === 'receipt.json',
    );
    const settledReceipt = await (await fetch(`${base}${settledReceiptArtifact.url}`)).json();
    assert.equal(settledReceipt.payment.status, 'settled');
    assert.equal(settledReceipt.payment.tx_hash, reconciled.receipt.tx_hash);
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('a definitive facilitator refusal after QC keeps artifacts and records failed_not_charged', async () => {
  const events = [];
  const gateway = new (class extends RecordingGateway {
    async settle() {
      this.events.push('settle_attempt');
      throw new PaymentSettlementError('authorization expired', { definitive: true });
    }
  })(events);
  const { base, close } = await startServer({
    events,
    gateway,
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [],
        receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
      }),
    },
  });
  try {
    const accepted = await renderRequest(base, 'paid-refused');
    const job = await waitForJob(base, (await accepted.json()).job_id);
    assert.equal(job.status, 'completed');
    assert.equal(job.payment.status, 'failed_not_charged');
    assert.equal(job.payment.reason, 'settlement_failed');
    assert.equal(job.receipt.tx_hash, null);
    assert.ok(job.artifacts.find((artifact) => artifact.name === 'receipt.json'));
  } finally {
    await close();
  }
});

test('the public job response never exposes the signed payment authorization', async () => {
  const events = [];
  const { base, close } = await startServer({
    events,
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [],
        receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
      }),
    },
  });
  try {
    const accepted = await renderRequest(base, 'paid-sanitized');
    const job = await waitForJob(base, (await accepted.json()).job_id);
    assert.equal(job.payment.status, 'settled');
    assert.equal(job.payment.payment_payload, undefined);
    assert.equal(job.payment.payment_requirements, undefined);
    assert.equal(job.payment.settlement_response, undefined);
  } finally {
    await close();
  }
});

test('validate replays the same paid outcome for an idempotency key without a second charge', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const validate = () =>
      fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Payment-Signature': 'paid-validation',
          'Idempotency-Key': 'validate-once',
        },
        body: JSON.stringify({ musicxml }),
      });
    const first = await validate();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.payment.payment_payload, undefined);
    const replay = await validate();
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), firstBody);
    assert.ok(replay.headers.get('payment-response'));
    assert.deepEqual(events, ['verify', 'settle']);
  } finally {
    await close();
  }
});

test('validate maps a definitive settlement refusal to 502 payment_settlement_failed', async () => {
  const events = [];
  const gateway = new (class extends RecordingGateway {
    async settle() {
      throw new PaymentSettlementError('authorization expired', { definitive: true });
    }
  })(events);
  const { base, close } = await startServer({ events, gateway });
  try {
    const response = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Payment-Signature': 'paid-validation',
        'Idempotency-Key': 'validate-refused',
      },
      body: JSON.stringify({ musicxml }),
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'payment_settlement_failed');
  } finally {
    await close();
  }
});

test('validate reports settlement_pending on an ambiguous settle and replays the reconciled receipt', async () => {
  const events = [];
  const gateway = new (class extends RecordingGateway {
    async settle(payment) {
      this.events.push('settle_attempt');
      if (this.events.filter((event) => event === 'settle_attempt').length < 2)
        throw new PaymentSettlementError('settle response lost', { definitive: false });
      return super.settle(payment);
    }
  })(events);
  const { base, close } = await startServer({ events, gateway, x402SettlementRetrySeconds: 0.01 });
  try {
    const validate = () =>
      fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Payment-Signature': 'paid-validation',
          'Idempotency-Key': 'validate-pending',
        },
        body: JSON.stringify({ musicxml }),
      });
    const first = await validate();
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.payment.status, 'settlement_pending');
    assert.equal(firstBody.receipt.tx_hash, null);

    let replayBody = firstBody;
    for (let attempt = 0; attempt < 200 && replayBody.payment.status !== 'settled'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      replayBody = await (await validate()).json();
    }
    assert.equal(replayBody.payment.status, 'settled');
    assert.equal(
      replayBody.receipt.tx_hash,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('restart recovery records interrupted jobs as failed_not_charged', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-recovery-'));
  const store = new JobStore(dataDirectory);
  const now = new Date();
  store.create(
    {
      id: 'interrupted-job',
      inputXml: musicxml,
      formats: ['pdf'],
      constraints: {},
      facts: {},
      priceUsd: '0.25',
      payment: { provider: 'stub', status: 'verified_pending_qc' },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    },
    null,
  );
  try {
    assert.equal(store.recoverInterruptedJobs(), 1);
    const recovered = store.get('interrupted-job');
    assert.equal(recovered.state, 'failed_not_charged');
    assert.equal(recovered.payment.status, 'failed_not_charged');
    assert.equal(recovered.payment.reason, 'render_interrupted');
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

async function startServer({ events, renderer = undefined, gateway = undefined, ...overrides }) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-payments-'));
  const server = createApp({
    dataDirectory,
    payments: new PaymentService(gateway ?? new RecordingGateway(events)),
    ...(renderer ? { renderer } : {}),
    ...overrides,
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    },
  };
}

function renderRequest(base, signature, idempotencyKey) {
  return fetch(`${base}/v1/render`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'Payment-Signature': signature } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ musicxml, formats: ['pdf'] }),
  });
}

async function waitForJob(base, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await (await fetch(`${base}/v1/jobs/${jobId}`)).json();
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} did not finish.`);
}

function usdToAtomic(priceUsd) {
  const [whole, fractional = ''] = priceUsd.split('.');
  return `${whole}${fractional.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
}
