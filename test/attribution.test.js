import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { embedAttribution, embedMusicXmlAttribution } from '../src/attribution.js';

const receiptId = '11111111-1111-4111-8111-111111111111';
const verificationUrl = 'https://musicwire.5432wire.com/v1/provenance/verify';

test('embeds Musicwire attribution in MIDI and MusicXML outputs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-attribution-'));
  try {
    const musicxml = embedMusicXmlAttribution(
      Buffer.from('<score-partwise version="4.0"><part-list/></score-partwise>'),
      receiptId,
      verificationUrl,
    ).toString();
    assert.match(musicxml, /<software>Musicwire/);
    assert.match(musicxml, new RegExp(receiptId));

    const midi = path.join(directory, 'score.mid');
    const originalMidi = Buffer.from([
      ...Buffer.from('MThd'),
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      0,
      96,
      ...Buffer.from('MTrk'),
      0,
      0,
      0,
      4,
      0,
      0xff,
      0x2f,
      0,
    ]);
    fs.writeFileSync(midi, originalMidi);
    await embedAttribution({ file: midi, format: 'midi', receiptId, verificationUrl });
    const embeddedMidi = fs.readFileSync(midi);
    assert.equal(embeddedMidi.readUInt32BE(18), 4 + embeddedMidi.length - originalMidi.length);
    assert.match(embeddedMidi.toString('utf8'), /Musicwire/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('keeps MusicXML schema order when identification or score headers already exist', () => {
  const merged = embedMusicXmlAttribution(
    Buffer.from(
      '<score-partwise version="4.0"><identification><creator type="composer">A</creator><encoding><software>MuseScore</software></encoding><source>manuscript</source></identification><part-list/></score-partwise>',
    ),
    receiptId,
    verificationUrl,
  ).toString();
  assert.equal(merged.match(/<encoding>/g).length, 1);
  assert.match(merged, /<software>MuseScore<\/software><software>Musicwire/);
  assert.equal(merged.indexOf('<encoding-description>') < merged.indexOf('<source>'), true);

  const inserted = embedMusicXmlAttribution(
    Buffer.from(
      '<score-partwise version="4.0"><identification><creator type="composer">A</creator><source>manuscript</source></identification><part-list/></score-partwise>',
    ),
    receiptId,
    verificationUrl,
  ).toString();
  assert.equal(inserted.indexOf('<encoding>') > inserted.indexOf('</creator>'), true);
  assert.equal(inserted.indexOf('</encoding>') < inserted.indexOf('<source>'), true);

  const headed = embedMusicXmlAttribution(
    Buffer.from(
      '<score-partwise version="4.0"><work><work-title>Etude</work-title></work><movement-title>I</movement-title><part-list/></score-partwise>',
    ),
    receiptId,
    verificationUrl,
  ).toString();
  assert.equal(headed.indexOf('<identification>') > headed.indexOf('</movement-title>'), true);
  assert.equal(headed.indexOf('<identification>') < headed.indexOf('<part-list'), true);
});
