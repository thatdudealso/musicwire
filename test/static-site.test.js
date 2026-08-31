import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
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

const chromiumCliAvailable = (process.env.PATH || '').split(path.delimiter).some((directory) => {
  try {
    fs.accessSync(path.join(directory, 'chromium-cli'), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

const runChromium = (base) =>
  new Promise((resolve, reject) => {
    const session = `musicwire-static-${process.pid}-${Date.now()}`;
    const browser = spawn('chromium-cli', ['--session', session]);
    let stdout = '';
    let stderr = '';
    browser.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    browser.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    browser.once('error', reject);
    browser.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`chromium-cli exited ${code}: ${stderr}`));
    });
    browser.stdin.end(`nav ${base}/
wait-for .play-gate
eval ({ videos: [...document.querySelectorAll('[data-player] video')].map((video) => ({ controls: video.controls, hidden: video.hidden, preload: video.preload })), mp4Requests: performance.getEntriesByType('resource').filter((entry) => entry.name.endsWith('.mp4')).length })
click .video-card.feature .play-gate
wait-for video:not([hidden])
eval new Promise((resolve) => { const video = document.querySelector('[data-player] video'); if (!video.paused) return resolve({ playing: true }); const timeout = setTimeout(() => resolve({ playing: !video.paused }), 5000); video.addEventListener('playing', () => { clearTimeout(timeout); resolve({ playing: true }); }, { once: true }); })
click .video-grid > .video-card:first-child .play-gate
eval new Promise((resolve) => { const video = document.querySelectorAll('[data-player] video')[1]; if (!video.paused) return resolve({ playing: true }); const timeout = setTimeout(() => resolve({ playing: !video.paused }), 5000); video.addEventListener('playing', () => { clearTimeout(timeout); resolve({ playing: true }); }, { once: true }); })
eval ({ first: { paused: document.querySelectorAll('[data-player] video')[0].paused }, second: { controls: document.querySelectorAll('[data-player] video')[1].controls, hidden: document.querySelectorAll('[data-player] video')[1].hidden, paused: document.querySelectorAll('[data-player] video')[1].paused, preload: document.querySelectorAll('[data-player] video')[1].preload } })
`);
  });

const browserResults = (stdout) => {
  const lines = stdout.trim().split('\n');
  for (const line of lines) {
    assert.ok(
      ['nav ok: ', 'wait-for ok: ', 'click ok: ', 'eval: '].some((prefix) =>
        line.startsWith(prefix),
      ),
      `unexpected chromium-cli output: ${line}`,
    );
  }
  return lines
    .filter((line) => line.startsWith('eval: '))
    .map((line) => JSON.parse(line.slice('eval: '.length)));
};

const createPlayer = () => {
  const listeners = new Map();
  const video = {
    controls: true,
    hidden: true,
    paused: true,
    pauseCalls: 0,
    playCalls: 0,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    emit(type) {
      listeners.get(type)?.();
    },
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    play() {
      this.playCalls += 1;
      this.paused = false;
      this.emit('play');
      return Promise.resolve();
    },
  };
  const gateListeners = new Map();
  const gate = {
    hidden: false,
    addEventListener(type, listener) {
      gateListeners.set(type, listener);
    },
    click() {
      gateListeners.get('click')?.();
    },
  };
  return {
    gate,
    video,
    querySelector(selector) {
      return selector === '.play-gate' ? gate : selector === 'video' ? video : null;
    },
  };
};

const loadPlayerBindings = (players) => {
  const listeners = new Map();
  const document = {
    body: { classList: { add() {}, remove() {} } },
    querySelectorAll(selector) {
      return selector === '[data-player]' ? players : [];
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    get readyState() {
      return 'loading';
    },
  };
  const context = vm.createContext({
    AbortController,
    document,
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}), ok: true }),
    setTimeout,
    clearTimeout,
  });
  const scriptPath = new URL('../static/app.js', import.meta.url);
  new vm.Script(fs.readFileSync(scriptPath, 'utf8')).runInContext(context);
  listeners.get('DOMContentLoaded')();
};

