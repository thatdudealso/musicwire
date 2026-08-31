import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const typeForDuration = {
  1: 'eighth',
  2: 'quarter',
  3: 'quarter',
  4: 'half',
  6: 'half',
  8: 'whole',
};

const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const parsePitch = (value) => {
  const match = value.match(/^([A-G])([#b]?)(-?\d+)$/);
  assert.ok(match, `Invalid pitch ${value}`);
  const [, step, accidental, octave] = match;
  return `<pitch><step>${step}</step>${accidental ? `<alter>${accidental === '#' ? 1 : -1}</alter>` : ''}<octave>${octave}</octave></pitch>`;
};

const renderNote = (pitch, duration, { chord = false, instrumentId, unpitched = false } = {}) => {
  const body = unpitched
    ? (() => {
        const match = pitch.match(/^([A-G])(\d+)$/);
        assert.ok(match, `Invalid display pitch ${pitch}`);
        return `<unpitched><display-step>${match[1]}</display-step><display-octave>${match[2]}</display-octave></unpitched>`;
      })()
    : parsePitch(pitch);
  return `<note>${chord ? '<chord/>' : ''}${body}${instrumentId ? `<instrument id="${instrumentId}"/>` : ''}<duration>${duration}</duration><type>${typeForDuration[duration]}</type>${duration === 3 || duration === 6 ? '<dot/>' : ''}</note>`;
};

const renderMeasureEvents = (source, part) => {
  const events = source.trim().split(/\s+/).filter(Boolean);
  const total = events.reduce((sum, event) => {
    const duration = Number(event.match(/:(\d+)$/)?.[1]);
    assert.ok(typeForDuration[duration], `Unsupported duration in ${event}`);
    return sum + duration;
  }, 0);
  assert.equal(total, 8, `Measure must contain eight divisions: ${source}`);
  return events
    .map((event) => {
      const [, token, durationText] = event.match(/^(.+):(\d+)$/) ?? [];
      const duration = Number(durationText);
      if (token === 'R')
        return `<note><rest/><duration>${duration}</duration><type>${typeForDuration[duration]}</type>${duration === 3 || duration === 6 ? '<dot/>' : ''}</note>`;
      const pitches = token.replace(/^\[/, '').replace(/\]$/, '').split(',');
      return pitches
        .map((sourcePitch, index) => {
          const unpitched = sourcePitch.startsWith('U');
          const unpitchedMatch = unpitched ? sourcePitch.match(/^U([A-Z]?)([A-G]\d)$/) : null;
          assert.ok(!unpitched || unpitchedMatch, `Invalid percussion token ${sourcePitch}`);
          const [, instrumentKey = '', pitch] = unpitchedMatch ?? [];
          return renderNote(unpitched ? pitch : sourcePitch, duration, {
            chord: index > 0,
            unpitched,
            instrumentId: unpitched
              ? (part.percussionInstruments?.[instrumentKey]?.id ?? part.instrumentId)
              : undefined,
          });
        })
        .join('');
    })
    .join('');
};

const clefs = {
  treble: '<clef><sign>G</sign><line>2</line></clef>',
  bass: '<clef><sign>F</sign><line>4</line></clef>',
  percussion: '<clef><sign>percussion</sign><line>2</line></clef>',
};

const renderDirection = (direction) => {
  if (!direction) return '';
  const dynamic = direction.dynamic ? `<dynamics><${direction.dynamic}/></dynamics>` : '';
  const words = direction.words ? `<words>${xml(direction.words)}</words>` : '';
  return `<direction placement="above"><direction-type>${dynamic || words}</direction-type></direction>`;
};

const renderPart = (part, example) => {
  assert.equal(part.measures.length, example.measures, `${example.id}: part length drift`);
  return `<part id="${part.id}">${part.measures
    .map((measure, index) => {
      const attributes =
        index === 0
          ? `<attributes><divisions>2</divisions><key><fifths>${example.keyFifths}</fifths><mode>${example.mode}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time>${clefs[part.clef]}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${example.tempo}</per-minute></metronome></direction-type><sound tempo="${example.tempo}"/></direction>`
          : '';
      const direction = renderDirection(part.directions?.[index]);
      const closing =
        index === part.measures.length - 1
          ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
          : '';
      return `<measure number="${index + 1}">${attributes}${direction}${renderMeasureEvents(measure, part)}${closing}</measure>`;
    })
    .join('')}</part>`;
};

const scorePart = (part) => {
  const percussionInstruments = part.percussionInstruments
    ? Object.values(part.percussionInstruments)
    : null;
  const instruments = percussionInstruments ?? [
    { id: part.instrumentId, name: part.instrument, program: part.program },
  ];
  return `<score-part id="${part.id}"><part-name>${xml(part.name)}</part-name><part-abbreviation>${xml(part.abbreviation)}</part-abbreviation>${instruments
    .map(
      (instrument) =>
        `<score-instrument id="${instrument.id}"><instrument-name>${xml(instrument.name)}</instrument-name></score-instrument>`,
    )
    .join('')}${instruments
    .map(
      (instrument) =>
        `<midi-instrument id="${instrument.id}"><midi-channel>${part.channel}</midi-channel>${instrument.unpitched ? `<midi-unpitched>${instrument.unpitched}</midi-unpitched>` : `<midi-program>${instrument.program}</midi-program>`}</midi-instrument>`,
    )
    .join('')}</score-part>`;
};

const score = (example) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${xml(example.title)}</work-title></work>
  <identification><creator type="composer">Musicwire genre demo</creator><encoding><software>Musicwire Spanish reggaeton dembow demo</software></encoding></identification>
  <part-list>${example.parts.map(scorePart).join('')}</part-list>
  ${example.parts.map((part) => renderPart(part, example)).join('\n  ')}
</score-partwise>
`;

const part = (
  id,
  name,
  abbreviation,
  instrument,
  channel,
  program,
  clef,
  measures,
  extras = {},
) => ({
  id,
  name,
  abbreviation,
  instrument,
  channel,
  program,
  clef,
  instrumentId: `${id}-I1`,
  measures,
  ...extras,
});

const rest = 'R:8';
const hats = 'UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1';
const dembow = 'UKC4,UHG5:1 UHG5:1 USC5,UKC4,UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1';
const bassDm = 'D2:1 D2:1 A2:1 D2:1 D2:1 D2:1 A2:1 F2:1';
const bassC = 'C2:1 C2:1 G2:1 C2:1 C2:1 C2:1 G2:1 E2:1';
const bassBb = 'Bb1:1 Bb1:1 F2:1 Bb1:1 Bb1:1 Bb1:1 F2:1 D2:1';
const padDm = '[D3,F3,A3]:8';
const padC = '[C3,E3,G3]:8';
const padBb = '[Bb2,D3,F3]:8';
const hookA = 'D5:1 F5:1 A5:2 G5:1 F5:1 D5:2';
const hookB = 'C5:1 E5:1 G5:2 F5:1 E5:1 C5:2';
const hookC = 'Bb4:1 D5:1 F5:2 E5:1 D5:1 C5:2';
const hookD = 'A4:2 F4:2 D5:4';
const loop4 = (a, b, c, d) => [a, b, c, d];

const example = {
  id: 'spanish-reggaeton-dembow',
  title: 'Noche Baja',
  tempo: 96,
  keyFifths: -1,
  mode: 'minor',
  measures: 20,
  parts: [
    part(
      'P1',
      'Synth Lead',
      'Lead',
      'Synth Lead',
      1,
      82,
      'treble',
      [
        rest,
        rest,
        hookA,
        hookB,
        rest,
        rest,
        rest,
        rest,
        hookA,
        hookB,
        hookC,
        hookD,
        rest,
        'D5:4 R:4',
        hookA,
        hookB,
        hookC,
        hookD,
        hookA,
        'D5:2 A4:2 D5:4',
      ],
      {
        directions: [
          { words: 'intro' },
          null,
          { words: 'cell' },
          null,
          { words: 'tacet groove' },
          null,
          null,
          null,
          { dynamic: 'f', words: 'hook' },
          null,
          null,
          null,
          { dynamic: 'p', words: 'break' },
          null,
          { dynamic: 'f', words: 'dembow drop' },
        ],
      },
    ),
    part(
      'P2',
      'Synth Bass',
      'Bass',
      'Synth Bass',
      2,
      39,
      'bass',
      [
        rest,
        rest,
        rest,
        rest,
        ...loop4(bassDm, bassC, bassBb, bassC),
        ...loop4(bassDm, bassC, bassBb, bassC),
        rest,
        rest,
        ...loop4(bassDm, bassC, bassBb, bassC),
        bassDm,
        'D2:4 A1:2 D2:2',
      ],
      {
        directions: [null, null, null, null, { dynamic: 'mf', words: 'locks kick' }],
      },
    ),
    part(
      'P3',
      'Synth Pad',
      'Pad',
      'Synth Pad',
      3,
      89,
      'treble',
      [
        padDm,
        padC,
        padBb,
        padC,
        padDm,
        padC,
        padBb,
        padC,
        padDm,
        padC,
        padBb,
        padC,
        padDm,
        padC,
        padDm,
        padC,
        padBb,
        padC,
        padDm,
        '[D3,F3,A3]:4 [D3,A3]:2 D3:2',
      ],
      {
        directions: [
          { dynamic: 'p' },
          null,
          null,
          null,
          { dynamic: 'mp' },
          null,
          null,
          null,
          { dynamic: 'mf' },
          null,
          null,
          null,
          { dynamic: 'p' },
          null,
          { dynamic: 'f' },
        ],
      },
    ),
    part(
      'P4',
      'Dembow Kit',
      'Drs.',
      'Acoustic Bass Drum',
      10,
      1,
      'percussion',
      [
        hats,
        hats,
        hats,
        hats,
        ...loop4(dembow, dembow, dembow, dembow),
        ...loop4(dembow, dembow, dembow, dembow),
        rest,
        rest,
        ...loop4(dembow, dembow, dembow, dembow),
        dembow,
        'UKC4,USC5:2 USC5:1 USC5:1 UKC4:2 UKC4,USC5:2',
      ],
      {
        percussionInstruments: {
          K: { id: 'P4-I1', name: 'Acoustic Bass Drum', unpitched: 36 },
          S: { id: 'P4-I2', name: 'Acoustic Snare', unpitched: 38 },
          H: { id: 'P4-I3', name: 'Closed Hi-Hat', unpitched: 42 },
        },
        directions: [
          { words: 'intro - hats' },
          null,
          null,
          null,
          { words: 'dembow' },
          null,
          null,
          null,
          { words: 'hook groove' },
          null,
          null,
          null,
          { dynamic: 'p' },
          null,
          { dynamic: 'ff', words: 'drop' },
        ],
      },
    ),
  ],
};

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'spanish-reggaeton-dembow.musicxml',
);
fs.writeFileSync(out, score(example));
console.log(out, 'measures', example.measures, 'parts', example.parts.length);
