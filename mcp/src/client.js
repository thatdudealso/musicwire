import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const supportedNetworks = new Map([
  ['eip155:8453', 'Base mainnet'],
  ['eip155:84532', 'Base Sepolia'],
]);

export class MusicwireApiError extends Error {
  constructor({ status, body }) {
    super(body?.error?.message ?? `Musicwire API request failed with HTTP ${status}.`);
    this.name = 'MusicwireApiError';
    this.status = status;
    this.body = body;
  }
}

export function createMusicwireClient({
  baseUrl = process.env.MUSICWIRE_API_URL ?? 'http://127.0.0.1:8787',
  paymentMode = process.env.MUSICWIRE_MCP_PAYMENT_MODE ?? 'x402',
  privateKey = process.env.MUSICWIRE_X402_PRIVATE_KEY ?? process.env.X402_PRIVATE_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  const apiBaseUrl = normalizeApiBaseUrl(baseUrl);
  const paidFetch = createPaidFetch({ apiBaseUrl, paymentMode, privateKey, fetchImpl });
  const request = async ({ method, path, body, idempotencyKey }) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await paidFetch(new URL(path, apiBaseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) throw new MusicwireApiError({ status: response.status, body: responseBody });
    return responseBody;
  };

  return {
    composeGuide(input = {}) {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(input)) {
        if (value !== undefined) query.set(name, String(value));
      }
      const suffix = query.size ? `?${query}` : '';
      return request({ method: 'GET', path: `v1/compose-guide${suffix}` });
    },
    validate({ musicxml, idempotency_key: idempotencyKey }) {
      return request({
        method: 'POST',
        path: 'v1/validate',
        body: { musicxml },
        idempotencyKey,
      });
    },
    render({
      musicxml,
      formats,
      constraints_check: constraintsCheck,
      idempotency_key: idempotencyKey,
    }) {
      return request({
        method: 'POST',
        path: 'v1/render',
        body: {
          musicxml,
          formats,
          ...(constraintsCheck === undefined ? {} : { constraints_check: constraintsCheck }),
        },
        idempotencyKey,
      });
    },
    getJob(jobId) {
      return request({ method: 'GET', path: `v1/jobs/${encodeURIComponent(jobId)}` });
    },
  };
}

export function createPaidFetch({ apiBaseUrl, paymentMode, privateKey, fetchImpl }) {
  if (paymentMode === 'stub') return createStubPaymentFetch({ apiBaseUrl, fetchImpl });
  if (paymentMode !== 'x402')
    throw new Error('MUSICWIRE_MCP_PAYMENT_MODE must be either "x402" or "stub".');
  let payingFetch = null;
  return async (input, init) => {
    if (payingFetch) return (await payingFetch)(input, init);
    const response = await fetchImpl(input, init);
    if (response.status !== 402) return response;
    payingFetch = createSignedPaymentFetch({ apiBaseUrl, privateKey, fetchImpl }).catch((error) => {
      payingFetch = null;
      throw error;
    });
    return (await payingFetch)(input, init);
  };
}

async function createSignedPaymentFetch({ apiBaseUrl, privateKey, fetchImpl }) {
  const network = await resolvePaymentNetwork({ apiBaseUrl, fetchImpl });
  if (!privateKey)
    throw new Error(
      `Musicwire requires payment for this call, and no buyer key is configured. Set MUSICWIRE_X402_PRIVATE_KEY (or X402_PRIVATE_KEY) to a buyer private key funded on ${supportedNetworks.get(network)}.`,
    );
  const signer = privateKeyToAccount(privateKey);
  const client = new x402Client().register(network, new ExactEvmScheme(signer));
  return wrapFetchWithPayment(fetchImpl, client);
}

// The payment network always comes from the service manifest so this client
// cannot drift from the network the server actually quotes.
async function resolvePaymentNetwork({ apiBaseUrl, fetchImpl }) {
  let manifest;
  try {
    const response = await fetchImpl(new URL('manifest', apiBaseUrl), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
  } catch (error) {
    throw new Error(
      `Musicwire requires payment for this call, but its manifest could not be read to select a payment network: ${error.message}`,
      { cause: error },
    );
  }
  const network = manifest?.payment?.network;
  if (!supportedNetworks.has(network))
    throw new Error(
      `Musicwire advertises the payment network ${network ?? 'unknown'}, which musicwire-mcp does not support. Supported networks: ${[...supportedNetworks.keys()].join(', ')}.`,
    );
  return network;
}

function createStubPaymentFetch({ apiBaseUrl, fetchImpl }) {
  if (!isLoopbackUrl(apiBaseUrl))
    throw new Error(
      'Stub payments are allowed only for a loopback MUSICWIRE_API_URL. Use x402 for remote APIs.',
    );
  return async (input, init) => {
    const request = new Request(input, init);
    const retry = request.clone();
    const response = await fetchImpl(request);
    if (response.status !== 402) return response;
    retry.headers.set('payment-signature', 'musicwire-mcp-local-stub-payment');
    return fetchImpl(retry);
  };
}

function normalizeApiBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('MUSICWIRE_API_URL must use HTTP or HTTPS.');
  if (url.username || url.password)
    throw new Error('MUSICWIRE_API_URL must not contain embedded credentials.');
  return new URL(`${url.pathname.replace(/\/$/, '')}/`, url);
}

function isLoopbackUrl(url) {
  return ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname);
}
