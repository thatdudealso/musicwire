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
  <identification><creator type="composer">Musicwire genre demo</creator><encoding><software>Musicwire gym-pump metalcore demo</software></encoding></identification>
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
const chugDm = 'D2:1 D2:1 D2:1 D2:1 D2:1 D2:1 A2:1 D2:1';
const chugBb = 'Bb1:1 Bb1:1 Bb1:1 Bb1:1 Bb1:1 Bb1:1 F2:1 Bb1:1';
const chugF = 'F2:1 F2:1 F2:1 F2:1 F2:1 F2:1 C3:1 F2:1';
const chugC = 'C2:1 C2:1 C2:1 C2:1 C2:1 C2:1 G2:1 C2:1';
const openDm = '[D2,A2,D3]:4 [D2,A2,D3]:4';
const openBb = '[Bb1,F2,Bb2]:4 [Bb1,F2,Bb2]:4';
const openF = '[F2,C3,F3]:4 [F2,C3,F3]:4';
const openC = '[C2,G2,C3]:4 [C2,G2,C3]:4';
const halfDm = 'D2:2 D2:2 D2:2 D2:2';
const halfBb = 'Bb1:2 Bb1:2 Bb1:2 Bb1:2';
const halfF = 'F2:2 F2:2 F2:2 F2:2';
const halfC = 'C2:2 C2:2 C2:2 C2:2';
const bassDm = 'D2:1 D2:1 D2:1 D2:1 D2:1 D2:1 A1:1 D2:1';
const bassBb = 'Bb1:1 Bb1:1 Bb1:1 Bb1:1 Bb1:1 Bb1:1 F1:1 Bb1:1';
const bassF = 'F1:1 F1:1 F1:1 F1:1 F1:1 F1:1 C2:1 F1:1';
const bassC = 'C2:1 C2:1 C2:1 C2:1 C2:1 C2:1 G1:1 C2:1';
const bassHalfDm = 'D2:2 D2:2 D2:2 D2:2';
const bassHalfBb = 'Bb1:2 Bb1:2 Bb1:2 Bb1:2';
const bassHalfF = 'F1:2 F1:2 F1:2 F1:2';
const bassHalfC = 'C2:2 C2:2 C2:2 C2:2';
const verseKit = 'UKC4,UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1';
const introKit = 'UKC4:2 R:2 UKC4:2 R:2';
const breakHit = 'D2:2 R:6';
const bdKit = 'UCC6,UKC4:2 UKC4:2 USC5,UKC4:2 UKC4:2';
const cadence = 'D2:4 A2:2 D2:2';
const bassCadence = 'D2:4 A1:2 D2:2';

const loop4 = (a, b, c, d) => [a, b, c, d];
const loop8 = (a, b, c, d) => [a, b, c, d, a, b, c, d];

const example = {
  id: 'metalcore-gym-pump',
  title: 'Forge Current',
  tempo: 150,
  keyFifths: -1,
  mode: 'minor',
  measures: 32,
  parts: [
    part(
      'P1',
      'Distortion Guitar',
      'Gtr.',
      'Distortion Guitar',
      1,
      31,
      'treble',
      [
        ...loop4(chugDm, chugBb, chugF, chugC),
        ...loop8(chugDm, chugBb, chugF, chugC),
        ...loop4(openDm, openBb, openF, openC),
        rest,
        breakHit,
        ...loop8(halfDm, halfBb, halfF, halfC),
        openDm,
        openBb,
        halfDm,
        halfBb,
        halfF,
        cadence,
      ],
      {
        directions: [
          { words: 'intro - muted chugs' },
          null,
          null,
          null,
          { dynamic: 'mf', words: 'verse chug' },
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          { dynamic: 'f', words: 'chorus - open' },
          null,
          null,
          null,
          { dynamic: 'p', words: 'dead air' },
          { words: 'one hit' },
          { dynamic: 'ff', words: 'breakdown' },
        ],
      },
    ),
    part(
      'P2',
      'Overdriven Guitar',
      'Lead',
      'Overdriven Guitar',
      2,
      30,
      'treble',
      [
        ...Array(12).fill(rest),
        'A4:2 C5:1 D5:1 F5:2 D5:2',
        'D5:2 C5:1 A4:1 G4:2 A4:2',
        'A4:1 C5:1 D5:2 F5:1 D5:1 C5:2',
        'A4:4 D5:4',
        rest,
        rest,
        ...Array(8).fill(rest),
        'A4:2 C5:1 D5:1 F5:2 D5:2',
        'D5:2 C5:1 A4:1 G4:4',
        rest,
        rest,
        'A4:2 F4:2 D4:4',
        'D4:8',
      ],
      {
        directions: [
          { words: 'tacet intro' },
          null,
          null,
          null,
          { words: 'tacet verse' },
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          { dynamic: 'f', words: 'gym hook' },
        ],
      },
    ),
    part(
      'P3',
      'Electric Bass',
      'Bass',
      'Electric Bass (pick)',
      3,
      35,
      'bass',
      [
        rest,
        rest,
        rest,
        rest,
        ...loop8(bassDm, bassBb, bassF, bassC),
        ...loop4(bassDm, bassBb, bassF, bassC),
        rest,
        rest,
        ...loop8(bassHalfDm, bassHalfBb, bassHalfF, bassHalfC),
        bassDm,
        bassBb,
        bassHalfDm,
        bassHalfBb,
        bassHalfF,
        bassCadence,
      ],
      {
        directions: [null, null, null, null, { dynamic: 'mf', words: 'locks to chug' }],
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
        ...loop4(introKit, introKit, introKit, introKit),
        ...loop8(verseKit, verseKit, verseKit, verseKit),
        ...loop4(verseKit, verseKit, verseKit, verseKit),
        rest,
        rest,
        ...loop8(bdKit, bdKit, bdKit, bdKit),
        verseKit,
        verseKit,
        bdKit,
        bdKit,
        bdKit,
        'UCC6,UKC4:4 USC5,UKC4:2 UKC4:2',
      ],
      {
        percussionInstruments: {
          K: { id: 'P4-I1', name: 'Acoustic Bass Drum', unpitched: 36 },
          S: { id: 'P4-I2', name: 'Acoustic Snare', unpitched: 38 },
          H: { id: 'P4-I3', name: 'Closed Hi-Hat', unpitched: 42 },
          C: { id: 'P4-I4', name: 'Crash Cymbal', unpitched: 49 },
        },
        directions: [
          { words: 'intro - kick only' },
          null,
          null,
          null,
          { words: 'verse backbeat' },
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
          { dynamic: 'p' },
          null,
          { dynamic: 'ff', words: 'half-time crash' },
        ],
      },
    ),
  ],
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'metalcore-gym-pump.musicxml');
fs.writeFileSync(out, score(example));
console.log(out, 'measures', example.measures, 'parts', example.parts.length);