test('landing page, docs page, and static assets are served', async () => {
  const { server, base } = await startServer();
  try {
    const landing = await fetch(`${base}/`);
    assert.equal(landing.status, 200);
    assert.match(landing.headers.get('content-type'), /text\/html/);
    const landingHtml = await landing.text();
    assert.match(landingHtml, /Make music your agent can/);
    assert.match(landingHtml, /MP3 is for listening\. MIDI is for editing/);
    assert.match(landingHtml, /Open the listening gallery/);
    assert.doesNotMatch(landingHtml, /PDF, SVG, PNG, MSCZ/);
    assert.match(landingHtml, /musicwire-favicon\.svg/);

    const demoVideo = await fetch(`${base}/demo/agent-flow-16x9.mp4`);
    assert.equal(demoVideo.status, 200);
    assert.match(demoVideo.headers.get('content-type'), /^video\/mp4/);
    const demoPoster = await fetch(`${base}/demo/agent-flow.jpg`);
    assert.equal(demoPoster.status, 200);
    assert.match(demoPoster.headers.get('content-type'), /^image\/jpeg/);
    for (const slug of [
      'edm-festival-anthem',
      'metalcore-gym-pump',
      'country-modern-drive',
      'spanish-reggaeton-dembow',
    ]) {
      assert.equal((await fetch(`${base}/demo/${slug}-16x9.mp4`)).status, 200);
      assert.equal((await fetch(`${base}/demo/${slug}.jpg`)).status, 200);
    }

    const docs = await fetch(`${base}/docs`);
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get('content-type'), /text\/html/);
    const docsHtml = await docs.text();
    assert.match(docsHtml, /Connect, request, pay, receive, listen/);
    assert.match(docsHtml, /Nine complete scores, ready to hear and reuse/);
    assert.match(docsHtml, /Wordless synthesized choir voice/);
    assert.match(docsHtml, /Driving house\/EDM with synth bass, lead, pad, and drum kit/);
    assert.match(docsHtml, /aria-label="Sunroom Parade - bright happy solo piano, 50 seconds"/);
    assert.match(docsHtml, /Solo piano in C major/);
    assert.match(docsHtml, /Violin and cello in two parts/);
    assert.match(docsHtml, /mp3<\/code> so a human can listen and <code>midi<\/code>/);
    assert.doesNotMatch(docsHtml, /Request PDF/);

    const styles = await fetch(`${base}/styles.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    const script = await fetch(`${base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);

    const showcaseMusicXml = await fetch(`${base}/examples/01-solo-violin-moonlit-thread.musicxml`);
    assert.equal(showcaseMusicXml.status, 200);
    assert.match(await showcaseMusicXml.text(), /<work-title>Moonlit Thread<\/work-title>/);

    const showcaseAudio = await fetch(`${base}/examples/01-solo-violin-moonlit-thread.mp3`);
    assert.equal(showcaseAudio.status, 200);
    assert.match(showcaseAudio.headers.get('content-type'), /^audio\/mpeg/);

    const edmMusicXml = await fetch(`${base}/examples/08-ensemble-house-edm-lantern-call.musicxml`);
    assert.equal(edmMusicXml.status, 200);
    assert.match(await edmMusicXml.text(), /<work-title>Lantern Call<\/work-title>/);

    const favicon = await fetch(`${base}/musicwire-favicon.svg`);
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get('content-type'), /^image\/svg\+xml/);

    const socialCard = await fetch(`${base}/musicwire-social-card.png`);
    assert.equal(socialCard.status, 200);
    assert.match(socialCard.headers.get('content-type'), /^image\/png/);

    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /User-agent: \*/);

    const llms = await fetch(`${base}/llms.txt`);
    assert.equal(llms.status, 200);
    assert.match(await llms.text(), /musicwire renders MusicXML/);

    const missing = await fetch(`${base}/no-such-page.html`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('landing video gates reveal native players and keep one playing', () => {
  const first = createPlayer();
  const second = createPlayer();
  loadPlayerBindings([first, second]);

  first.gate.click();
  assert.equal(first.gate.hidden, true);
  assert.equal(first.video.hidden, false);
  assert.equal(first.video.controls, true);
  assert.equal(first.video.playCalls, 1);
  assert.equal(first.video.paused, false);
  assert.equal(second.video.paused, true);

  second.gate.click();
  assert.equal(second.gate.hidden, true);
  assert.equal(second.video.hidden, false);
  assert.equal(second.video.controls, true);
  assert.equal(second.video.playCalls, 1);
  assert.equal(second.video.paused, false);
  assert.equal(first.video.paused, true);
  assert.ok(first.video.pauseCalls > 0);
});

test('landing video gates lazily activate one native player at a time', { skip: !chromiumCliAvailable }, async () => {
  const { server, base } = await startServer();
  try {
    const [initial, firstPlaying, secondPlaying, secondActive] = browserResults(
      await runChromium(base),
    );

    assert.equal(initial.videos.length, 5);
    assert.deepEqual(initial.videos, Array(5).fill({ controls: true, hidden: true, preload: 'none' }));
    assert.equal(initial.mp4Requests, 0);

    assert.deepEqual(firstPlaying, { playing: true });
    assert.deepEqual(secondPlaying, { playing: true });
    assert.deepEqual(secondActive, {
      first: { paused: true },
      second: { controls: true, hidden: false, paused: false, preload: 'none' },
    });
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
