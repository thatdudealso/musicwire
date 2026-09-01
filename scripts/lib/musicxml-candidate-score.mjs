import assert from 'node:assert/strict';

const typeForDuration = {
  2: {
    1: 'eighth',
    2: 'quarter',
    3: 'quarter',
    4: 'half',
    6: 'half',
    8: 'whole',
  },
  4: {
    1: '16th',
    2: 'eighth',
    3: 'eighth',
    4: 'quarter',
    6: 'quarter',
    8: 'half',
    12: 'half',
    16: 'whole',
  },
};

const dottedDurations = new Set([3, 6, 12]);

export const xml = (value) =>
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

const renderNote = (
  pitch,
  duration,
  divisions,
  { chord = false, instrumentId, unpitched = false } = {},
) => {
  const types = typeForDuration[divisions];
  assert.ok(types?.[duration], `Unsupported duration ${duration} at divisions=${divisions}`);
  const body = unpitched
    ? (() => {
        const match = pitch.match(/^([A-G])(\d+)$/);
        assert.ok(match, `Invalid display pitch ${pitch}`);
        return `<unpitched><display-step>${match[1]}</display-step><display-octave>${match[2]}</display-octave></unpitched>`;
      })()
    : parsePitch(pitch);
  return `<note>${chord ? '<chord/>' : ''}${body}${instrumentId ? `<instrument id="${instrumentId}"/>` : ''}<duration>${duration}</duration><type>${types[duration]}</type>${dottedDurations.has(duration) ? '<dot/>' : ''}</note>`;
};

const renderMeasureEvents = (source, part, divisions) => {
  const events = source.trim().split(/\s+/).filter(Boolean);
  const expected = divisions * 4;
  const total = events.reduce((sum, event) => {
    const duration = Number(event.match(/:(\d+)$/)?.[1]);
    assert.ok(typeForDuration[divisions][duration], `Unsupported duration in ${event}`);
    return sum + duration;
  }, 0);
  assert.equal(total, expected, `Measure must contain ${expected} divisions: ${source}`);
  return events
    .map((event) => {
      const [, token, durationText] = event.match(/^(.+):(\d+)$/) ?? [];
      const duration = Number(durationText);
      if (token === 'R')
        return `<note><rest/><duration>${duration}</duration><type>${typeForDuration[divisions][duration]}</type>${dottedDurations.has(duration) ? '<dot/>' : ''}</note>`;
      const pitches = token.replace(/^\[/, '').replace(/\]$/, '').split(',');
      return pitches
        .map((sourcePitch, index) => {
          const unpitched = sourcePitch.startsWith('U');
          const unpitchedMatch = unpitched ? sourcePitch.match(/^U([A-Z]?)([A-G]\d)$/) : null;
          assert.ok(!unpitched || unpitchedMatch, `Invalid percussion token ${sourcePitch}`);
          const [, instrumentKey = '', pitch] = unpitchedMatch ?? [];
          return renderNote(unpitched ? pitch : sourcePitch, duration, divisions, {
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
  const divisions = example.divisions ?? 2;
  assert.equal(part.measures.length, example.measures, `${example.id}: part length drift`);
  return `<part id="${part.id}">${part.measures
    .map((measure, index) => {
      const attributes =
        index === 0
          ? `<attributes><divisions>${divisions}</divisions><key><fifths>${example.keyFifths}</fifths><mode>${example.mode}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time>${clefs[part.clef]}</attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${example.tempo}</per-minute></metronome></direction-type><sound tempo="${example.tempo}"/></direction>`
          : '';
      const direction = renderDirection(part.directions?.[index]);
      const closing =
        index === part.measures.length - 1
          ? '<barline location="right"><bar-style>light-heavy</bar-style></barline>'
          : '';
      return `<measure number="${index + 1}">${attributes}${direction}${renderMeasureEvents(measure, part, divisions)}${closing}</measure>`;
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

export const score = (example) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>${xml(example.title)}</work-title></work>
  <identification><creator type="composer">Musicwire genre gallery candidate</creator><encoding><software>Musicwire genre gallery candidates</software></encoding></identification>
  <part-list>${example.parts.map(scorePart).join('')}</part-list>
  ${example.parts.map((part) => renderPart(part, example)).join('\n  ')}
</score-partwise>
`;

export const part = (
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

export const kitInstruments = (partId) => ({
  K: { id: `${partId}-I1`, name: 'Acoustic Bass Drum', unpitched: 36 },
  S: { id: `${partId}-I2`, name: 'Acoustic Snare', unpitched: 38 },
  H: { id: `${partId}-I3`, name: 'Closed Hi-Hat', unpitched: 42 },
  O: { id: `${partId}-I4`, name: 'Open Hi-Hat', unpitched: 46 },
  C: { id: `${partId}-I5`, name: 'Crash Cymbal 1', unpitched: 49 },
  R: { id: `${partId}-I6`, name: 'Ride Cymbal 1', unpitched: 51 },
});

export const rest = (divisions = 4) => `R:${divisions * 4}`;

export const tile = (count, patterns) =>
  Array.from({ length: count }, (_, index) => patterns[index % patterns.length]);

export const section = (label, count, patterns, directions = {}) => ({
  label,
  count,
  patterns,
  directions,
});

export const flattenSections = (sections, patternFor) => {
  const measures = [];
  const directions = [];
  for (const item of sections) {
    for (let index = 0; index < item.count; index += 1) {
      measures.push(patternFor(item, index));
      const direction =
        index === 0
          ? { ...(item.directions.start ?? {}), words: item.directions.words ?? item.label }
          : (item.directions.each ?? null);
      directions.push(direction);
    }
  }
  return { measures, directions };
};

export const writtenSeconds = (measures, tempo) => (measures * 4 * 60) / tempo;
