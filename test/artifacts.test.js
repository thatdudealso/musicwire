import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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

test('the API delivers a signed S3 artifact by redirect, including one over 10 MB', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-api-'));
  const s3 = new MemoryS3();
  // Larger than the API Gateway 10 MB payload quota the redirect exists to avoid.
  const bytes = Buffer.alloc(11 * 1024 * 1024, 'mp3-audio-payload');
  const artifact = storedArtifact('score.mp3', bytes);
  s3.seed('musicwire-test-artifacts', artifact.storageKey, bytes);
  const objectStore = await startObjectServer(s3, 'musicwire-test-artifacts');
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    presigner: objectStore.presigner,
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
    const job = await renderAndPoll(base, 'completed');
    const signedUrl = `${base}${job.artifacts.find((item) => item.name === 'score.mp3').url}`;

    const redirect = await fetch(signedUrl, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    const location = redirect.headers.get('location');
    assert.match(location, /X-Amz-Expires=900/);
    const presigned = new URL(location);
    assert.equal(presigned.searchParams.get('response-content-type'), 'audio/mpeg');
    assert.equal(
      presigned.searchParams.get('response-content-disposition'),
      'attachment; filename="score.mp3"',
    );
    assert.equal(Number(redirect.headers.get('content-length') ?? 0) < bytes.length, true);

    const delivered = await fetch(signedUrl);
    assert.equal(delivered.status, 200);
    assert.equal(delivered.headers.get('content-type'), 'audio/mpeg');
    assert.equal(delivered.headers.get('content-disposition'), 'attachment; filename="score.mp3"');
    assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), bytes);
    assert.deepEqual(s3.headedKeys, [artifact.storageKey, artifact.storageKey]);
    assert.deepEqual(objectStore.servedKeys, [artifact.storageKey]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await objectStore.close();
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('an expired S3 artifact answers the documented JSON 404 before redirecting', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-expired-api-'));
  const s3 = new MemoryS3();
  const artifact = storedArtifact('score.pdf', Buffer.from('%PDF-1.7 expired score'));
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    presigner: async () => 'https://s3.invalid/should-not-be-issued',
    renderer: {
      render: async () => ({ ok: true, artifacts: [artifact], receipt: {} }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const job = await renderAndPoll(base, 'completed');
    const response = await fetch(
      `${base}${job.artifacts.find((item) => item.name === 'score.pdf').url}`,
      { redirect: 'manual' },
    );

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).error.code, 'artifact_expired');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('an unsigned or tampered artifact request never reaches S3', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-authz-'));
  const s3 = new MemoryS3();
  const bytes = Buffer.from('private score bytes');
  const artifact = storedArtifact('score.pdf', bytes);
  s3.seed('musicwire-test-artifacts', artifact.storageKey, bytes);
  const presigned = [];
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    presigner: async (_client, command) => {
      presigned.push(command.input.Key);
      return 'https://s3.invalid/should-not-be-issued';
    },
    renderer: {
      render: async () => ({ ok: true, artifacts: [artifact], receipt: {} }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const job = await renderAndPoll(base, 'completed');
    const signedUrl = new URL(
      `${base}${job.artifacts.find((item) => item.name === 'score.pdf').url}`,
    );

    const unsigned = await fetch(`${signedUrl.origin}${signedUrl.pathname}`, {
      redirect: 'manual',
    });
    assert.equal(unsigned.status, 403);
    assert.equal((await unsigned.json()).error.code, 'artifact_access_denied');

    const tampered = new URL(signedUrl);
    tampered.searchParams.set('token', 'not-the-signature');
    assert.equal((await fetch(tampered, { redirect: 'manual' })).status, 403);

    assert.deepEqual(presigned, []);
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

test('the store reports a missing object as expired and a transient fault as unavailable', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-s3-read-fail-'));
  const s3 = new MemoryS3();
  const store = new ArtifactStore(dataDirectory, 'test-signing-secret', 30, {
    bucket: 'musicwire-test-artifacts',
    s3Client: s3,
  });
  try {
    const artifact = await store.put('score.pdf', Buffer.from('%PDF-1.7 rendered score'));
    assert.deepEqual(await store.read(artifact), Buffer.from('%PDF-1.7 rendered score'));

    s3.expireEverything();
    await assert.rejects(store.read(artifact), (error) => {
      assert.equal(error.code, 'artifact_expired');
      assert.equal(error.expired, true);
      return true;
    });

    s3.breakReads();
    await assert.rejects(store.read(artifact), (error) => {
      assert.equal(error.code, 'artifact_storage_unavailable');
      assert.equal(error.expired, false);
      return true;
    });
  } finally {
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('a locally stored artifact that expired answers 404 as JSON, not as its own media type', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-local-expired-'));
  const localStore = new ArtifactStore(dataDirectory, 'unused-for-writes', 30, {});
  const artifact = await localStore.put('score.pdf', Buffer.from('%PDF-1.7 rendered score'));
  const listening = createApp({
    dataDirectory,
    artifactStorage: 'local',
    renderer: {
      render: async () => ({
        ok: true,
        artifacts: [artifact],
        receipt: { rendered_by: 'Musicwire' },
      }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => listening.once('listening', resolve));
  const base = `http://127.0.0.1:${listening.address().port}`;
  const urlFor = (job, name) => `${base}${job.artifacts.find((item) => item.name === name).url}`;
  try {
    const job = await renderAndPoll(base, 'completed');
    const delivered = await fetch(urlFor(job, 'score.pdf'));
    assert.equal(delivered.status, 200);
    assert.match(delivered.headers.get('content-type'), /application\/pdf/);

    fs.rmSync(path.join(dataDirectory, 'artifacts'), { recursive: true, force: true });

    // A failed binary download must not be labelled as the binary it could not deliver.
    const expired = await fetch(urlFor(job, 'score.pdf'));
    assert.equal(expired.status, 404);
    assert.match(expired.headers.get('content-type'), /application\/json/);
    assert.equal((await expired.json()).error.code, 'artifact_expired');
  } finally {
    await new Promise((resolve) => listening.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('a presign failure answers 503 as JSON rather than the artifact media type', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-presign-fail-'));
  const s3 = new MemoryS3();
  const bytes = Buffer.from('%PDF-1.7 rendered score');
  const artifact = storedArtifact('score.pdf', bytes);
  s3.seed('musicwire-test-artifacts', artifact.storageKey, bytes);
  const server = createApp({
    dataDirectory,
    artifactStorage: 's3',
    artifactBucket: 'musicwire-test-artifacts',
    s3Client: s3,
    presigner: async () => {
      throw new Error('credentials could not be resolved');
    },
    renderer: {
      render: async () => ({ ok: true, artifacts: [artifact], receipt: {} }),
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const job = await renderAndPoll(base, 'completed');
    const response = await fetch(
      `${base}${job.artifacts.find((item) => item.name === 'score.pdf').url}`,
      { redirect: 'manual' },
    );

    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).error.code, 'artifact_storage_unavailable');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

function storedArtifact(name, bytes) {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  return { name, sha256: hash, bytes: bytes.length, storageKey: `artifacts/${hash}` };
}

// Stands in for S3 itself: the presigned URL is fetched directly by the caller,
// so nothing about the object's size passes back through the Musicwire process.
async function startObjectServer(s3, bucket) {
  const servedKeys = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://objects.test');
    const key = decodeURIComponent(url.pathname.slice(1));
    const value = s3.get(bucket, key);
    if (!value) {
      response.writeHead(404).end();
      return;
    }
    servedKeys.push(key);
    response
      .writeHead(200, {
        'content-type': url.searchParams.get('response-content-type') ?? 'application/octet-stream',
        'content-disposition': url.searchParams.get('response-content-disposition') ?? '',
      })
      .end(value);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    servedKeys,
    presigner: async (_client, command, { expiresIn }) => {
      const query = new URLSearchParams({ 'X-Amz-Expires': String(expiresIn) });
      if (command.input.ResponseContentType)
        query.set('response-content-type', command.input.ResponseContentType);
      if (command.input.ResponseContentDisposition)
        query.set('response-content-disposition', command.input.ResponseContentDisposition);
      return `${origin}/${encodeURIComponent(command.input.Key)}?${query}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

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
  headedKeys = [];

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
    if (command.constructor.name === 'HeadObjectCommand') {
      this.headedKeys.push(Key);
      if (this.#readsBroken) throw serviceUnavailable();
      if (!this.#objects.has(objectKey)) throw noSuchKey(objectKey);
      return {};
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
