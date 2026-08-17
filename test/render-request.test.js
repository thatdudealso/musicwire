import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';

const musicxml = fs.readFileSync(new URL('./fixtures/two-bar-piano.musicxml', import.meta.url), 'utf8');

test('render requires JSON and at least one output format before queuing', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-render-request-'));
  const server = createApp({ dataDirectory }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const raw = await fetch(`${base}/v1/render`, { method: 'POST', headers: { 'content-type': 'application/xml' }, body: musicxml });
    assert.equal(raw.status, 415);
    assert.equal((await raw.json()).error.code, 'render_json_required');
    const empty = await fetch(`${base}/v1/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ musicxml, formats: [] }) });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'invalid_formats');
    const malformedConstraint = await fetch(`${base}/v1/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ musicxml, formats: ['pdf'], constraints_check: { duration_seconds: 'not-a-number' } }) });
    assert.equal(malformedConstraint.status, 400);
    assert.equal((await malformedConstraint.json()).error.code, 'invalid_constraints');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('health coalesces concurrent readiness checks', async () => {
  let probes = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-health-'));
  const server = createApp({ dataDirectory, readinessProbe: async () => { probes += 1; await pending; return [true, true]; } }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const requests = [fetch(`${base}/health`), fetch(`${base}/health`)];
    await new Promise((resolve) => {
      const waitForProbe = () => { if (probes === 1) resolve(); else setImmediate(waitForProbe); };
      waitForProbe();
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(probes, 1);
    release();
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
