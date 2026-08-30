import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { createApp } from '../src/app.js';

const musicxml = fs.readFileSync(
  new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
  'utf8',
);

test('hosted MCP Streamable HTTP initializes, lists tools, and quotes paid tools with 402', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mcp-http-'));
  const api = createApp({
    dataDirectory,
    publicBaseUrl: 'https://musicwire.example',
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [],
        receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
      }),
    },
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${api.address().port}`;
  const mcp = new McpHttpClient(base);

  try {
    assert.equal((await fetch(`${base}/mcp`)).status, 405);

    const initialize = await mcp.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'musicwire-mcp-http-e2e', version: '1.0.0' },
    });
    assert.equal(initialize.status, 200);
    assert.equal(initialize.body.result.protocolVersion, '2025-06-18');
    assert.equal(initialize.body.result.serverInfo.name, 'musicwire-mcp');

    const tools = await mcp.request('tools/list', {});
    assert.equal(tools.status, 200);
    assert.deepEqual(tools.body.result.tools.map((tool) => tool.name).sort(), [
      'musicwire_compose_guide',
      'musicwire_get_job',
      'musicwire_render',
      'musicwire_validate',
      'musicwire_verify_provenance',
    ]);

    const guide = await mcp.callTool('musicwire_compose_guide', { style: 'waltz' });
    assert.equal(guide.status, 200);
    assert.match(guide.result.llm_prompt, /Style: waltz/);

    const unknownHash = await mcp.callTool('musicwire_verify_provenance', {
      sha256: '0'.repeat(64),
    });
    assert.equal(unknownHash.status, 200);
    assert.equal(unknownHash.result.rendered_by_musicwire, false);

    const unpaidValidate = await mcp.request('tools/call', {
      name: 'musicwire_validate',
      arguments: { musicxml },
    });
    assert.equal(unpaidValidate.status, 402);
    const validateQuote = decodePaymentRequiredHeader(
      unpaidValidate.headers.get('payment-required'),
    );
    assert.equal(validateQuote.accepts[0].amount, '100000');
    assert.equal(unpaidValidate.body.quote.price_usd, '0.10');
    assert.equal(unpaidValidate.body.quote.settlement, 'after_qc_pass');
    assert.match(String(validateQuote.resource?.url ?? ''), /\/v1\/validate$/);
    assert.doesNotMatch(JSON.stringify(unpaidValidate.body), /127\.0\.0\.1/);

    const unpaidRender = await mcp.request('tools/call', {
      name: 'musicwire_render',
      arguments: { musicxml, formats: ['midi'] },
    });
    assert.equal(unpaidRender.status, 402);
    assert.equal(
      decodePaymentRequiredHeader(unpaidRender.headers.get('payment-required')).accepts[0].amount,
      '250000',
    );

    const paid = await mcp.callTool(
      'musicwire_validate',
      { musicxml },
      { 'payment-signature': 'musicwire-mcp-http-e2e-stub' },
    );
    assert.equal(paid.status, 200);
    assert.equal(paid.result.valid, true);
    assert.equal(paid.result.payment.status, 'settled');
  } finally {
    await closeServer(api);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('hosted MCP loopback re-entries bill the originating client, not a shared bucket', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mcp-http-rate-'));
  const api = createApp({
    dataDirectory,
    publicBaseUrl: 'https://musicwire.example',
    requestsPerMinute: 4,
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://127.0.0.1:${api.address().port}`;
  const mcp = new McpHttpClient(base);

  try {
    for (let call = 0; call < 2; call += 1) {
      const guide = await mcp.callTool('musicwire_compose_guide', { style: 'waltz' });
      assert.equal(guide.status, 200);
    }
    const limited = await mcp.request('tools/call', {
      name: 'musicwire_compose_guide',
      arguments: {},
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    const otherClient = await fetch(`${base}/v1/compose-guide`, {
      headers: { accept: 'application/json', 'x-musicwire-loopback': '203.0.113.9' },
    });
    assert.equal(otherClient.status, 200);
  } finally {
    await closeServer(api);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('a caller that is not a loopback peer cannot set its own rate limiter key', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mcp-http-forge-'));
  const socketPath = path.join(dataDirectory, 'api.sock');
  const api = createApp({ dataDirectory, requestsPerMinute: 2 }).listen(socketPath);
  await once(api, 'listening');

  try {
    const statuses = [];
    for (let call = 0; call < 4; call += 1) {
      statuses.push(await composeGuideOverSocket(socketPath, `forged-${call}`));
    }
    assert.deepEqual(
      statuses,
      [200, 200, 429, 429],
      'rotating x-musicwire-loopback bought extra rate limit budget',
    );
  } finally {
    await closeServer(api);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

function composeGuideOverSocket(socketPath, forgedLoopbackClient) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath,
        path: '/v1/compose-guide',
        method: 'GET',
        headers: { accept: 'application/json', 'x-musicwire-loopback': forgedLoopbackClient },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('aborted hosted wait_for_completion stops loopback job polling', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mcp-http-abort-'));
  const api = createApp({
    dataDirectory,
    publicBaseUrl: 'https://musicwire.example',
    requestsPerMinute: 10_000,
    renderer: { render: () => new Promise(() => {}) },
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  let jobPolls = 0;
  api.on('request', (incoming) => {
    if (incoming.url.startsWith('/v1/jobs/')) jobPolls += 1;
  });
  const base = `http://127.0.0.1:${api.address().port}`;
  const mcp = new McpHttpClient(base);

  try {
    const render = await mcp.callTool(
      'musicwire_render',
      { musicxml, formats: ['midi'] },
      { 'payment-signature': 'musicwire-mcp-http-abort-stub' },
    );
    assert.equal(render.result.status, 'queued');
    const controller = new AbortController();
    const polling = fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'musicwire_get_job',
          arguments: {
            job_id: render.result.job_id,
            wait_for_completion: true,
            poll_interval_ms: 10,
            max_wait_ms: 300_000,
          },
        },
      }),
      signal: controller.signal,
    });
    await sleep(150);
    assert.ok(jobPolls > 0, 'wait_for_completion never polled the job');
    controller.abort();
    await polling.catch(() => {});
    await sleep(100);
    const afterAbort = jobPolls;
    await sleep(300);
    assert.ok(
      jobPolls <= afterAbort + 1,
      `polling continued after abort: ${jobPolls} > ${afterAbort}`,
    );
  } finally {
    await closeServer(api);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('hosted MCP ignores stdio payment env vars leaked onto the API service', async () => {
  const previousMode = process.env.MUSICWIRE_MCP_PAYMENT_MODE;
  const previousKey = process.env.MUSICWIRE_X402_PRIVATE_KEY;
  process.env.MUSICWIRE_MCP_PAYMENT_MODE = 'stub';
  process.env.MUSICWIRE_X402_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mcp-http-env-'));
  const api = createApp({
    dataDirectory,
    publicBaseUrl: 'https://musicwire.example',
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  const mcp = new McpHttpClient(`http://127.0.0.1:${api.address().port}`);

  try {
    const guide = await mcp.callTool('musicwire_compose_guide', { style: 'waltz' });
    assert.equal(guide.status, 200);
    const unpaidValidate = await mcp.request('tools/call', {
      name: 'musicwire_validate',
      arguments: { musicxml },
    });
    assert.equal(unpaidValidate.status, 402);
  } finally {
    await closeServer(api);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
    if (previousMode === undefined) delete process.env.MUSICWIRE_MCP_PAYMENT_MODE;
    else process.env.MUSICWIRE_MCP_PAYMENT_MODE = previousMode;
    if (previousKey === undefined) delete process.env.MUSICWIRE_X402_PRIVATE_KEY;
    else process.env.MUSICWIRE_X402_PRIVATE_KEY = previousKey;
  }
});

class McpHttpClient {
  constructor(base) {
    this.base = base;
    this.nextId = 1;
  }

  async request(method, params, extraHeaders = {}) {
    const response = await fetch(`${this.base}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
        ...extraHeaders,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, headers: response.headers, body };
  }

  async callTool(name, arguments_, extraHeaders = {}) {
    const response = await this.request(
      'tools/call',
      { name, arguments: arguments_ },
      extraHeaders,
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const result = response.body.result;
    assert.equal(result.isError, undefined, JSON.stringify(result));
    assert.equal(result.content?.[0]?.type, 'text');
    return { status: response.status, result: JSON.parse(result.content[0].text) };
  }
}

function once(target, event) {
  return new Promise((resolve) => target.once(event, resolve));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
