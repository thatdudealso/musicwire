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
  <identification><creator type="composer">Musicwire genre demo</creator><encoding><software>Musicwire festival EDM demo</software></encoding></identification>
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

const floor =
  'UKC4,UHG5:1 UHG5:1 UKC4,USC5,UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 UKC4,USC5,UHG5:1 UHG5:1';
const rest = 'R:8';
const snareRoll = 'USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1';
const bassFm = 'F2:1 F2:1 C3:1 F3:1 F2:1 F2:1 C3:1 Eb3:1';
const bassDb = 'Db2:1 Db2:1 Ab2:1 Db3:1 Db2:1 Db2:1 Ab2:1 C3:1';
const bassEb = 'Eb2:1 Eb2:1 Bb2:1 Eb3:1 Eb2:1 Eb2:1 Bb2:1 F3:1';
const bassAb = 'Ab1:1 Ab1:1 Eb2:1 Ab2:1 Ab1:1 Ab1:1 Eb2:1 G2:1';
const padFm = '[F3,Ab3,C4]:8';
const padDb = '[Db3,F3,Ab3]:8';
const padEb = '[Eb3,G3,Bb3]:8';
const padAb = '[Ab3,C4,Eb4]:8';

const example = {
  id: 'edm-festival-anthem',
  title: 'Skyline Surge',
  tempo: 128,
  keyFifths: -4,
  mode: 'minor',
  measures: 24,
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
        rest,
        rest,
        rest,
        rest,
        rest,
        rest,
        'R:2 F5:1 Ab5:1 Bb5:2 C6:2',
        'C6:2 Bb5:2 Ab5:2 F5:2',
        'F5:1 Ab5:1 Bb5:1 C6:1 Eb6:2 C6:2',
        'Bb5:4 Ab5:2 F5:2',
        'F5:1 Ab5:1 Bb5:1 C6:1 Eb6:1 F6:1 Ab6:1 Bb6:1',
        'C6:1 Eb6:1 F6:1 Ab6:1 Bb6:1 C7:1 Bb6:1 Ab6:1',
        'F6:1 Ab6:1 Bb6:1 C7:1 Bb6:1 Ab6:1 F6:1 Eb6:1',
        rest,
        rest,
        'F5:4 R:4',
        'F5:1 F5:1 Ab5:1 Bb5:1 C6:2 Ab5:2',
        'Bb5:1 Ab5:1 F5:1 Eb5:1 F5:4',
        'C6:1 Bb5:1 Ab5:1 F5:1 Eb5:1 F5:1 Ab5:1 Bb5:1',
        'C6:2 Ab5:2 F5:4',
        'F5:1 Ab5:1 Bb5:1 C6:1 Eb6:2 C6:2',
        'Bb5:2 Ab5:2 F5:4',
      ],
      {
        directions: [
          { words: 'intro - pad only' },
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          { words: 'build: rising cell' },
          null,
          null,
          null,
          { words: 'climb' },
          null,
          { words: 'hold the tension' },
          null,
          { dynamic: 'p', words: 'break' },
          null,
          { dynamic: 'f', words: 'drop' },
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
        bassFm,
        bassDb,
        bassEb,
        bassAb,
        bassFm,
        bassDb,
        bassEb,
        bassAb,
        bassFm,
        bassDb,
        bassEb,
        bassAb,
        rest,
        rest,
        bassFm,
        bassDb,
        bassEb,
        bassAb,
        bassFm,
        'F2:4 C3:2 F2:2',
      ],
      {
        directions: [
          null,
          null,
          null,
          null,
          { dynamic: 'mp', words: 'groove enters' },
          null,
          null,
          null,
          { dynamic: 'mf' },
          null,
          null,
          null,
          null,
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
      'P3',
      'Synth Pad',
      'Pad',
      'Synth Pad',
      3,
      89,
      'treble',
      [
        padFm,
        padDb,
        padEb,
        padAb,
        padFm,
        padDb,
        padEb,
        padAb,
        padFm,
        padDb,
        padEb,
        padAb,
        padFm,
        padDb,
        padEb,
        padAb,
        padFm,
        padDb,
        padFm,
        padDb,
        padEb,
        padAb,
        padFm,
        padFm,
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
          null,
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
      'House Drum Kit',
      'Drs.',
      'Acoustic Bass Drum',
      10,
      1,
      'percussion',
      [
        rest,
        rest,
        rest,
        rest,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
        snareRoll,
        rest,
        rest,
        floor,
        floor,
        floor,
        floor,
        floor,
        floor,
      ],
      {
        percussionInstruments: {
          K: { id: 'P4-I1', name: 'Acoustic Bass Drum', unpitched: 36 },
          S: { id: 'P4-I2', name: 'Acoustic Snare', unpitched: 38 },
          H: { id: 'P4-I3', name: 'Closed Hi-Hat', unpitched: 42 },
        },
        directions: [
          { words: 'intro - no drums' },
          null,
          null,
          null,
          { words: 'four on the floor' },
          null,
          null,
          null,
          { words: 'build: hats and snare' },
          null,
          null,
          null,
          null,
          null,
          null,
          { words: 'snare roll' },
          { dynamic: 'p' },
          null,
          { dynamic: 'ff' },
        ],
      },
    ),
  ],
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'edm-festival-anthem.musicxml');
fs.writeFileSync(out, score(example));
console.log(out);
