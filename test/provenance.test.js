import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';

const musicxml = fs.readFileSync(
  new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
  'utf8',
);

test('the free provenance endpoint verifies known artifact hashes and rejects unknown hashes', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-provenance-'));
  const bytes = Buffer.from('%PDF-1.7 Musicwire render');
  const artifact = {
    name: 'score.pdf',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    storageKey: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  const server = createApp({
    dataDirectory,
    publicBaseUrl: 'https://musicwire.example',
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [artifact],
        receipt: { rendered_by: 'Musicwire', created_at: '2026-08-22T00:00:00.000Z' },
      }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const submitted = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
      body: JSON.stringify({ musicxml, formats: ['pdf'] }),
    });
    assert.equal(submitted.status, 202);
    const queued = await submitted.json();
    assert.match(queued.provenance.receipt_id, /^[a-f0-9-]{36}$/);
    assert.equal(
      queued.provenance.verification_url,
      'https://musicwire.example/v1/provenance/verify',
    );
    const job = await waitForJob(base, queued.job_id);
    assert.equal(job.status, 'completed');
    assert.equal(job.provenance.receipt_id, queued.provenance.receipt_id);

    const known = await fetch(`${base}/v1/provenance/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: artifact.sha256 }),
    });
    assert.equal(known.status, 200);
    const verified = await known.json();
    assert.equal(verified.rendered_by_musicwire, true);
    assert.equal(verified.receipt_id, queued.provenance.receipt_id);
    assert.equal(verified.receipt.signature_algorithm, 'HMAC-SHA-256');
    assert.equal(verified.receipt.artifacts[0].sha256, artifact.sha256);

    const unknown = await fetch(`${base}/v1/provenance/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: 'a'.repeat(64) }),
    });
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), { rendered_by_musicwire: false });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

async function waitForJob(base, id) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await (await fetch(`${base}/v1/jobs/${id}`)).json();
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('render did not complete');
}
