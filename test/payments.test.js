import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { validateDiscoveryExtension } from '@x402/extensions/bazaar';
import { createApp } from '../src/app.js';
import {
  CdpX402Gateway,
  PaymentConfigurationError,
  PaymentService,
  PaymentSettlementError,
  PaymentVerificationError,
  verifyRpcNetwork,
} from '../src/payment.js';
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
  const payload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      authorization: {
        from: '0x2222222222222222222222222222222222222222',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      signature: 'test',
    },
  };
  const gateway = new CdpX402Gateway({
    config: {
      x402Network: 'eip155:84532',
      x402PaymentTimeoutSeconds: 300,
      publicBaseUrl: '',
    },
    store: {},
    wallet: { address: async () => requirements.payTo },
  });
  let declaredExtensions;
  gateway.serverPromise = Promise.resolve({
    buildPaymentRequirements: async () => [requirements],
    createPaymentRequiredResponse: async (_requirements, resource, _error, extensions) => {
      declaredExtensions = extensions;
      return {
        x402Version: 2,
        resource,
        accepts: [requirements],
      };
    },
    findMatchingRequirements: (available) => available[0],
    verifyPayment: async () => ({
      isValid: true,
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
  assert.equal(result.payment.payer, '0x2222222222222222222222222222222222222222');
  assert.equal(declaredExtensions.bazaar.info.input.method, 'POST');
  assert.equal(declaredExtensions.bazaar.info.input.bodyType, 'json');
  assert.deepEqual(declaredExtensions.bazaar.info.input.body.formats, ['mp3', 'midi']);
  assert.deepEqual(validateDiscoveryExtension(declaredExtensions.bazaar), { valid: true });

  const reencodedPayload = {
    payload: {
      signature: 'test',
      authorization: {
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        from: '0x2222222222222222222222222222222222222222',
      },
    },
    accepted: requirements,
    x402Version: 2,
  };
  const reencoded = await gateway.authorize({
    request: {
      protocol: 'https',
      originalUrl: '/v1/render',
      get: (name) =>
        name.toLowerCase() === 'payment-signature'
          ? Buffer.from(JSON.stringify(reencodedPayload)).toString('base64')
          : 'musicwire.test',
    },
    endpoint: 'render',
    priceUsd: '0.25',
    outputSchema: {},
  });
  assert.equal(reencoded.authorized, true);
  assert.equal(
    reencoded.payment.authorization_fingerprint,
    result.payment.authorization_fingerprint,
  );

  gateway.serverPromise = Promise.resolve({
    buildPaymentRequirements: async () => [requirements],
    createPaymentRequiredResponse: async (_requirements, resource) => ({
      x402Version: 2,
      resource,
      accepts: [requirements],
    }),
    findMatchingRequirements: (available) => available[0],
    verifyPayment: async () => ({
      isValid: false,
      invalidReason: 'invalid_exact_evm_nonce_already_used',
      payer: '0x2222222222222222222222222222222222222222',
    }),
  });
  const consumed = await gateway.authorize({
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
  assert.equal(consumed.authorized, false);
  assert.equal(consumed.replayPayment.payer, '0x2222222222222222222222222222222222222222');

  const malformed = await gateway.authorize({
    request: {
      protocol: 'https',
      originalUrl: '/v1/render',
      get: (name) =>
        name.toLowerCase() === 'payment-signature'
          ? encodePaymentSignatureHeader({ ...payload, payload: { signature: 'test' } })
          : 'musicwire.test',
    },
    endpoint: 'render',
    priceUsd: '0.25',
    outputSchema: {},
  });
  assert.equal(malformed.authorized, false);
});

function gatewayWithVerify(verifyPayment) {
  const requirements = {
    scheme: 'exact',
    network: 'eip155:84532',
    amount: '250000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x1111111111111111111111111111111111111111',
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  };
  const gateway = new CdpX402Gateway({
    config: { x402Network: 'eip155:84532', x402PaymentTimeoutSeconds: 300, publicBaseUrl: '' },
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
    findMatchingRequirements: (available) => available[0],
    verifyPayment,
  });
  return gateway;
}

function authorizeWithSignedPayment(gateway) {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'eip155:84532',
      amount: '250000',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0x1111111111111111111111111111111111111111',
      maxTimeoutSeconds: 300,
      extra: { name: 'USDC', version: '2' },
    },
    payload: {
      authorization: {
        from: '0x2222222222222222222222222222222222222222',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      signature: 'test',
    },
  };
  return gateway.authorize({
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
}

// A determinate rejection reaches us as a thrown VerifyError because the CDP
// facilitator answers /verify with a non-2xx status whose body still carries an
// { isValid:false } verdict, and @x402/core converts that into a throw.
function verifyError({ invalidReason, invalidMessage, payer, statusCode = 400 }) {
  const error = new Error(invalidMessage ? `${invalidReason}: ${invalidMessage}` : invalidReason);
  error.name = 'VerifyError';
  error.statusCode = statusCode;
  error.invalidReason = invalidReason;
  error.invalidMessage = invalidMessage;
  error.payer = payer;
  return error;
}

test('a thrown determinate VerifyError re-challenges with the real reason instead of a swallowed error', async () => {
  const gateway = gatewayWithVerify(async () => {
    throw verifyError({
      invalidReason: 'insufficient_funds',
      invalidMessage: 'payer balance is below the required amount',
      payer: '0x2222222222222222222222222222222222222222',
    });
  });

  const result = await authorizeWithSignedPayment(gateway);

  assert.equal(result.authorized, false);
  assert.ok(result.challenge.headers['payment-required']);
  // The buyer must see the true reason, not a blanket facilitator-refused claim.
  assert.equal(result.challenge.body.error, 'payer balance is below the required amount');
  assert.doesNotMatch(result.challenge.body.error, /could not verify/i);
});

test('a thrown consumed-authorization VerifyError still exposes the replay payer', async () => {
  const gateway = gatewayWithVerify(async () => {
    throw verifyError({
      invalidReason: 'invalid_exact_evm_nonce_already_used',
      payer: '0x2222222222222222222222222222222222222222',
    });
  });

  const result = await authorizeWithSignedPayment(gateway);

  assert.equal(result.authorized, false);
  assert.equal(result.replayPayment.payer, '0x2222222222222222222222222222222222222222');
  assert.equal(result.challenge.body.error, 'invalid_exact_evm_nonce_already_used');
});

test('an indeterminate verify failure surfaces an honest error that never blames the facilitator', async () => {
  const cause = new Error('fetch failed: socket hang up');
  const gateway = gatewayWithVerify(async () => {
    throw cause;
  });

  await assert.rejects(authorizeWithSignedPayment(gateway), (error) => {
    assert.ok(error instanceof PaymentVerificationError);
    // Honest: we could not complete verification; we do NOT assert a refusal.
    assert.match(error.message, /could not be completed/i);
    assert.doesNotMatch(error.message, /facilitator/i);
    assert.doesNotMatch(error.message, /could not verify this payment/i);
    // The real cause is preserved for diagnosis rather than discarded.
    assert.equal(error.cause, cause);
    return true;
  });
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
    const payment = {
      provider: 'recording_gateway',
      status: 'verified_pending_qc',
      amount_usd: priceUsd,
      amount_atomic: requirements.amount,
      asset: requirements.asset,
      network: requirements.network,
      pay_to: requirements.payTo,
      payer:
        request.get('payment-signature') === 'payer-b' ||
        request.get('payment-signature') === 'consumed-b'
          ? '0x3333333333333333333333333333333333333333'
          : '0x2222222222222222222222222222222222222222',
      authorization_fingerprint: request.get('payment-signature'),
      payment_payload: { test: true },
      payment_requirements: requirements,
    };
    if (request.get('payment-signature').startsWith('consumed-'))
      return {
        authorized: false,
        replayPayment: payment,
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
    return {
      authorized: true,
      payment,
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

test('x402 challenge publishes exact Base Sepolia requirements and a duration QC failure settles nothing', async () => {
  const events = [];
  const { base, close } = await startServer({
    events,
    renderer: {
      render: async () => {
        events.push('render');
        return {
          ok: false,
          error: {
            code: 'audio_duration_mismatch',
            message: 'Audio duration exceeded the bounded release-tail allowance.',
          },
        };
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
    assert.equal(job.error.code, 'audio_duration_mismatch');
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
    assert.deepEqual(events, ['verify', 'render', 'settle', 'verify']);

    const receiptArtifact = job.artifacts.find((artifact) => artifact.name === 'receipt.json');
    const receipt = await (await fetch(`${base}${receiptArtifact.url}`)).json();
    assert.equal(receipt.payment.tx_hash, job.receipt.tx_hash);
    assert.equal(receipt.payment.network, job.receipt.network);
  } finally {
    await close();
  }
});

test('render idempotency isolates payer and request context after payment authorization', async () => {
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
    const first = await renderRequest(base, 'payer-a-first', 'shared-render-key', ['mp3', 'midi']);
    assert.equal(first.status, 202);
    const firstBody = await first.json();
    await waitForJob(base, firstBody.job_id);

    const reordered = await renderRequest(base, 'payer-a-reordered', 'shared-render-key', [
      'midi',
      'mp3',
    ]);
    assert.equal(reordered.status, 202);
    assert.equal((await reordered.json()).job_id, firstBody.job_id);

    const unpaid = await renderRequest(base, undefined, 'shared-render-key');
    const unpaidBody = await unpaid.json();
    assert.equal(unpaid.status, 402);
    assert.equal(unpaidBody.resource.url, 'https://musicwire.test/v1/render');
    assert.equal('job_id' in unpaidBody, false);
    assert.equal('receipt' in unpaidBody, false);

    const otherPayer = await renderRequest(base, 'payer-b', 'shared-render-key');
    assert.equal(otherPayer.status, 202);
    const otherPayerBody = await otherPayer.json();
    assert.notEqual(otherPayerBody.job_id, firstBody.job_id);
    await waitForJob(base, otherPayerBody.job_id);

    const differentContext = await renderRequest(base, 'payer-a-replay', 'shared-render-key');
    assert.equal(differentContext.status, 202);
    const differentContextBody = await differentContext.json();
    assert.notEqual(differentContextBody.job_id, firstBody.job_id);
    await waitForJob(base, differentContextBody.job_id);
    assert.equal(events.filter((event) => event === 'settle').length, 3);
  } finally {
    await close();
  }
});

test('consumed signatures replay only matching payer-owned render records', async () => {
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
    const first = await renderRequest(base, 'payer-a-first', 'consumed-render-key');
    assert.equal(first.status, 202);
    const firstBody = await first.json();
    await waitForJob(base, firstBody.job_id);

    const replay = await renderRequest(base, 'consumed-a', 'consumed-render-key');
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).job_id, firstBody.job_id);

    for (const [signature, key] of [
      ['consumed-b', 'consumed-render-key'],
      [undefined, 'consumed-render-key'],
      ['consumed-a', 'unused-consumed-render-key'],
    ]) {
      const response = await renderRequest(base, signature, key);
      assert.equal(response.status, 402);
      const body = await response.json();
      assert.equal('job_id' in body, false);
      assert.equal('receipt' in body, false);
    }
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('consumed signatures replay only matching payer-owned validation records', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  const validate = (signature, idempotencyKey) =>
    fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'Payment-Signature': signature } : {}),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ musicxml }),
    });
  try {
    const first = await validate('payer-a-first', 'consumed-validation-key');
    assert.equal(first.status, 200);
    const firstBody = await first.json();

    const replay = await validate('consumed-a', 'consumed-validation-key');
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), firstBody);

    for (const [signature, key] of [
      ['consumed-b', 'consumed-validation-key'],
      [undefined, 'consumed-validation-key'],
      ['consumed-a', 'unused-consumed-validation-key'],
    ]) {
      const response = await validate(signature, key);
      assert.equal(response.status, 402);
      const body = await response.json();
      assert.equal('receipt' in body, false);
    }
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('a signed authorization cannot create distinct render outcomes', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const requests = await Promise.all([
      renderRequest(base, 'one-authorization', 'first-outcome'),
      renderRequest(base, 'one-authorization', 'second-outcome'),
    ]);
    const bodies = await Promise.all(requests.map((response) => response.json()));
    const accepted = requests.findIndex((response) => response.status === 202);
    const rejected = requests.findIndex((response) => response.status === 409);
    assert.deepEqual(requests.map((response) => response.status).sort(), [202, 409]);
    assert.equal(bodies[rejected].error.code, 'payment_authorization_reused');
    const job = await waitForJob(base, bodies[accepted].job_id);
    assert.equal(job.payment.status, 'settled');
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('a signed authorization cannot create distinct validation outcomes', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const validate = (idempotencyKey) =>
      fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Payment-Signature': 'one-validation-authorization',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ musicxml }),
      });
    const responses = await Promise.all([
      validate('first-validation'),
      validate('second-validation'),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const accepted = responses.findIndex((response) => response.status === 200);
    const rejected = responses.findIndex((response) => response.status === 409);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(bodies[rejected].error.code, 'payment_authorization_reused');
    assert.equal(bodies[accepted].payment.status, 'settled');
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('payment quotes follow the live price configuration', async () => {
  const events = [];
  const { base, close } = await startServer({
    events,
    validatePriceUsd: '0.11',
    renderSoloPriceUsd: '0.26',
    renderMultiPriceUsd: '0.51',
  });
  try {
    const manifest = await (await fetch(`${base}/manifest`)).json();
    assert.equal(manifest.endpoints.validate.price_usd, '0.11');
    assert.equal(manifest.endpoints.render.price_usd.solo, '0.26');
    assert.equal(manifest.endpoints.render.price_usd.multi_instrument, '0.51');
    const quote = await renderRequest(base);
    assert.equal(quote.status, 402);
    assert.equal(
      decodePaymentRequiredHeader(quote.headers.get('payment-required')).accepts[0].amount,
      '260000',
    );
  } finally {
    await close();
  }
});

test('discovery probes without a payment receive the 402 challenge before payload validation', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const probes = [
      ['empty JSON body', { headers: { 'content-type': 'application/json' }, body: '{}' }],
      ['absent body', {}],
      ['non-JSON content type', { headers: { 'content-type': 'text/plain' }, body: 'probe' }],
      ['malformed JSON body', { headers: { 'content-type': 'application/json' }, body: '{nope' }],
    ];
    for (const [path, priceUsd] of [
      ['/v1/validate', '0.10'],
      ['/v1/render', '0.25'],
    ]) {
      for (const [label, init] of probes) {
        const response = await fetch(`${base}${path}`, { method: 'POST', ...init });
        assert.equal(response.status, 402, `${path} with ${label}`);
        const required = decodePaymentRequiredHeader(response.headers.get('payment-required'));
        assert.equal(required.accepts[0].amount, usdToAtomic(priceUsd), `${path} with ${label}`);
        const body = await response.json();
        assert.equal(body.quote.price_usd, priceUsd, `${path} with ${label}`);
        assert.equal(body.quote.settlement, 'after_qc_pass', `${path} with ${label}`);
      }
    }
    assert.deepEqual(events, []);
  } finally {
    await close();
  }
});

test('a render discovery probe with a readable score quotes its real price tier', async () => {
  const { base, close } = await startServer({ events: [] });
  try {
    const parts = [1, 2, 3]
      .map(
        (id) =>
          `<score-part id="P${id}"><part-name>Part ${id}</part-name></score-part>|<part id="P${id}"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part>`,
      )
      .map((pair) => pair.split('|'));
    const multiPartXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>${parts.map(([scorePart]) => scorePart).join('')}</part-list>${parts.map(([, part]) => part).join('')}</score-partwise>`;
    const quote = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml: multiPartXml, formats: ['midi'] }),
    });
    assert.equal(quote.status, 402);
    assert.equal(
      decodePaymentRequiredHeader(quote.headers.get('payment-required')).accepts[0].amount,
      usdToAtomic('0.50'),
    );
  } finally {
    await close();
  }
});

test('a presented payment with an invalid payload keeps its failure code and never charges', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const validate = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'payer-a' },
      body: '{}',
    });
    assert.equal(validate.status, 400);
    assert.equal((await validate.json()).error.code, 'musicxml_required');

    const render = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'payer-a' },
      body: JSON.stringify({ musicxml: 'not music xml at all', formats: ['midi'] }),
    });
    assert.equal(render.status, 422);
    const renderBody = await render.json();
    assert.equal(renderBody.status, 'failed_not_charged');
    assert.equal(renderBody.payment.status, 'not_charged');

    assert.equal(events.filter((event) => event === 'settle').length, 0);
  } finally {
    await close();
  }
});

test('a removed render format is rejected before payment verification or capture', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const response = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'payer-a' },
      body: JSON.stringify({ musicxml: 'not music xml at all', formats: ['pdf'] }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'invalid_formats');
    assert.match(body.error.message, /mp3, midi/);
    assert.deepEqual(events, []);
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

test('an already-used authorization resolves settled after a retry refusal', async () => {
  const events = [];
  const gateway = new (class extends RecordingGateway {
    async settle() {
      this.events.push('settle_attempt');
      const attempts = this.events.filter((event) => event === 'settle_attempt').length;
      throw new PaymentSettlementError(attempts === 1 ? 'response lost' : 'authorization used', {
        definitive: attempts > 1,
      });
    }

    async findSettlement(payment) {
      this.events.push('find_settlement');
      return {
        outcome: 'settled',
        tx_hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        network: payment.network,
      };
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
    const accepted = await renderRequest(base, 'used-authorization');
    const job = await waitForJob(base, (await accepted.json()).job_id);
    let reconciled = job;
    for (let attempt = 0; attempt < 200 && reconciled.payment.status !== 'settled'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      reconciled = await (await fetch(`${base}/v1/jobs/${job.job_id}`)).json();
    }
    assert.equal(reconciled.payment.status, 'settled');
    assert.equal(
      reconciled.receipt.tx_hash,
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    assert.equal(events.includes('cancel'), false);
  } finally {
    await close();
  }
});

test('a definitively unused authorization after QC keeps artifacts and records failed_not_charged', async () => {
  const events = [];
  const gateway = new (class extends RecordingGateway {
    async settle() {
      this.events.push('settle_attempt');
      throw new PaymentSettlementError('authorization expired', { definitive: true });
    }

    async findSettlement() {
      return { outcome: 'not_charged' };
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

test('invalid render payloads expose only a coarse validation error and are never charged', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  try {
    const response = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'payer-a' },
      body: JSON.stringify({ musicxml: '<score-partwise><invalid>', formats: ['midi'] }),
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error.code, 'validation_failed');
    assert.match(body.error.message, /paid POST \/v1\/validate/);
    assert.equal(body.error.errors, undefined);
    assert.equal(body.errors, undefined);
    assert.deepEqual(events, []);
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
    assert.equal(events.filter((event) => event === 'settle').length, 1);
  } finally {
    await close();
  }
});

test('validate scopes idempotency results to the payer and MusicXML request context', async () => {
  const events = [];
  const { base, close } = await startServer({ events });
  const validate = (signature, document) =>
    fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Payment-Signature': signature,
        'Idempotency-Key': 'shared-validation-key',
      },
      body: JSON.stringify({ musicxml: document }),
    });
  try {
    const first = await validate('payer-a-first', musicxml);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.receipt.payer, '0x2222222222222222222222222222222222222222');

    const otherPayer = await validate('payer-b', musicxml);
    const otherPayerBody = await otherPayer.json();
    assert.equal(otherPayer.status, 200);
    assert.equal(otherPayerBody.receipt.payer, '0x3333333333333333333333333333333333333333');
    assert.notDeepEqual(otherPayerBody, firstBody);

    const samePayerReplay = await validate('payer-a-replay', musicxml);
    assert.deepEqual(await samePayerReplay.json(), firstBody);

    const otherContext = await validate(
      'payer-a-other-context',
      musicxml.replace(
        '<work-title>Musicwire Test Waltz</work-title>',
        '<work-title>Different Score</work-title>',
      ),
    );
    assert.equal(otherContext.status, 200);
    assert.equal(events.filter((event) => event === 'settle').length, 3);
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

    async findSettlement() {
      return { outcome: 'not_charged' };
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
    const replay = await fetch(`${base}/v1/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Payment-Signature': 'paid-validation',
        'Idempotency-Key': 'validate-refused',
      },
      body: JSON.stringify({ musicxml }),
    });
    assert.equal(replay.status, 502);
    assert.equal((await replay.json()).error.code, 'payment_settlement_failed');
    assert.equal(events.filter((event) => event === 'verify').length, 2);
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
      formats: ['midi'],
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

test('restart recovery retains durable settlement intents for reconciliation', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-settlement-recovery-'));
  const store = new JobStore(dataDirectory);
  const now = new Date();
  store.create(
    {
      id: 'settlement-intent-job',
      inputXml: musicxml,
      formats: ['midi'],
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
    store.update('settlement-intent-job', {
      state: 'completed',
      artifacts_json: JSON.stringify([{ name: 'receipt.json' }]),
      payment_json: JSON.stringify({ provider: 'stub', status: 'settlement_pending' }),
    });
    assert.equal(store.recoverInterruptedJobs(), 0);
    const recovered = store.get('settlement-intent-job');
    assert.equal(recovered.payment.status, 'settlement_pending');
    assert.deepEqual(recovered.artifacts, [{ name: 'receipt.json' }]);
    assert.deepEqual(store.listSettlementPending(), [{ kind: 'job', id: 'settlement-intent-job' }]);
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('a replacement task retains completed jobs and payment records on its durable database volume', () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-durable-volume-'));
  const now = new Date();
  try {
    const original = new JobStore(dataDirectory);
    original.create(
      {
        id: 'completed-durable-job',
        inputXml: musicxml,
        formats: ['midi'],
        constraints: {},
        facts: {},
        priceUsd: '0.25',
        payment: { provider: 'cdp', status: 'verified_pending_qc' },
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      },
      {
        idempotencyKey: 'durable-job-key',
        payerIdentity: 'durable-payer',
        requestContext: 'durable-render-context',
      },
    );
    original.update('completed-durable-job', {
      state: 'completed',
      artifacts_json: JSON.stringify([{ name: 'score.mid', storageKey: 'artifacts/durable' }]),
      payment_json: JSON.stringify({ provider: 'cdp', status: 'settled', tx_hash: '0xdurable' }),
    });
    original.savePaymentWallet({
      provider: 'cdp',
      accountName: 'musicwire-x402-receiver',
      address: '0x1111111111111111111111111111111111111111',
      network: 'eip155:8453',
    });
    original.claimPaymentAuthorization({
      fingerprint: 'durable-payment-authorization',
      endpoint: 'render',
      idempotencyKey: 'durable-job-key',
      createdAt: now.toISOString(),
    });
    original.saveValidateResult({
      id: 'durable-validation',
      idempotencyKey: 'durable-validation-key',
      payerIdentity: 'durable-payer',
      requestContext: 'durable-context',
      httpStatus: 200,
      body: { valid: true },
      payment: { provider: 'cdp', status: 'settled', tx_hash: '0xdurable-validation' },
      createdAt: now.toISOString(),
    });

    const replacement = new JobStore(dataDirectory);
    assert.deepEqual(replacement.get('completed-durable-job').artifacts, [
      { name: 'score.mid', storageKey: 'artifacts/durable' },
    ]);
    assert.deepEqual(replacement.get('completed-durable-job').payment, {
      provider: 'cdp',
      status: 'settled',
      tx_hash: '0xdurable',
    });
    assert.equal(replacement.getPaymentWallet('cdp').account_name, 'musicwire-x402-receiver');
    assert.equal(
      replacement.claimPaymentAuthorization({
        fingerprint: 'durable-payment-authorization',
        endpoint: 'render',
        idempotencyKey: 'another-key',
        createdAt: now.toISOString(),
      }).claimed,
      false,
    );
    assert.equal(
      replacement.getValidateResultByIdentity({
        idempotencyKey: 'durable-validation-key',
        payerIdentity: 'durable-payer',
        requestContext: 'durable-context',
      }).payment.tx_hash,
      '0xdurable-validation',
    );
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('local stub reviews require a settled render transaction and publish reputation stats', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-reviews-e2e-'));
  const server = createApp({
    dataDirectory,
    requestsPerMinute: 10_000,
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [],
        receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
      }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const unpaid = await fetch(`${base}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tx_hash: 'not-a-musicwire-settlement',
        rating: 5,
        comment: 'Unverifiable review.',
      }),
    });
    assert.equal(unpaid.status, 422);
    assert.equal((await unpaid.json()).error.code, 'review_payment_not_settled');

    const render = await renderRequest(base, 'local-stub-payment');
    assert.equal(render.status, 202);
    const job = await waitForJob(base, (await render.json()).job_id);
    assert.equal(job.payment.status, 'settled');

    const accepted = await fetch(`${base}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tx_hash: job.receipt.tx_hash,
        rating: 4,
        comment: 'Reliable MIDI output.',
      }),
    });
    assert.equal(accepted.status, 201);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.review.rating, 4);
    assert.equal(acceptedBody.review.comment, 'Reliable MIDI output.');
    assert.equal(acceptedBody.review.tx_hash, job.receipt.tx_hash);
    assert.equal(acceptedBody.review.network, 'eip155:84532');
    assert.match(acceptedBody.review.created_at, /^\d{4}-\d{2}-\d{2}T/);

    const duplicate = await fetch(`${base}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tx_hash: job.receipt.tx_hash, rating: 1 }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'review_already_exists');

    const reviews = await (await fetch(`${base}/reviews?page=1&limit=1`)).json();
    assert.equal(reviews.reviews.length, 1);
    assert.equal(reviews.reviews[0].tx_hash, job.receipt.tx_hash);
    assert.deepEqual(reviews.pagination, { page: 1, limit: 1, total: 1, total_pages: 1 });

    const manifest = await (await fetch(`${base}/manifest`)).json();
    assert.deepEqual(manifest.review_stats, { count: 1, average_rating: 4 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

async function startServer({ events, renderer = undefined, gateway = undefined, ...overrides }) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-payments-'));
  const server = createApp({
    dataDirectory,
    payments: new PaymentService(gateway ?? new RecordingGateway(events)),
    // waitForJob polls every 10ms, so the production 60/minute rate limit can
    // turn a slow render into a 429 mid-poll; give tests a far larger budget.
    requestsPerMinute: 10_000,
    ...(renderer ? { renderer } : {}),
    ...overrides,
    // Bind 127.0.0.1 explicitly: a wildcard listen(0) can be handed a port that
    // another local service already holds on 127.0.0.1, hijacking test fetches.
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    },
  };
}

function renderRequest(base, signature, idempotencyKey, formats = ['midi']) {
  return fetch(`${base}/v1/render`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'Payment-Signature': signature } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ musicxml, formats }),
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

test('startup chain verification accepts an RPC endpoint on the configured network', async () => {
  const requests = [];
  const rpc = {
    request: async (method, params) => {
      requests.push([method, params]);
      return '0x2105';
    },
  };

  const served = await verifyRpcNetwork(
    { x402Network: 'eip155:8453', x402RpcUrl: 'https://rpc.example/base' },
    { rpc },
  );

  assert.equal(served, 8453);
  assert.deepEqual(requests, [['eth_chainId', []]]);
});

test('startup chain verification refuses an RPC endpoint serving another chain', async () => {
  const rpc = { request: async () => '0x14a34' };

  await assert.rejects(
    verifyRpcNetwork(
      {
        x402Network: 'eip155:8453',
        x402RpcUrl: 'https://api.provider.example/rpc/v1/base-sepolia',
      },
      { rpc },
    ),
    (error) => {
      assert.ok(error instanceof PaymentConfigurationError);
      assert.match(error.message, /serves chain 84532, but X402_NETWORK eip155:8453/);
      return true;
    },
  );
});

test('startup chain verification fails closed when the RPC endpoint is unreachable', async () => {
  const rpc = {
    request: async () => {
      throw new Error('RPC eth_chainId failed with HTTP 503.');
    },
  };

  await assert.rejects(
    verifyRpcNetwork({ x402Network: 'eip155:8453', x402RpcUrl: 'https://down.example' }, { rpc }),
    (error) => {
      assert.ok(error instanceof PaymentConfigurationError);
      assert.match(error.message, /could not be reached to confirm it serves eip155:8453/);
      return true;
    },
  );
});

test('startup chain verification gives up on a half-open RPC endpoint', async () => {
  const stalled = http.createServer(() => {});
  stalled.listen(0, '127.0.0.1');
  await new Promise((resolve) => stalled.once('listening', resolve));
  const startedAt = Date.now();
  try {
    await assert.rejects(
      verifyRpcNetwork({
        x402Network: 'eip155:8453',
        x402RpcUrl: `http://127.0.0.1:${stalled.address().port}`,
        x402RpcTimeoutSeconds: 0.25,
      }),
      (error) => {
        assert.ok(error instanceof PaymentConfigurationError);
        assert.match(error.message, /could not be reached to confirm it serves eip155:8453/);
        return true;
      },
    );
    assert.ok(Date.now() - startedAt < 5_000, 'the boot check must not wait on undici defaults');
  } finally {
    stalled.closeAllConnections();
    await new Promise((resolve) => stalled.close(resolve));
  }
});
