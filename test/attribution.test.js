import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { embedAttribution, embedMusicXmlAttribution } from '../src/attribution.js';

const receiptId = '11111111-1111-4111-8111-111111111111';
const verificationUrl = 'https://musicwire.5432wire.com/v1/provenance/verify';

test('embeds Musicwire attribution without changing notation payloads', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-attribution-'));
  try {
    const musicxml = embedMusicXmlAttribution(
      Buffer.from('<score-partwise version="4.0"><part-list/></score-partwise>'),
      receiptId,
      verificationUrl,
    ).toString();
    assert.match(musicxml, /<software>Musicwire/);
    assert.match(musicxml, new RegExp(receiptId));

    const svg = path.join(directory, 'score.svg');
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
    await embedAttribution({ file: svg, format: 'svg', receiptId, verificationUrl });
    assert.match(fs.readFileSync(svg, 'utf8'), /<metadata>Rendered by Musicwire/);

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

    const png = path.join(directory, 'score.png');
    fs.writeFileSync(png, minimalPng());
    await embedAttribution({ file: png, format: 'png', receiptId, verificationUrl });
    const embeddedPng = fs.readFileSync(png);
    assert.equal(embeddedPng.toString('latin1').includes(`MusicwireReceipt\0${receiptId}`), true);

    const pdf = path.join(directory, 'score.pdf');
    fs.writeFileSync(pdf, minimalPdf());
    await embedAttribution({ file: pdf, format: 'pdf', receiptId, verificationUrl });
    const embeddedPdf = fs.readFileSync(pdf, 'latin1');
    assert.match(embeddedPdf, /\/Creator \(Musicwire\)/);
    assert.match(embeddedPdf, /\/Producer \(Musicwire\)/);

    const msczDirectory = path.join(directory, 'mscz');
    fs.mkdirSync(msczDirectory);
    fs.writeFileSync(msczDirectory + '/score.mscx', '<museScore><Score/></museScore>');
    const mscz = path.join(directory, 'score.mscz');
    execFileSync('zip', ['-q', '-r', mscz, '.'], { cwd: msczDirectory });
    await embedAttribution({ file: mscz, format: 'mscz', receiptId, verificationUrl });
    assert.match(
      execFileSync('unzip', ['-p', mscz, 'score.mscx'], { encoding: 'utf8' }),
      /Musicwire/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function minimalPng() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(1, 8);
  ihdr.writeUInt32BE(1, 12);
  return Buffer.concat([signature, ihdr, Buffer.alloc(12)]);
}

function minimalPdf() {
  const content =
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n45\n%%EOF\n';
  return Buffer.from(content, 'latin1');
}
