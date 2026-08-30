import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
const showcaseAudioDirectory = process.env.MUSICWIRE_E2E_EXAMPLES_OUTPUT_DIR;

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
      for (const example of publishedShowcaseExamples()) {
        const job = await renderAndAssertCompleted(
          base,
          example.musicxml,
          example.formats,
          example.audioFilename,
        );
        assert.ok(
          job.facts.scoreDurationSeconds >= 45 && job.facts.scoreDurationSeconds <= 60,
          `${example.id} must be a 45-60 second written score, got ${job.facts.scoreDurationSeconds}s`,
        );
        assert.equal(job.facts.partCount, example.partCount);
      }
      const inlineJobs = [];
      for (const example of publishedInlineRenderExamples()) {
        inlineJobs.push(await renderAndAssertCompleted(base, example.musicxml, example.formats));
      }
      const shortStringJob = inlineJobs.find((job) =>
        job.facts.instruments.some((instrument) => /violin|violoncello|cello/i.test(instrument)),
      );
      assert.ok(shortStringJob, 'Published examples must include the short string score.');
      assert.ok(shortStringJob.facts.scoreDurationSeconds < 3);

      const longerStringJob = await renderAndAssertCompleted(base, longerStringMusicXml, ['mp3']);
      assert.deepEqual(longerStringJob.facts.instruments, ['Violin', 'Violoncello']);
      assert.ok(
        longerStringJob.facts.scoreDurationSeconds > shortStringJob.facts.scoreDurationSeconds,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
  },
);

function publishedShowcaseExamples() {
  const docs = fs.readFileSync(new URL('../static/docs.html', import.meta.url), 'utf8');
  const staticExamplesDirectory = fileURLToPath(new URL('../static/examples/', import.meta.url));
  const catalog = JSON.parse(
    fs.readFileSync(path.join(staticExamplesDirectory, 'catalog.json'), 'utf8'),
  );
  assert.equal(
    catalog.length,
    8,
    'The listening gallery must publish exactly eight certified tracks.',
  );
  assert.equal(
    catalog.filter((example) => example.kind === 'solo').length,
    5,
    'The listening gallery must publish five solo tracks.',
  );
  assert.equal(
    catalog.filter((example) => example.kind === 'ensemble').length,
    3,
    'The listening gallery must publish three certified ensemble tracks.',
  );
  const ensembleCombinations = catalog
    .filter((example) => example.kind === 'ensemble')
    .map((example) => example.instruments.join('|'));
  assert.ok(
    catalog
      .filter((example) => example.kind === 'ensemble')
      .every((example) => example.instruments.length > 2),
    'Every ensemble showcase must include more than two instruments.',
  );
  assert.equal(
    new Set(ensembleCombinations).size,
    3,
    'Each ensemble must use a different instrument combination.',
  );
  const soloInstruments = catalog
    .filter((example) => example.kind === 'solo')
    .map((example) => example.instruments[0].toLowerCase());
  assert.equal(new Set(soloInstruments).size, 5, 'Each solo must use a distinct instrument.');
  assert.ok(
    catalog.some((example) => /synthesized choir voice/i.test(example.description)),
    'The voice showcase must be labeled as synthesized on the site.',
  );
  assert.doesNotMatch(docs, /Lantern Call|08-ensemble-brass-lantern-call/);
  return catalog.map((example) => {
    const card = docs.match(
      new RegExp(
        `<article\\b[^>]*data-showcase-example="${example.id}"[^>]*>[\\s\\S]*?<\\/article>`,
      ),
    )?.[0];
    assert.ok(card, `${example.id} must have a documentation card.`);
    assert.match(
      card,
      /<h4>For humans<\/h4>[\s\S]*?Production recipe:/,
      `${example.id} must explain its production recipe for humans.`,
    );
    assert.match(
      card,
      /<h4>For agents<\/h4>[\s\S]*?Compose-guide note:[\s\S]*?class="render-request"/,
      `${example.id} must give agents an adaptation note and exact render request.`,
    );
    assert.match(
      card,
      new RegExp(`src="${example.audio}"`),
      `${example.id} must have an inline MP3 player.`,
    );
    assert.match(
      card,
      /<audio\b(?=[^>]*\bcontrols\b)(?=[^>]*\baria-label=)[^>]*>/,
      `${example.id} must use an obvious native audio player with a human-readable label.`,
    );
    assert.ok(
      card.includes(example.description),
      `${example.id} must state its instruments, mood, and written length beside the player.`,
    );
    assert.match(
      card,
      new RegExp(`data-musicxml-src="${example.musicxml}"`),
      `${example.id} must expose its full MusicXML below the player.`,
    );
    const musicxmlFilename = path.basename(example.musicxml);
    return {
      id: example.id,
      musicxml: fs.readFileSync(path.join(staticExamplesDirectory, musicxmlFilename), 'utf8'),
      formats: ['mp3', 'midi'],
      partCount: example.instruments.length,
      audioFilename: showcaseAudioDirectory
        ? path.join(showcaseAudioDirectory, path.basename(example.audio))
        : null,
    };
  });
}

