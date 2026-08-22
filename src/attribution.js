import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const musicwireUrl = 'https://musicwire.5432wire.com';

export async function embedAttribution({ file, format, receiptId, verificationUrl, ffmpegBin }) {
  const attribution = `Rendered by Musicwire (${musicwireUrl}); receipt ${receiptId}; verify ${verificationUrl}`;
  if (format === 'mp3' || format === 'wav') {
    await rewriteAudioMetadata(file, format, attribution, ffmpegBin);
    return;
  }
  const bytes = fs.readFileSync(file);
  const embedded = {
    pdf: () => embedPdfMetadata(bytes, attribution),
    png: () => embedPngMetadata(bytes, attribution, receiptId),
    svg: () => embedSvgMetadata(bytes, attribution),
    midi: () => embedMidiMetadata(bytes, attribution),
    mscz: () => embedMsczMetadata(file, attribution),
  }[format];
  if (!embedded) throw new Error(`Musicwire attribution is unsupported for ${format}.`);
  const result = embedded();
  if (result) fs.writeFileSync(file, result);
}

export function embedMusicXmlAttribution(bytes, receiptId, verificationUrl) {
  const xml = bytes.toString('utf8');
  const software = `Musicwire (${musicwireUrl})`;
  const description = `Musicwire render receipt ${receiptId}; verify ${verificationUrl}`;
  const entries = `<software>${escapeXml(software)}</software><encoding-description>${escapeXml(description)}</encoding-description>`;
  const root = xml.match(/<score-(?:partwise|timewise)\b[^>]*>/i);
  if (!root)
    throw new Error('MusicXML attribution requires a score-partwise or score-timewise document.');
  const identification = xml.match(/<identification\b[^>]*>[\s\S]*?<\/identification>/i);
  if (identification)
    return Buffer.from(
      xml.slice(0, identification.index) +
        identificationWithEntries(identification[0], entries) +
        xml.slice(identification.index + identification[0].length),
    );
  let insertAt = root.index + root[0].length;
  for (const header of [/<\/work>/i, /<\/movement-number>/i, /<\/movement-title>/i]) {
    const match = xml.match(header);
    if (match) insertAt = Math.max(insertAt, match.index + match[0].length);
  }
  return Buffer.from(
    xml.slice(0, insertAt) +
      `<identification><encoding>${entries}</encoding></identification>` +
      xml.slice(insertAt),
  );
}

function identificationWithEntries(identification, entries) {
  if (/<encoding\b[^>]*>[\s\S]*?<\/encoding>/i.test(identification))
    return identification.replace(/<\/encoding>/i, `${entries}</encoding>`);
  const selfClosing = identification.match(/<encoding\b[^>]*\/>/i);
  if (selfClosing)
    return (
      identification.slice(0, selfClosing.index) +
      `<encoding>${entries}</encoding>` +
      identification.slice(selfClosing.index + selfClosing[0].length)
    );
  const successor = identification.match(/<(?:source|relation|miscellaneous)\b/i);
  const insertAt = successor ? successor.index : identification.lastIndexOf('</');
  return (
    identification.slice(0, insertAt) +
    `<encoding>${entries}</encoding>` +
    identification.slice(insertAt)
  );
}

