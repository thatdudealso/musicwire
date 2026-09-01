import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

import { scoreFacts, validateMusicXml } from '../src/validate.js';

const candidatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/examples/candidates',
);

const expected = [
  { slug: '01-pop-rock', measures: 88 },
  { slug: '02-big-room-edm', measures: 88 },
  { slug: '03-house', measures: 88 },
  { slug: '04-alt-pop', measures: 72 },
  { slug: '05-mainstream-pop', measures: 72 },
  { slug: '06-british-pop', measures: 88 },
  { slug: '07-techno', measures: 92 },
  { slug: '08-metal', measures: 112 },
  { slug: '09-metalcore', measures: 104 },
  { slug: '10-country', measures: 68 },
  { slug: '11-rnb', measures: 64 },
  { slug: '12-synthwave', measures: 72 },
  { slug: '13-drum-and-bass', measures: 120 },
  { slug: '14-trap', measures: 96 },
];

const asArray = (value) => (Array.isArray(value) ? value : [value]);

const scorePartFacts = (xml) => {
  const score = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)[
    'score-partwise'
  ];
  const declaredParts = asArray(score['part-list']['score-part']).map((part) => ({
    id: part['@_id'],
    programs: asArray(part['midi-instrument']).flatMap((instrument) =>
      instrument['midi-program'] === undefined ? [] : [Number(instrument['midi-program'])],
    ),
  }));
  const measuresByPart = new Map(
    asArray(score.part).map((part) => [part['@_id'], asArray(part.measure).length]),
  );
  return { declaredParts, measuresByPart };
};

const parsedScore = (xml) =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)['score-partwise'];

const measure = (score, partId, number) =>
  asArray(score.part)
    .find((part) => part['@_id'] === partId)
    .measure.find((candidate) => Number(candidate['@_number']) === number);

const pitchedNotes = (measure) =>
  asArray(measure.note)
    .filter((note) => note.pitch)
    .map((note) => `${note.pitch.step}${note.pitch.alter ?? ''}${note.pitch.octave}:${note.duration}`);

const hasClosedHat = (measure) =>
  asArray(measure.note).some((note) => note.instrument?.['@_id'] === 'P4-I3');

describe('genre gallery candidates', () => {
  it('keeps fourteen locally valid 2.5-3 minute scores off the live gallery', () => {
    const slugs = fs
      .readdirSync(candidatesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      slugs,
      expected.map(({ slug }) => slug),
    );

    for (const { slug, measures } of expected) {
      const xml = fs.readFileSync(path.join(candidatesRoot, slug, `${slug}.musicxml`), 'utf8');
      assert.ok(fs.existsSync(path.join(candidatesRoot, slug, 'GENRE_BRIEF.md')));
      assert.ok(fs.existsSync(path.join(candidatesRoot, slug, 'README.md')));
      const validation = validateMusicXml(xml);
      assert.equal(validation.valid, true, `${slug}: ${JSON.stringify(validation.errors)}`);
      const facts = scoreFacts(xml);
      assert.ok(
        facts.scoreDurationSeconds >= 150 && facts.scoreDurationSeconds <= 180,
        `${slug} duration ${facts.scoreDurationSeconds}`,
      );
      assert.ok(facts.instruments.length >= 4, `${slug} needs a multi-part ensemble`);
      const score = scorePartFacts(xml);
      assert.ok(
        score.declaredParts.some(({ programs }) => programs.length > 0),
        `${slug} needs at least one GM program`,
      );
      assert.deepEqual(
        [...score.measuresByPart.values()],
        Array(score.declaredParts.length).fill(measures),
        `${slug} measure totals`,
      );
      if (slug === '12-synthwave')
        assert.ok(
          score.declaredParts.find(({ id }) => id === 'P2')?.programs.includes(63),
          'Synth Brass must use GM 63 (Synth Brass 1)',
        );
      const parsed = parsedScore(xml);
      if (slug === '08-metal') {
        assert.deepEqual(pitchedNotes(measure(parsed, 'P2', 49)), ['G4:4', 'B4:4', 'E5:8']);
        assert.deepEqual(pitchedNotes(measure(parsed, 'P3', 49)), ['B4:4', 'D5:4', 'G5:8']);
      }
      if (slug === '10-country')
        assert.ok(
          score.declaredParts.find(({ id }) => id === 'P2')?.programs.includes(28),
          'Country lead must use GM 28 (Electric Guitar clean)',
        );
      if (slug === '11-rnb') {
        assert.ok(hasClosedHat(measure(parsed, 'P4', 9)), 'R&B verse needs offbeat hats');
        assert.ok(hasClosedHat(measure(parsed, 'P4', 25)), 'R&B prechorus needs hats');
      }
    }
  });
});