function publishedInlineRenderExamples() {
  const docs = fs.readFileSync(new URL('../static/docs.html', import.meta.url), 'utf8');
  const sections = [...docs.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)]
    .map((match) => match[0])
    .filter((section) => /&lt;score-partwise\b/i.test(section));
  assert.ok(sections.length > 0, 'Published documentation must contain MusicXML examples.');
  return sections.flatMap((section) => {
    const codeBlocks = [...section.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map(
      (match) => match[1],
    );
    return codeBlocks.flatMap((code, index) => {
      if (!/&lt;score-partwise\b/i.test(code)) return [];
      const followingBlocks = codeBlocks.slice(index + 1);
      const nextMusicXml = followingBlocks.findIndex((block) =>
        /&lt;score-partwise\b/i.test(block),
      );
      const requestBlocks = followingBlocks.slice(
        0,
        nextMusicXml === -1 ? undefined : nextMusicXml,
      );
      const request = requestBlocks.find((block) => /formats:\s*\[[^\]]+\]/.test(block));
      assert.ok(
        request,
        'Each published MusicXML example must have its own documented render request.',
      );
      const formats = request.match(/formats:\s*(\[[^\]]+\])/)[1];
      return [
        {
          musicxml: code.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'),
          formats: JSON.parse(formats),
        },
      ];
    });
  });
}

async function renderAndAssertCompleted(base, musicxml, formats, audioFilename = null) {
  const submitted = await fetch(`${base}/v1/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Payment-Signature': 'test-payment' },
    body: JSON.stringify({ musicxml, formats }),
  });
  assert.equal(submitted.status, 202);
  const { job_id: jobId } = await submitted.json();
  const job = await waitForJob(base, jobId);
  assert.equal(job.status, 'completed', JSON.stringify(job.error));
  assert.equal(job.qc.status, 'passed');
  assert.equal(job.payment.status, 'settled');
  for (const format of formats) {
    const extension = format === 'midi' ? 'mid' : format;
    assert.ok(job.artifacts.some((artifact) => artifact.name === `score.${extension}`));
  }
  if (audioFilename) {
    const audioArtifact = job.artifacts.find((artifact) => artifact.name === 'score.mp3');
    assert.ok(audioArtifact, 'Showcase render must include an MP3.');
    const audioResponse = await fetch(`${base}${audioArtifact.url}`);
    assert.equal(audioResponse.status, 200);
    fs.mkdirSync(path.dirname(audioFilename), { recursive: true });
    fs.writeFileSync(audioFilename, Buffer.from(await audioResponse.arrayBuffer()));
  }
  return job;
}

const longerStringMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Violin</part-name></score-part>
    <score-part id="P2"><part-name>Violoncello</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="84"/></direction><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="2"><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="3"><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="4"><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure>
  </part>
  <part id="P2">
    <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="2"><note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="3"><note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="4"><note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure>
  </part>
</score-partwise>`;

async function waitForJob(base, jobId) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const job = await (await fetch(`${base}/v1/jobs/${jobId}`)).json();
    if (job.status !== 'queued' && job.status !== 'running') return job;
  }
  throw new Error(`Render job ${jobId} did not finish in time.`);
}
