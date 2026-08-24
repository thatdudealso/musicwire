import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { XMLValidator } from 'fast-xml-parser';
import { createApp } from '../src/app.js';
import { checkAudioDuration, probeAudio, verifyNonSilent } from '../src/qc.js';
import { scoreFacts } from '../src/validate.js';

const mscoreBin =
  process.env.MSCORE_BIN ??
  (fs.existsSync('/Applications/MuseScore 4.app/Contents/MacOS/mscore')
    ? '/Applications/MuseScore 4.app/Contents/MacOS/mscore'
    : null);
const hasCommand = (command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
const shouldRun =
  process.env.MUSICWIRE_E2E === '1' && mscoreBin && hasCommand('ffprobe') && hasCommand('ffmpeg');
const evidenceDirectory = process.env.MUSICWIRE_E2E_EVIDENCE_DIR;

function preserveEvidence(name, bytes) {
  if (!evidenceDirectory) return;
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, path.basename(name)), bytes);
}

test(
  'real MuseScore production render path quality-checks every advertised artifact',
  {
    skip: shouldRun
      ? false
      : 'Set MUSICWIRE_E2E=1 and make MuseScore, ffprobe, and ffmpeg available to run a real renderer test.',
  },
  async () => {
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-e2e-'));
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
      const musicxml = fs.readFileSync(
        new URL('./fixtures/two-bar-piano.musicxml', import.meta.url),
        'utf8',
      );
      const facts = scoreFacts(musicxml);
      const submitted = await fetch(`${base}/v1/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
        body: JSON.stringify({
          musicxml,
          formats: ['mscz', 'pdf', 'svg', 'png', 'midi', 'mp3'],
          constraints_check: {
            tempo: facts.tempo,
            key_fifths: facts.key.fifths,
            mode: facts.key.mode,
            duration_seconds: facts.scoreDurationSeconds,
          },
        }),
      });
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
      assert.equal(job.payment.status, 'settled');
      assert.equal(job.receipt.status, job.payment.status);
      assert.equal(job.facts.partCount, 1);
      assert.equal(job.facts.tempo, 30);
      assert.deepEqual(job.facts.key, { fifths: 0, mode: 'major' });
      for (const artifact of job.artifacts) assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'NOTICE.txt'));
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'score.mscz'));
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'score.pdf'));
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'score-1.svg'));
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'score-1.png'));
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'score.mid'));
      assert.ok(job.artifacts.some((artifact) => artifact.name === 'score.mp3'));
      const download = async (name) => {
        const artifact = job.artifacts.find((item) => item.name === name);
        assert.ok(artifact, `Missing ${name}`);
        const response = await fetch(`${base}${artifact.url}`);
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        preserveEvidence(name, bytes);
        return bytes;
      };
      const source = await download('source.musicxml');
      assert.equal(XMLValidator.validate(source.toString('utf8')), true);
      assert.match(source.toString('utf8'), /<software>Musicwire/);
      assert.equal((await download('score.mscz')).subarray(0, 2).toString(), 'PK');
      const mscz = path.join(dataDirectory, 'score.mscz');
      fs.writeFileSync(mscz, await download('score.mscz'));
      assert.match(
        spawnSync('unzip', ['-p', mscz, 'score.mscx'], { encoding: 'utf8' }).stdout,
        /Musicwire/,
      );
      const pdf = await download('score.pdf');
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.match(pdf.toString('latin1'), /\/Creator \(Musicwire\)/);
      const svg = (await download('score-1.svg')).toString('utf8');
      assert.equal(XMLValidator.validate(svg), true);
      assert.match(svg, /<svg\b/i);
      assert.match(svg, /<metadata>Rendered by Musicwire/);
      const png = await download('score-1.png');
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.match(png.toString('latin1'), /MusicwireReceipt/);
      const midi = await download('score.mid');
      assert.equal(midi.subarray(0, 4).toString(), 'MThd');
      assert.match(midi.toString('utf8'), /Musicwire/);
      for (const name of ['score.mp3']) {
        const destination = path.join(dataDirectory, name);
        fs.writeFileSync(destination, await download(name));
        const audio = await probeAudio('ffprobe', destination);
        assert.equal(audio.ok, true, JSON.stringify(audio));
        assert.ok(audio.channels >= 1);
        assert.ok(audio.sampleRate >= 8_000);
        assert.equal(checkAudioDuration(facts.scoreDurationSeconds, audio.duration, 2).ok, true);
        const nonSilent = await verifyNonSilent('ffmpeg', destination);
        assert.equal(nonSilent.ok, true, JSON.stringify(nonSilent));
        assert.equal(audio.tags?.encoded_by, 'Musicwire');
        assert.match(audio.tags?.comment ?? '', /Musicwire/);
      }
      const notice = await fetch(
        `${base}${job.artifacts.find((artifact) => artifact.name === 'NOTICE.txt').url}`,
      );
      assert.equal(notice.status, 200);
      const noticeText = await notice.text();
      assert.match(noticeText, /FluidR3/);
      assert.match(noticeText, /Render receipt:/);
      assert.match(noticeText, /\/v1\/provenance\/verify/);

      const receipt = JSON.parse((await download('receipt.json')).toString('utf8'));
      assert.equal(receipt.provenance.receipt_id, job.provenance.receipt_id);
      assert.equal(receipt.provenance.rendered_by, 'Musicwire');
      for (const artifact of job.artifacts.filter(
        (item) => item.name !== 'NOTICE.txt' && item.name !== 'receipt.json',
      )) {
        const verification = await fetch(`${base}/v1/provenance/verify`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sha256: artifact.sha256 }),
        });
        assert.equal(verification.status, 200);
        const result = await verification.json();
        assert.equal(result.rendered_by_musicwire, true);
        assert.equal(result.receipt_id, job.provenance.receipt_id);
        assert.ok(result.receipt.artifacts.some((item) => item.sha256 === artifact.sha256));
      }
      const unknownVerification = await fetch(`${base}/v1/provenance/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha256: 'a'.repeat(64) }),
      });
      assert.equal(unknownVerification.status, 200);
      assert.deepEqual(await unknownVerification.json(), { rendered_by_musicwire: false });

      const rejected = await fetch(`${base}/v1/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
        body: JSON.stringify({
          musicxml,
          formats: ['pdf'],
          constraints_check: { tempo: facts.tempo + 10 },
        }),
      });
      assert.equal(rejected.status, 202);
      const { job_id: rejectedJobId } = await rejected.json();
      let rejectedJob;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        rejectedJob = await (await fetch(`${base}/v1/jobs/${rejectedJobId}`)).json();
        if (rejectedJob.status !== 'queued' && rejectedJob.status !== 'running') break;
      }
      assert.equal(rejectedJob.status, 'failed_not_charged', JSON.stringify(rejectedJob));
      assert.equal(rejectedJob.error.code, 'constraints_mismatch');
      assert.equal(rejectedJob.payment.status, 'failed_not_charged');
      assert.equal(rejectedJob.receipt.tx_hash, null);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  },
);
