import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMusicwireClient } from './client.js';
import { createMusicwireMcpServer, paidMusicwireToolNames, paidToolApiRequest } from './server.js';

const jsonRpcError = (status, message) => ({
  jsonrpc: '2.0',
  error: { code: -32000, message },
  id: null,
});

export function attachMusicwireMcp(app, options = {}) {
  const handler = createMusicwireMcpHandler(options);
  app.post('/mcp', handler);
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}

export function createMusicwireMcpHandler(options = {}) {
  return async (request, response, next) => {
    try {
      const loopbackFetch = options.loopbackFetch ?? createLoopbackFetch(request, options);
      const challenge = await unpaidPaidToolChallenge(request, loopbackFetch);
      if (challenge) return sendUpstreamResponse(response, challenge);
      const server = createMusicwireMcpServer({
        client: createHostedMusicwireClient(request, loopbackFetch),
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
      } finally {
        await transport.close().catch(() => {});
        await server.close().catch(() => {});
      }
    } catch (error) {
      next(error);
    }
  };
}

function methodNotAllowed(_request, response) {
  response.set('Allow', 'POST');
  response.status(405).json(jsonRpcError(405, 'Method not allowed.'));
}

async function unpaidPaidToolChallenge(request, loopbackFetch) {
  if (request.get('payment-signature')) return null;
  const paidCall = jsonRpcMessages(request.body).find(
    (message) =>
      message?.method === 'tools/call' && paidMusicwireToolNames.has(message.params?.name),
  );
  if (!paidCall) return null;
  const apiRequest = paidToolApiRequest(paidCall.params.name, paidCall.params.arguments ?? {});
  if (!apiRequest) return null;
  return loopbackFetch(new URL(apiRequest.path, 'http://musicwire.invalid/'), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apiRequest.body),
  });
}

function createHostedMusicwireClient(request, loopbackFetch) {
  const paymentSignature = request.get('payment-signature');
  const idempotencyKey = request.get('idempotency-key');
  return createMusicwireClient({
    baseUrl: 'http://musicwire.invalid/',
    paymentMode: 'x402',
    privateKey: null,
    payOnChallenge: false,
    fetchImpl: (input, init = {}) => {
      const headers = new Headers(init.headers);
      if (paymentSignature && !headers.has('payment-signature'))
        headers.set('payment-signature', paymentSignature);
      if (idempotencyKey && !headers.has('idempotency-key'))
        headers.set('idempotency-key', idempotencyKey);
      return loopbackFetch(input, { ...init, headers });
    },
  });
}

export function createLoopbackFetch(request, { loopbackPort } = {}) {
  return (input, init = {}) => {
    const url = new URL(input, 'http://127.0.0.1');
    const port = loopbackPort ?? request.socket?.server?.address()?.port;
    if (!port) return Promise.reject(new Error('Musicwire MCP could not reach the local API.'));
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    headers['x-musicwire-loopback'] = '1';
    const host = request.get('host');
    if (host) headers.host = host;
    const forwardedProto = request.get('x-forwarded-proto') ?? request.protocol;
    if (forwardedProto) headers['x-forwarded-proto'] = forwardedProto;
    return new Promise((resolve, reject) => {
      const upstream = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `${url.pathname}${url.search}`,
          method: init.method ?? 'GET',
          headers,
        },
        (upstreamResponse) => {
          const chunks = [];
          upstreamResponse.on('data', (chunk) => chunks.push(chunk));
          upstreamResponse.on('end', () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: upstreamResponse.statusCode,
                headers: flattenIncomingHeaders(upstreamResponse.headers),
              }),
            );
          });
        },
      );
      upstream.on('error', reject);
      if (init.body !== undefined && init.body !== null) upstream.write(init.body);
      upstream.end();
    });
  };
}

async function sendUpstreamResponse(response, upstream) {
  const blocked = new Set([
    'connection',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);
  for (const [name, value] of upstream.headers) {
    if (!blocked.has(name)) response.set(name, value);
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  response.status(upstream.status);
  response.send(body);
}

function jsonRpcMessages(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') return [body];
  return [];
}

function flattenIncomingHeaders(headers) {
  const flattened = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flattened.push([name, Array.isArray(value) ? value.join(', ') : String(value)]);
  }
  return flattened;
}
