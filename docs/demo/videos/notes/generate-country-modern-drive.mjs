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
  <identification><creator type="composer">Musicwire genre demo</creator><encoding><software>Musicwire modern country demo</software></encoding></identification>
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
const acG = '[G3,B3,D4]:2 [G3,B3,D4]:2 [G3,B3,D4]:2 [G3,B3,D4]:2';
const acD = '[D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2';
const acEm = '[E3,G3,B3]:2 [E3,G3,B3]:2 [E3,G3,B3]:2 [E3,G3,B3]:2';
const acC = '[C3,E3,G3]:2 [C3,E3,G3]:2 [C3,E3,G3]:2 [C3,E3,G3]:2';
const openG = '[G3,B3,D4,G4]:4 [G3,B3,D4,G4]:4';
const openD = '[D3,F#3,A3,D4]:4 [D3,F#3,A3,D4]:4';
const openEm = '[E3,G3,B3,E4]:4 [E3,G3,B3,E4]:4';
const openC = '[C3,E3,G3,C4]:4 [C3,E3,G3,C4]:4';
const bassG = 'G2:2 D3:2 G2:2 D3:2';
const bassD = 'D2:2 A2:2 D2:2 A2:2';
const bassEm = 'E2:2 B2:2 E2:2 B2:2';
const bassC = 'C2:2 G2:2 C2:2 G2:2';
const walkG = 'G2:2 D3:2 G2:1 A2:1 B2:2';
const walkD = 'D2:2 A2:2 D2:1 E2:1 F#2:2';
const walkEm = 'E2:2 B2:2 E2:1 D2:1 C2:2';
const walkC = 'C2:2 G2:2 C2:1 D2:1 E2:2';
const hats = 'UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1';
const backbeat = 'UKC4,UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1';
const fill = 'UKC4,UHG5:1 UHG5:1 USC5:1 USC5:1 UKC4:1 USC5:1 USC5:1 UKC4,USC5:1';
const loop4 = (a, b, c, d) => [a, b, c, d];
const loop8 = (a, b, c, d) => [a, b, c, d, a, b, c, d];

const example = {
  id: 'country-modern-drive',
  title: 'Cedar Mile',
  tempo: 108,
  keyFifths: 1,
  mode: 'major',
  measures: 24,
  parts: [
    part(
      'P1',
      'Acoustic Guitar',
      'Ac.Gtr',
      'Acoustic Guitar (steel)',
      1,
      26,
      'treble',
      [
        ...loop4(acG, acD, acEm, acC),
        ...loop8(acG, acD, acEm, acC),
        ...loop4(acG, acD, acEm, acC),
        openG,
        openD,
        openEm,
        openC,
        openG,
        openD,
        openG,
        openG,
      ],
      {
        directions: [
          { dynamic: 'mp', words: 'intro - acoustic' },
          null,
          null,
          null,
          { dynamic: 'mf', words: 'verse' },
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          { words: 'pre-chorus lift' },
          null,
          null,
          null,
          { dynamic: 'f', words: 'chorus' },
        ],
      },
    ),
    part(
      'P2',
      'Overdriven Guitar',
      'Tele',
      'Overdriven Guitar',
      2,
      30,
      'treble',
      [
        'B4:1 D5:1 G5:2 D5:2 B4:2',
        'A4:2 F#4:2 A4:4',
        'G4:1 B4:1 D5:2 E5:2 D5:2',
        'C5:2 G4:2 C5:4',
        rest,
        rest,
        rest,
        'B4:2 G4:2 D4:4',
        rest,
        rest,
        rest,
        rest,
        'D5:1 E5:1 G5:2 B5:2 G5:2',
        'A5:2 F#5:2 D5:4',
        'G5:1 B5:1 D6:2 B5:2 G5:2',
        'E5:2 D5:2 G5:4',
        'B4:1 D5:1 G5:2 D5:2 B4:2',
        'A4:2 F#4:2 A4:2 D5:2',
        'G5:2 E5:2 D5:2 B4:2',
        'C5:2 G4:2 C5:4',
        'B4:2 D5:2 G5:4',
        'A4:2 F#4:2 D4:4',
        'B4:2 D5:2 G5:4',
        'G5:8',
      ],
      {
        directions: [
          { words: 'intro hook' },
          null,
          null,
          null,
          { words: 'tacet verse' },
          null,
          null,
          { words: 'one-bar answer' },
          null,
          null,
          null,
          null,
          { dynamic: 'mf', words: 'climb' },
          null,
          null,
          null,
          { dynamic: 'f', words: 'chorus hook' },
        ],
      },
    ),
    part(
      'P3',
      'Electric Bass',
      'Bass',
      'Electric Bass (finger)',
      3,
      34,
      'bass',
      [
        rest,
        rest,
        rest,
        rest,
        ...loop8(bassG, bassD, bassEm, bassC),
        ...loop4(bassG, bassD, bassEm, bassC),
        walkG,
        walkD,
        walkEm,
        walkC,
        walkG,
        walkD,
        walkG,
        'G2:4 D3:2 G2:2',
      ],
      {
        directions: [
          null,
          null,
          null,
          null,
          { dynamic: 'mf', words: 'root-fifth' },
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          { words: 'walking chorus' },
        ],
      },
    ),
    part(
      'P4',
      'Drum Kit',
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
        ...loop8(backbeat, backbeat, backbeat, backbeat),
        ...loop4(backbeat, backbeat, backbeat, backbeat),
        backbeat,
        backbeat,
        backbeat,
        backbeat,
        backbeat,
        backbeat,
        backbeat,
        fill,
      ],
      {
        percussionInstruments: {
          K: { id: 'P4-I1', name: 'Acoustic Bass Drum', unpitched: 36 },
          S: { id: 'P4-I2', name: 'Acoustic Snare', unpitched: 38 },
          H: { id: 'P4-I3', name: 'Closed Hi-Hat', unpitched: 42 },
        },
        directions: [
          { words: 'intro - hats only' },
          null,
          null,
          null,
          { words: 'backbeat 2 and 4' },
        ],
      },
    ),
  ],
};

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'country-modern-drive.musicxml',
);
fs.writeFileSync(out, score(example));
console.log(out, 'measures', example.measures, 'parts', example.parts.length);
