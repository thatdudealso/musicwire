import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const musicwireUrl = 'https://musicwire.5432wire.com';

export async function embedAttribution({ file, format, receiptId, verificationUrl, ffmpegBin }) {
  const attribution = `Rendered by Musicwire (${musicwireUrl}); receipt ${receiptId}; verify ${verificationUrl}`;
  if (format === 'mp3') {
    await rewriteAudioMetadata(file, format, attribution, ffmpegBin);
    return;
  }
  const embedded =
    format === 'midi' ? () => embedMidiMetadata(fs.readFileSync(file), attribution) : null;
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
      '-id3v2_version',
      '3',
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
