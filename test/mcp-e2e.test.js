import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';

const musicxml = fs.readFileSync(
  new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
  'utf8',
);

test('MCP stdio server calls every Musicwire API tool using the local stub payment profile', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mcp-e2e-'));
  const api = createApp({
    dataDirectory,
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [],
        receipt: { rendered_by: 'Musicwire', renderer: { version: 'test' } },
      }),
    },
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  const baseUrl = `http://127.0.0.1:${api.address().port}`;
  const client = createMcpClient({
    env: {
      MUSICWIRE_API_URL: baseUrl,
      MUSICWIRE_MCP_PAYMENT_MODE: 'stub',
    },
  });

  try {
    const initialized = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'musicwire-mcp-e2e', version: '1.0.0' },
    });
    assert.equal(initialized.serverInfo.name, 'musicwire-mcp');
    assert.equal(initialized.serverInfo.version, '0.1.3');
    assert.equal(initialized.serverInfo.title, 'Musicwire');
    assert.match(initialized.serverInfo.description, /MusicXML/);
    assert.equal(initialized.serverInfo.websiteUrl, 'https://musicwire.5432wire.com/docs');
    assert.deepEqual(initialized.capabilities.resources, {});
    assert.deepEqual(initialized.capabilities.prompts, {});
    assert.match(initialized.instructions, /tools only/i);
    assert.deepEqual((await client.request('resources/list', {})).resources, []);
    assert.deepEqual((await client.request('resources/templates/list', {})).resourceTemplates, []);
    assert.deepEqual((await client.request('prompts/list', {})).prompts, []);
    await assert.rejects(
      () => client.request('prompts/get', { name: 'no-such-prompt' }),
      /Prompt no-such-prompt not found/,
    );
    await assert.rejects(
      () => client.request('resources/read', { uri: 'musicwire://no-such-resource' }),
      /Resource musicwire:\/\/no-such-resource not found/,
    );

    const tools = await client.request('tools/list', {});
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'musicwire_compose_guide',
      'musicwire_get_job',
      'musicwire_render',
      'musicwire_validate',
      'musicwire_verify_provenance',
    ]);
    const byName = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.musicwire_compose_guide.annotations.readOnlyHint, true);
    assert.equal(byName.musicwire_get_job.annotations.readOnlyHint, true);
    assert.equal(byName.musicwire_verify_provenance.annotations.readOnlyHint, true);
    assert.equal(byName.musicwire_validate.annotations.readOnlyHint, false);
    assert.equal(byName.musicwire_render.annotations.destructiveHint, false);
    assert.equal(byName.musicwire_render.annotations.openWorldHint, false);
    assert.match(byName.musicwire_validate.description, /Payment-Signature/);

    const guide = await client.callTool('musicwire_compose_guide', {
      style: 'waltz',
      key: 'F major',
      tempo: '84',
    });
    assert.match(guide.llm_prompt, /Style: waltz/);
    assert.equal(guide.constraints_echo.key, 'F major');

    const validation = await client.callTool('musicwire_validate', { musicxml });
    assert.equal(validation.valid, true);
    assert.equal(validation.payment.status, 'settled');

    const render = await client.callTool('musicwire_render', {
      musicxml,
      formats: ['midi'],
      constraints_check: { tempo: 90 },
    });
    assert.match(render.job_id, /^[0-9a-f-]{36}$/);
    assert.equal(render.payment.status, 'verified_pending_qc');

    const job = await client.callTool('musicwire_get_job', {
      job_id: render.job_id,
      wait_for_completion: true,
      poll_interval_ms: 10,
      max_wait_ms: 1_000,
    });
    assert.equal(job.job_id, render.job_id);
    assert.equal(job.status, 'completed');
    assert.equal(job.payment.status, 'settled');

    const provenance = await client.callTool('musicwire_verify_provenance', {
      sha256: '0'.repeat(64),
    });
    assert.equal(provenance.rendered_by_musicwire, false);
  } finally {
    await client.close();
    await closeServer(api);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

function createMcpClient({ env }) {
  const child = spawn(process.execPath, ['mcp/src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    const lines = stdout.split('\n');
    stdout = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        setTimeout(async () => {
          const request = pending.get(id);
          if (!request) return;
          pending.delete(id);
          const result = await Promise.race([
            exited,
            new Promise((resolveGrace) => setTimeout(resolveGrace, 100, null).unref()),
          ]);
          const serverState = result
            ? `server exit ${result.code ?? result.signal}`
            : 'server still running';
          reject(new Error(`MCP request ${method} timed out (${serverState}): ${stderr}`));
        }, 2_000).unref();
      });
    },
    async callTool(name, arguments_) {
      const result = await this.request('tools/call', { name, arguments: arguments_ });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal(result.content?.[0]?.type, 'text');
      return JSON.parse(result.content[0].text);
    },
    async close() {
      child.stdin.end();
      if (!child.killed) child.kill('SIGTERM');
      await exited;
    },
  };
}

function once(target, event) {
  return new Promise((resolve) => target.once(event, resolve));
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
