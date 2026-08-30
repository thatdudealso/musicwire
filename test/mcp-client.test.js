import assert from 'node:assert/strict';
import test from 'node:test';
import { createPaidFetch } from '../mcp/src/client.js';

const apiBaseUrl = new URL('https://musicwire.example/');

const stubApi = ({ network, manifestStatus = 200 }) => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url.pathname);
    if (url.pathname === '/manifest')
      return new Response(JSON.stringify({ payment: { network } }), {
        status: manifestStatus,
        headers: { 'content-type': 'application/json' },
      });
    return new Response('{}', { status: 402 });
  };
  return { calls, fetchImpl };
};

test('the buyer selects its payment network from the network the service advertises', async () => {
  for (const [network, label] of [
    ['eip155:8453', 'Base mainnet'],
    ['eip155:84532', 'Base Sepolia'],
  ]) {
    const { calls, fetchImpl } = stubApi({ network });
    const paidFetch = createPaidFetch({
      apiBaseUrl,
      paymentMode: 'x402',
      privateKey: undefined,
      fetchImpl,
    });

    // With no buyer key the payment cannot be signed, and the failure names the
    // network read from the manifest rather than a hardcoded one.
    await assert.rejects(
      paidFetch(new URL('v1/validate', apiBaseUrl), { method: 'POST' }),
      (error) => {
        assert.match(error.message, new RegExp(`funded on ${label}\\.$`));
        return true;
      },
    );
    assert.deepEqual(calls, ['/v1/validate', '/manifest']);
  }
});

test('the buyer refuses to pay on a network it does not support', async () => {
  const { fetchImpl } = stubApi({ network: 'eip155:1' });
  const paidFetch = createPaidFetch({
    apiBaseUrl,
    paymentMode: 'x402',
    privateKey: '0x'.padEnd(66, '1'),
    fetchImpl,
  });

  await assert.rejects(paidFetch(new URL('v1/validate', apiBaseUrl), { method: 'POST' }), {
    message: /advertises the payment network eip155:1, which musicwire-mcp does not support/,
  });
});

test('an unreadable manifest fails the call instead of guessing a network', async () => {
  const { fetchImpl } = stubApi({ network: 'eip155:8453', manifestStatus: 503 });
  const paidFetch = createPaidFetch({
    apiBaseUrl,
    paymentMode: 'x402',
    privateKey: '0x'.padEnd(66, '1'),
    fetchImpl,
  });

  await assert.rejects(paidFetch(new URL('v1/validate', apiBaseUrl), { method: 'POST' }), {
    message: /manifest could not be read to select a payment network: HTTP 503/,
  });
});

test('hosted MCP clients surface a 402 instead of auto-paying', async () => {
  const { fetchImpl } = stubApi({ network: 'eip155:8453' });
  const paidFetch = createPaidFetch({
    apiBaseUrl,
    paymentMode: 'x402',
    privateKey: '0x'.padEnd(66, '1'),
    payOnChallenge: false,
    fetchImpl,
  });

  const response = await paidFetch(new URL('v1/validate', apiBaseUrl), { method: 'POST' });

  assert.equal(response.status, 402);
});

test('a non-402 response is returned untouched and reads no manifest', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(new URL(input).pathname);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const paidFetch = createPaidFetch({
    apiBaseUrl,
    paymentMode: 'x402',
    privateKey: undefined,
    fetchImpl,
  });

  const response = await paidFetch(new URL('v1/compose-guide', apiBaseUrl), { method: 'GET' });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['/v1/compose-guide']);
});
