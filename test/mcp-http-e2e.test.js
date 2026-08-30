import assert from 'node:assert/strict';
import fs from 'node:fs';
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

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
