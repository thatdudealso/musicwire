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

test('an S3 write failure fails the job visibly instead of crashing the render queue', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-put-fail-'));
  const s3 = new MemoryS3({ failPuts: true });
  const rejections = [];
  const recordRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', recordRejection);
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    renderer: {
      render: async () => ({ ok: true, artifacts: [], receipt: { rendered_by: 'Musicwire' } }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const job = await renderAndPoll(base, 'failed_not_charged');

    assert.equal(job.status, 'failed_not_charged');
    assert.equal(job.error.code, 'artifact_storage_unavailable');
    assert.equal(job.payment.status, 'failed_not_charged');
    assert.equal(job.receipt.tx_hash, null);

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(rejections, []);
    assert.equal((await fetch(`${base}/manifest`)).status, 200);
  } finally {
    process.off('unhandledRejection', recordRejection);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('artifact read failures report storage status rather than a parse error', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-read-fail-'));
  const s3 = new MemoryS3();
  const pdfBytes = Buffer.from('%PDF-1.7 rendered score');
  const pdf = {
    name: 'score.pdf',
    sha256: crypto.createHash('sha256').update(pdfBytes).digest('hex'),
    bytes: pdfBytes.length,
    storageKey: `artifacts/${crypto.createHash('sha256').update(pdfBytes).digest('hex')}`,
  };
  s3.seed('musicwire-test-artifacts', pdf.storageKey, pdfBytes);
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    renderer: {
      render: async () => ({ ok: true, artifacts: [pdf], receipt: { rendered_by: 'Musicwire' } }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const urlFor = (job, name) => `${base}${job.artifacts.find((item) => item.name === name).url}`;
  try {
    const job = await renderAndPoll(base, 'completed');
    const delivered = await fetch(urlFor(job, 'score.pdf'));
    assert.equal(delivered.status, 200);
    assert.match(delivered.headers.get('content-type'), /application\/pdf/);

    s3.expireEverything();
    const expired = await fetch(urlFor(job, 'receipt.json'));
    assert.equal(expired.status, 404);
    assert.equal((await expired.json()).error.code, 'artifact_expired');

    // A failed binary download must not be labelled as the binary it could not deliver.
    const expiredPdf = await fetch(urlFor(job, 'score.pdf'));
    assert.equal(expiredPdf.status, 404);
    assert.match(expiredPdf.headers.get('content-type'), /application\/json/);
    assert.equal((await expiredPdf.json()).error.code, 'artifact_expired');

    s3.breakReads();
    const unavailable = await fetch(urlFor(job, 'score.pdf'));
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers.get('content-type'), /application\/json/);
    assert.equal((await unavailable.json()).error.code, 'artifact_storage_unavailable');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

async function renderAndPoll(base, terminalStatus) {
  const queued = await (
    await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
      body: JSON.stringify({ musicxml, formats: ['pdf'] }),
    })
  ).json();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await (await fetch(`${base}/v1/jobs/${queued.job_id}`)).json();
    if (job.status === terminalStatus) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job never reached ${terminalStatus}.`);
}

class MemoryS3 {
  #objects = new Map();
  #failPuts;
  #readsBroken = false;

  constructor({ failPuts = false } = {}) {
    this.#failPuts = failPuts;
  }

  async send(command) {
    const { Bucket, Key, Body } = command.input;
    const objectKey = `${Bucket}/${Key}`;
    if (command.constructor.name === 'PutObjectCommand') {
      if (this.#failPuts) throw serviceUnavailable();
      this.#objects.set(objectKey, Buffer.from(Body));
      return {};
    }
    if (command.constructor.name === 'GetObjectCommand') {
      if (this.#readsBroken) throw serviceUnavailable();
      const value = this.#objects.get(objectKey);
      if (!value) throw noSuchKey(objectKey);
      return { Body: { transformToByteArray: async () => value } };
    }
    throw new Error(`Unexpected S3 command ${command.constructor.name}`);
  }

  get(bucket, key) {
    return this.#objects.get(`${bucket}/${key}`);
  }

  seed(bucket, key, value) {
    this.#objects.set(`${bucket}/${key}`, value);
  }

  expireEverything() {
    this.#objects.clear();
  }

  breakReads() {
    this.#readsBroken = true;
  }
}

function noSuchKey(objectKey) {
  const error = new Error(`The specified key ${objectKey} does not exist.`);
  error.name = 'NoSuchKey';
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

function serviceUnavailable() {
  const error = new Error('Please reduce your request rate.');
  error.name = 'SlowDown';
  error.$metadata = { httpStatusCode: 503 };
  return error;
}
