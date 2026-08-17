import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createApp } from '../src/app.js';

const mscoreBin = process.env.MSCORE_BIN ?? (fs.existsSync('/Applications/MuseScore 4.app/Contents/MacOS/mscore') ? '/Applications/MuseScore 4.app/Contents/MacOS/mscore' : null);
const hasCommand = (command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
const shouldRun = process.env.MUSICWIRE_E2E === '1' && mscoreBin && hasCommand('ffprobe') && hasCommand('ffmpeg');

test('real MuseScore pipeline returns content-addressed artifacts and NOTICE', { skip: shouldRun ? false : 'Set MUSICWIRE_E2E=1 and make MuseScore, ffprobe, and ffmpeg available to run a real renderer test.' }, async () => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-e2e-'));
  const app = createApp({ dataDirectory, mscoreBin, mscoreArch: process.platform === 'darwin' ? 'arm64' : '', maxRenderSeconds: 90 });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const musicxml = fs.readFileSync(new URL('./fixtures/two-bar-piano.musicxml', import.meta.url), 'utf8');
    const submitted = await fetch(`${base}/v1/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ musicxml, formats: ['pdf', 'svg', 'mp3'] }) });
    assert.equal(submitted.status, 202);
    const { job_id: jobId } = await submitted.json();
    let job;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      job = await (await fetch(`${base}/v1/jobs/${jobId}`)).json();
      if (job.status !== 'queued' && job.status !== 'running') break;
    }
    assert.equal(job.status, 'completed', JSON.stringify(job.error));
    assert.equal(job.qc.status, 'passed');
    for (const artifact of job.artifacts) assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.ok(job.artifacts.some((artifact) => artifact.name === 'NOTICE.txt'));
    assert.ok(job.artifacts.some((artifact) => artifact.name === 'score-1.svg'));
    assert.ok(job.artifacts.some((artifact) => artifact.name === 'score.mp3'));
    const notice = await fetch(`${base}${job.artifacts.find((artifact) => artifact.name === 'NOTICE.txt').url}`);
    assert.equal(notice.status, 200);
    assert.match(await notice.text(), /FluidR3/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
});
