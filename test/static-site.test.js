import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';

const startServer = (overrides = {}) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-static-'));
  const server = createApp({
    dataDirectory,
    renderer: { render: async () => ({ ok: false, error: { code: 'test_renderer' } }) },
    ...overrides,
  }).listen(0, '127.0.0.1');
  return new Promise((resolve) =>
    server.once('listening', () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
};

test('landing page, docs page, and static assets are served', async () => {
  const { server, base } = await startServer();
  try {
    const landing = await fetch(`${base}/`);
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get('content-type'), /text\/html/);
    assert.match(await landing.text(), /<h1>Musicwire<\/h1>/);

    const docs = await fetch(`${base}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get('content-type'), /text\/html/);
    assert.match(await docs.text(), /<h1>Musicwire Documentation<\/h1>/);

    const styles = await fetch(`${base}/styles.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const script = await fetch(`${base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);

    const missing = await fetch(`${base}/no-such-page.html`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('static pages bypass the API rate limiter while API routes stay limited', async () => {
  const { server, base } = await startServer({ requestsPerMinute: 2 });
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await fetch(`${base}/`)).status, 200);
      assert.equal((await fetch(`${base}/docs`)).status, 200);
      assert.equal((await fetch(`${base}/styles.css`)).status, 200);
      const logo = await fetch(`${base}/musicwire-mark.svg`);
      assert.equal(logo.status, 200);
      assert.match(logo.headers.get('content-type'), /^image\/svg\+xml/);
    }
    const first = await fetch(`${base}/manifest`);
    assert.equal(first.status, 200);
    const second = await fetch(`${base}/manifest`);
    assert.equal(second.status, 200);
    const third = await fetch(`${base}/manifest`);
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error.code, 'rate_limited');
  } finally {
    server.close();
  }
});
