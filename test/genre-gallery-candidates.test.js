import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scoreFacts, validateMusicXml } from '../src/validate.js';

const candidatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/examples/candidates',
);

const expected = [
  '01-pop-rock',
  '02-big-room-edm',
  '03-house',
  '04-alt-pop',
  '05-mainstream-pop',
  '06-british-pop',
  '07-techno',
  '08-metal',
  '09-metalcore',
  '10-country',
  '11-rnb',
  '12-synthwave',
  '13-drum-and-bass',
  '14-trap',
];

const artistLeak =
  /5 seconds of summer|martin garrix|afrojack|twenty one pilots|morgan wallen|i prevail|avicii|calvin harris/i;

describe('genre gallery candidates', () => {
  it('keeps fourteen locally valid 2.5-3 minute scores off the live gallery', () => {
    const slugs = fs
      .readdirSync(candidatesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(slugs, expected);

    for (const slug of slugs) {
      const xml = fs.readFileSync(path.join(candidatesRoot, slug, `${slug}.musicxml`), 'utf8');
      const brief = fs.readFileSync(path.join(candidatesRoot, slug, 'GENRE_BRIEF.md'), 'utf8');
      const readme = fs.readFileSync(path.join(candidatesRoot, slug, 'README.md'), 'utf8');
      const validation = validateMusicXml(xml);
      assert.equal(validation.valid, true, `${slug}: ${JSON.stringify(validation.errors)}`);
      const facts = scoreFacts(xml);
      assert.ok(
        facts.scoreDurationSeconds >= 150 && facts.scoreDurationSeconds <= 180,
        `${slug} duration ${facts.scoreDurationSeconds}`,
      );
      assert.match(brief, /Sources \(accessed /);
      assert.doesNotMatch(xml, artistLeak);
      assert.doesNotMatch(readme, artistLeak);
      assert.ok(facts.instruments.length >= 4, `${slug} needs a multi-part ensemble`);
    }
  });
});
