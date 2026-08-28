import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createApp } from '../src/app.js';

const mscoreBin =
  process.env.MSCORE_BIN ??
  (fs.existsSync('/Applications/MuseScore 4.app/Contents/MacOS/mscore')
    ? '/Applications/MuseScore 4.app/Contents/MacOS/mscore'
    : null);
const hasCommand = (command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
const shouldRun =
  process.env.MUSICWIRE_E2E === '1' && mscoreBin && hasCommand('ffprobe') && hasCommand('ffmpeg');

const examples = [
  {
    section: 'single-instrument',
    instruments: ['Piano'],
  },
  {
    section: 'ensemble',
    instruments: ['Violin', 'Violoncello'],
  },
];

test(
  'every published MusicXML example completes through the real render path',
  {
    skip: shouldRun
      ? false
      : 'Set MUSICWIRE_E2E=1 and make MuseScore, ffprobe, and ffmpeg available to run a real renderer test.',
  },
  async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-docs-e2e-'));
    const app = createApp({
      dataDirectory,
      mscoreBin,
      mscoreArch: process.platform === 'darwin' ? 'arm64' : '',
      maxRenderSeconds: 90,
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const example of examples) {
        const section = docsSection(example.section);
        const formats = formatsFromSection(section);
        const submitted = await fetch(`${base}/v1/render`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
          body: JSON.stringify({
            musicxml: musicxmlFromSection(section),
            formats,
          }),
        });
        assert.equal(submitted.status, 202);
        const { job_id: jobId } = await submitted.json();
        const job = await waitForJob(base, jobId);
        assert.equal(job.status, 'completed', JSON.stringify(job.error));
        assert.equal(job.qc.status, 'passed');
        assert.equal(job.payment.status, 'settled');
        assert.deepEqual(job.facts.instruments, example.instruments);
        for (const format of formats) {
          const extension = format === 'midi' ? 'mid' : format;
          assert.ok(job.artifacts.some((artifact) => artifact.name === `score.${extension}`));
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  },
);

function docsSection(id) {
  const docs = fs.readFileSync(new URL('../static/docs.html', import.meta.url), 'utf8');
  const start = docs.indexOf(`<section class="section section-tight" id="${id}">`);
  assert.notEqual(start, -1, `Missing ${id} example section.`);
  const end = docs.indexOf('</section>', start);
  assert.notEqual(end, -1, `Missing closing tag for ${id} example section.`);
  return docs.slice(start, end);
}

function musicxmlFromSection(section) {
  const match = section.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/);
  assert.ok(match, 'Published example must contain MusicXML.');
  return match[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function formatsFromSection(section) {
  const match = section.match(/formats:(\[[^\]]+\])/);
  assert.ok(match, 'Published example must contain request formats.');
  return JSON.parse(match[1]);
}

async function waitForJob(base, jobId) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const job = await (await fetch(`${base}/v1/jobs/${jobId}`)).json();
    if (job.status !== 'queued' && job.status !== 'running') return job;
  }
  throw new Error(`Render job ${jobId} did not finish in time.`);
}
