import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createApp } from '../src/app.js';

const musicxml = fs.readFileSync(
  new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
  'utf8',
);

test('public API publishes the Phase 2 Base Sepolia prices', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-prices-'));
  const server = createApp({
    dataDirectory,
    renderer: { render: async () => ({ ok: false, error: { code: 'test_renderer' } }) },
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const multiPartMusicxml = musicxml
    .replace(
      '</part-list>',
      '<score-part id="P2"><part-name>Flute</part-name></score-part></part-list>',
    )
    .replace(
      '</score-partwise>',
      '<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration></note></measure></part></score-partwise>',
    );
  const render = (score) =>
    fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
      body: JSON.stringify({ musicxml: score, formats: ['pdf'] }),
    });
  try {
    const manifest = await (await fetch(`${base}/manifest`)).json();
    assert.equal(manifest.endpoints.validate.price_usd, '0.10');
    assert.deepEqual(manifest.endpoints.render.price_usd, {
      solo: '0.25',
      multi_instrument: '0.50',
      part_boundary: 1,
    });
    assert.equal(manifest.payment.network, 'eip155:84532');
    assert.equal(manifest.payment.asset, 'USDC');
    const paymentDescription = await (await fetch(`${base}/.well-known/x402`)).json();
    assert.equal(paymentDescription.network, 'eip155:84532');
    assert.equal(paymentDescription.capture_policy, 'only_after_qc_pass');
    assert.equal(paymentDescription.receiver.network, 'eip155:84532');
    const validation = await (
      await fetch(`${base}/v1/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
        body: JSON.stringify({ musicxml }),
      })
    ).json();
    assert.equal(validation.price_usd, '0.10');
    assert.equal((await (await render(musicxml)).json()).price_usd, '0.25');
    assert.equal((await (await render(multiPartMusicxml)).json()).price_usd, '0.50');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('render requires JSON and at least one output format before queuing', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-render-request-'));
  const server = createApp({ dataDirectory }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const raw = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body: musicxml,
    });
    assert.equal(raw.status, 415);
    assert.equal((await raw.json()).error.code, 'render_json_required');
    const empty = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml, formats: [] }),
    });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'invalid_formats');
    const malformedConstraint = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        musicxml,
        formats: ['pdf'],
        constraints_check: { duration_seconds: 'not-a-number' },
      }),
    });
    assert.equal(malformedConstraint.status, 400);
    assert.equal((await malformedConstraint.json()).error.code, 'invalid_constraints');
    const nullConstraint = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml, formats: ['pdf'], constraints_check: null }),
    });
    assert.equal(nullConstraint.status, 400);
    assert.equal((await nullConstraint.json()).error.code, 'invalid_constraints');
    const navigation = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        musicxml: musicxml.replace('<sound tempo="90"/>', '<sound tempo="90" dacapo="yes"/>'),
        formats: ['mp3'],
      }),
    });
    assert.equal(navigation.status, 422);
    assert.equal((await navigation.json()).error.code, 'score_duration_model_unsupported');
    const fineNavigation = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        musicxml: musicxml.replace('<sound tempo="90"/>', '<sound tempo="90" fine="yes"/>'),
        formats: ['mp3'],
      }),
    });
    assert.equal(fineNavigation.status, 422);
    assert.equal((await fineNavigation.json()).error.code, 'score_duration_model_unsupported');
    const wordsNavigation = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        musicxml: musicxml.replace(
          '<sound tempo="90"/>',
          '<sound tempo="90"/><direction><direction-type><words>D.C. al Fine</words></direction-type></direction>',
        ),
        formats: ['mp3'],
      }),
    });
    assert.equal(wordsNavigation.status, 422);
    assert.equal((await wordsNavigation.json()).error.code, 'score_duration_model_unsupported');
    const constrainedNavigation = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        musicxml: musicxml.replace(
          '<sound tempo="90"/>',
          '<sound tempo="90"/><direction><direction-type><words>Fine</words></direction-type></direction>',
        ),
        formats: ['pdf'],
        constraints_check: { tempo: 90 },
      }),
    });
    assert.equal(constrainedNavigation.status, 422);
    assert.equal(
      (await constrainedNavigation.json()).error.code,
      'score_duration_model_unsupported',
    );
    const invalidMode = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml, formats: ['pdf'], constraints_check: { mode: 'dorian' } }),
    });
    assert.equal(invalidMode.status, 400);
    assert.equal((await invalidMode.json()).error.code, 'invalid_constraints');
    const unknownConstraint = await fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml, formats: ['pdf'], constraints_check: { duration: 30 } }),
    });
    assert.equal(unknownConstraint.status, 400);
    assert.equal((await unknownConstraint.json()).error.code, 'invalid_constraints');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('health coalesces concurrent readiness checks', async () => {
  let probes = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-health-'));
  const server = createApp({
    dataDirectory,
    readinessProbe: async () => {
      probes += 1;
      await pending;
      return [true, true];
    },
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const requests = [fetch(`${base}/health`), fetch(`${base}/health`)];
    await new Promise((resolve) => {
      const waitForProbe = () => {
        if (probes === 1) resolve();
        else setImmediate(waitForProbe);
      };
      waitForProbe();
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(probes, 1);
    release();
    const responses = await Promise.all(requests);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('production startup requires a non-development artifact signing secret', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "import './src/config.js'"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', ARTIFACT_SIGNING_SECRET: '' },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /ARTIFACT_SIGNING_SECRET/);
});

test('production startup requires CDP credentials for x402 payments', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "import './src/config.js'"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ARTIFACT_SIGNING_SECRET: 'production-test-secret',
        MUSICWIRE_PAYMENT_MODE: 'x402',
        CDP_WALLET_SECRET: '',
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /CDP_WALLET_SECRET/);
});

test('production startup refuses stub payments', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "import './src/config.js'"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ARTIFACT_SIGNING_SECRET: 'production-test-secret',
        MUSICWIRE_PAYMENT_MODE: 'stub',
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr.toString(), /MUSICWIRE_PAYMENT_MODE=x402/);
});

test('render rejects requests once the pending backlog is full', async () => {
  let releaseRender;
  const renderStarted = new Promise((resolve) => {
    releaseRender = resolve;
  });
  let started;
  const startedRender = new Promise((resolve) => {
    started = resolve;
  });
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-render-backlog-'));
  const server = createApp({
    dataDirectory,
    maxPendingRenders: 1,
    renderer: {
      render: async () => {
        started();
        await renderStarted;
        return { ok: false, error: { code: 'test_renderer' } };
      },
    },
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (idempotencyKey) =>
    fetch(`${base}/v1/render`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Payment-Signature': 'test-payment',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ musicxml, formats: ['pdf'] }),
    });
  try {
    const accepted = await request('retry-under-overload');
    assert.equal(accepted.status, 202);
    const original = await accepted.json();
    await startedRender;
    assert.equal((await request()).status, 202);
    const overloaded = await request();
    assert.equal(overloaded.status, 503);
    assert.equal((await overloaded.json()).error.code, 'render_queue_full');
    const replay = await request('retry-under-overload');
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).job_id, original.job_id);
  } finally {
    releaseRender();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('render rejects audio whose repeat expansion exceeds the configured limit', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-repeat-limit-'));
  const server = createApp({ dataDirectory, maxPlaybackMeasures: 3 }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const repeated = musicxml
    .replace(
      '<measure number="1">',
      '<measure number="1"><barline location="left"><repeat direction="forward"/></barline>',
    )
    .replace(
      '<barline location="right"><bar-style>',
      '<barline location="right"><repeat direction="backward"/><bar-style>',
    );
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml: repeated, formats: ['mp3'] }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'score_duration_model_unsupported');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('render rejects audio whose replayed tempo events exceed the configured limit', async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-tempo-event-limit-'));
  const server = createApp({
    dataDirectory,
    maxPlaybackMeasures: 20,
    maxPlaybackTempoEvents: 1,
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const repeated = musicxml
    .replace(
      '<measure number="1">',
      '<measure number="1"><barline location="left"><repeat direction="forward"/></barline>',
    )
    .replace(
      '<barline location="right"><bar-style>',
      '<barline location="right"><repeat direction="backward"/><bar-style>',
    );
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ musicxml: repeated, formats: ['mp3'] }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'score_duration_model_unsupported');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