function embedPdfMetadata(bytes, attribution) {
  const text = bytes.toString('latin1');
  const previous = text.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  const trailer = text.match(/trailer\s*<<(.*?)>>\s*startxref/s);
  const size = trailer?.[1].match(/\/Size\s+(\d+)/)?.[1];
  const root = trailer?.[1].match(/\/Root\s+(\d+\s+\d+\s+R)/)?.[1];
  if (!previous || !size || !root)
    throw new Error('Musicwire could not add PDF attribution metadata.');
  const objectNumber = Number(size);
  const objectOffset = bytes.length + 1;
  const info = `<< /Creator (Musicwire) /Producer (Musicwire) /Subject (${escapePdf(attribution)}) /Keywords (Musicwire, render receipt) >>`;
  const body = `\n${objectNumber} 0 obj\n${info}\nendobj\n`;
  const xrefOffset = objectOffset + Buffer.byteLength(body, 'latin1');
  const update = `${body}xref\n${objectNumber} 1\n${String(objectOffset).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${objectNumber + 1} /Root ${root} /Info ${objectNumber} 0 R /Prev ${previous[1]} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([bytes, Buffer.from(update, 'latin1')]);
}

function embedPngMetadata(bytes, attribution, receiptId) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature))
    throw new Error('Musicwire expected a PNG artifact.');
  const ihdrLength = bytes.readUInt32BE(8);
  const insertAt = 8 + 12 + ihdrLength;
  const chunks = [
    pngTextChunk('Software', 'Musicwire'),
    pngTextChunk('Comment', attribution),
    pngTextChunk('MusicwireReceipt', receiptId),
  ];
  return Buffer.concat([bytes.subarray(0, insertAt), ...chunks, bytes.subarray(insertAt)]);
}

function pngTextChunk(keyword, value) {
  const data = Buffer.from(`${keyword}\0${value}`, 'latin1');
  const type = Buffer.from('tEXt');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function embedSvgMetadata(bytes, attribution) {
  const svg = bytes.toString('utf8');
  const match = svg.match(/<svg\b[^>]*>/i);
  if (!match) throw new Error('Musicwire expected an SVG artifact.');
  const metadata = `<metadata>${escapeXml(attribution)}</metadata>`;
  return Buffer.from(
    `${svg.slice(0, match.index + match[0].length)}${metadata}${svg.slice(match.index + match[0].length)}`,
  );
}

function embedMidiMetadata(bytes, attribution) {
  if (bytes.subarray(0, 4).toString('ascii') !== 'MThd')
    throw new Error('Musicwire expected a MIDI artifact.');
  const headerLength = bytes.readUInt32BE(4);
  const trackOffset = 8 + headerLength;
  if (bytes.subarray(trackOffset, trackOffset + 4).toString('ascii') !== 'MTrk')
    throw new Error('Musicwire could not find a MIDI track for attribution.');
  const trackLength = bytes.readUInt32BE(trackOffset + 4);
  const text = Buffer.from(attribution, 'utf8');
  const copyright = Buffer.from(`Copyright Musicwire ${musicwireUrl}`, 'utf8');
  const metadata = Buffer.concat([
    Buffer.from([0, 0xff, 0x02]),
    midiLength(copyright.length),
    copyright,
    Buffer.from([0, 0xff, 0x01]),
    midiLength(text.length),
    text,
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(trackLength + metadata.length);
  return Buffer.concat([
    bytes.subarray(0, trackOffset + 4),
    length,
    metadata,
    bytes.subarray(trackOffset + 8),
  ]);
}

function embedMsczMetadata(file, attribution) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'musicwire-mscz-'));
  try {
    execFileSync('unzip', ['-q', file, '-d', directory]);
    const scorePath = path.join(directory, 'score.mscx');
    if (!fs.existsSync(scorePath)) throw new Error('Musicwire could not find score.mscx in MSCZ.');
    const score = fs.readFileSync(scorePath, 'utf8');
    if (!/<Score\b[^>]*>/.test(score))
      throw new Error('Musicwire could not find a Score element in MSCZ for attribution.');
    fs.writeFileSync(
      scorePath,
      score.replace(
        /(<Score\b[^>]*>)/,
        `$1<metaTag name="creator">${escapeXml(attribution)}</metaTag>`,
      ),
    );
    fs.rmSync(file);
    execFileSync('zip', ['-q', '-r', file, '.'], { cwd: directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  return null;
}

async function rewriteAudioMetadata(file, format, attribution, ffmpegBin) {
  const output = `${file}.attributed.${format}`;
  try {
    await run(ffmpegBin, [
      '-y',
      '-i',
      file,
      '-map',
      '0',
      '-c',
      'copy',
      '-metadata',
      'encoded_by=Musicwire',
      '-metadata',
      `comment=${attribution}`,
      '-metadata',
      `copyright=Musicwire ${musicwireUrl}`,
      ...(format === 'mp3' ? ['-id3v2_version', '3'] : []),
      output,
    ]);
    fs.renameSync(output, file);
  } finally {
    fs.rmSync(output, { force: true });
  }
}

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
  } catch (error) {
    throw new Error(`Musicwire could not add audio attribution metadata: ${error.message}`, {
      cause: error,
    });
  }
}

function midiLength(length) {
  const bytes = [length & 0x7f];
  for (let value = length >>> 7; value > 0; value >>>= 7) bytes.unshift((value & 0x7f) | 0x80);
  return Buffer.from(bytes);
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapePdf(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

const crcTable = Array.from({ length: 256 }, (_value, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
