import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
eval () => ({ videos: [...document.querySelectorAll('[data-player] video')].map((video) => ({ controls: video.controls, hidden: video.hidden, preload: video.preload })), mp4Requests: performance.getEntriesByType('resource').filter((entry) => entry.name.endsWith('.mp4')).length })
click .video-card.feature .play-gate
wait-for video:not([hidden])
wait 500
eval () => { const [first, second] = document.querySelectorAll('[data-player] video'); return { first: { controls: first.controls, hidden: first.hidden, paused: first.paused, preload: first.preload }, second: { hidden: second.hidden, paused: second.paused } }; }
click .video-grid > .video-card:first-child .play-gate
wait 500
eval () => { const [first, second] = document.querySelectorAll('[data-player] video'); return { first: { paused: first.paused }, second: { controls: second.controls, hidden: second.hidden, paused: second.paused, preload: second.preload } }; }
`);
  });

const browserResults = (stdout) => {
  assert.doesNotMatch(stdout, /^error:/m, stdout);
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('eval: '))
    .map((line) => JSON.parse(line.slice('eval: '.length)));
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

test('landing video gates lazily activate one native player at a time', async () => {
  const { server, base } = await startServer();
  try {
    const [initial, firstActive, secondActive] = browserResults(await runChromium(base));

    assert.equal(initial.videos.length, 5);
    assert.deepEqual(initial.videos, Array(5).fill({ controls: true, hidden: true, preload: 'none' }));
    assert.equal(initial.mp4Requests, 0);

    assert.deepEqual(firstActive, {
      first: { controls: true, hidden: false, paused: false, preload: 'none' },
      second: { hidden: true, paused: true },
    });
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
