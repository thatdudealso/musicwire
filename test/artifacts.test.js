import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtifactStore } from '../src/artifacts.js';
import { createApp } from '../src/app.js';

const musicxml = fs.readFileSync(
  new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
  'utf8',
);

test('S3 artifact storage survives replacement of the API task', async () => {
  const firstDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-first-'));
  const replacementDataDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'musicwire-s3-replacement-'),
  );
  const s3 = new MemoryS3();
  const bytes = Buffer.from('durable score artifact');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  try {
    const firstTask = new ArtifactStore(firstDataDirectory, 'test-signing-secret', 30, {
      bucket: 'musicwire-test-artifacts',
      s3Client: s3,
    });
    const artifact = await firstTask.put('score.pdf', bytes);

    assert.deepEqual(artifact, {
      name: 'score.pdf',
      sha256: hash,
      bytes: bytes.length,
      storageKey: `artifacts/${hash}`,
    });
    assert.equal(
      s3.get('musicwire-test-artifacts', `artifacts/${hash}`).toString(),
      bytes.toString(),
    );
    assert.equal(fs.existsSync(path.join(firstDataDirectory, 'artifacts', hash)), false);

    const replacementTask = new ArtifactStore(replacementDataDirectory, 'test-signing-secret', 30, {
      bucket: 'musicwire-test-artifacts',
      s3Client: s3,
    });
    assert.deepEqual(await replacementTask.read(artifact), bytes);
  } finally {
    fs.rmSync(firstDataDirectory, { recursive: true, force: true });
    fs.rmSync(replacementDataDirectory, { recursive: true, force: true });
  }
});

test('the API streams a signed artifact from S3', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-api-'));
  const s3 = new MemoryS3();
  const bytes = Buffer.from('score delivered from S3');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const artifact = {
    name: 'score.pdf',
    sha256: hash,
    bytes: bytes.length,
    storageKey: `artifacts/${hash}`,
  };
  await s3.send(
    new (class PutObjectCommand {
      constructor(input) {
        this.input = input;
      }
    })({ Bucket: 'musicwire-test-artifacts', Key: artifact.storageKey, Body: bytes }),
  );
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [artifact],
        receipt: { rendered_by: 'Musicwire' },
      }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const queued = await (
      await fetch(`${base}/v1/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
        body: JSON.stringify({ musicxml, formats: ['pdf'] }),
      })
    ).json();
    let job;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      job = await (await fetch(`${base}/v1/jobs/${queued.job_id}`)).json();
      if (job.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(job.status, 'completed');
    const delivered = await fetch(
      `${base}${job.artifacts.find((item) => item.name === 'score.pdf').url}`,
    );
    assert.equal(delivered.status, 200);
    assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), bytes);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

class MemoryS3 {
  #objects = new Map();

  async send(command) {
    const { Bucket, Key, Body } = command.input;
    const objectKey = `${Bucket}/${Key}`;
    if (command.constructor.name === 'PutObjectCommand') {
      this.#objects.set(objectKey, Buffer.from(Body));
      return {};
    }
    if (command.constructor.name === 'GetObjectCommand') {
      const value = this.#objects.get(objectKey);
      if (!value) throw new Error(`Missing object ${objectKey}`);
      return { Body: { transformToByteArray: async () => value } };
    }
    throw new Error(`Unexpected S3 command ${command.constructor.name}`);
  }

  get(bucket, key) {
    return this.#objects.get(`${bucket}/${key}`);
  }
}
