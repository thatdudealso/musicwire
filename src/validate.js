import { XMLParser, XMLValidator } from 'fast-xml-parser';

const lineOf = (xml, needle) => xml.slice(0, Math.max(0, xml.indexOf(needle))).split('\n').length;
const issue = (xml, needle, measure, message, fixHint) => ({
  line: lineOf(xml, needle),
  measure,
  message,
  fix_hint: fixHint,
});

export function validateMusicXml(xml) {
  const errors = [];
  if (typeof xml !== 'string' || xml.length === 0)
    return {
      valid: false,
      errors: [
        issue(
          '',
          '',
          null,
          'MusicXML must be a non-empty string or byte body.',
          'Send raw application/xml bytes or JSON {"musicxml":"..."}; filesystem paths are never accepted.',
        ),
      ],
    };
  const forbiddenDeclaration = /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml);
  if (forbiddenDeclaration)
    errors.push(
      issue(
        xml,
        '<!',
        null,
        'DOCTYPE, entities, and stylesheets are not accepted.',
        'Remove external declarations. Musicwire parses XML without entity or network access.',
      ),
    );
  const parsed = XMLValidator.validate(xml, { allowBooleanAttributes: false, unpairedTags: [] });
  if (parsed !== true)
    errors.push({
      line: parsed.err.line,
      measure: null,
      message: parsed.err.msg,
      fix_hint: 'Correct the XML syntax and submit a complete MusicXML document.',
    });
  const root =
    parsed === true && !forbiddenDeclaration
      ? new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)[
          'score-partwise'
        ]
      : null;
  if (!root || !['4.0', '4.1'].includes(root['@_version']))
    errors.push(
      issue(
        xml,
        '<score-partwise',
        null,
        'Expected a MusicXML 4.0 score-partwise root.',
        'Use <score-partwise version="4.0"> as the document root.',
      ),
    );
  if (!root) return { valid: false, errors };
  const hasPartList = Object.hasOwn(root, 'part-list');
  const declaredParts = arrayOf(root['part-list']?.['score-part']);
  if (!hasPartList)
    errors.push(
      issue(
        xml,
        '<score-partwise',
        null,
        'Missing part-list.',
        'Add a part-list containing one score-part for every part.',
      ),
    );
  else if (declaredParts.length === 0)
    errors.push(
      issue(
        xml,
        '<part-list',
        null,
        'Part-list must declare at least one score-part.',
        'Add one <score-part id="P1"> declaration for every rendered part.',
      ),
    );
  const declaredPartIds = new Set(
    declaredParts
      .map((part) => part?.['@_id'])
      .filter((id) => typeof id === 'string' && id.length > 0),
  );
  const parts = arrayOf(root.part);
  if (parts.length === 0)
    errors.push(
      issue(
        xml,
        '<score-partwise',
        null,
        'Missing score part.',
        'Add at least one <part id="P1"> with one or more measures.',
      ),
    );
  for (const [index, part] of parts.entries()) {
    if (!declaredPartIds.has(part?.['@_id']))
      errors.push(
        issue(
          xml,
          '<part',
          null,
          `Part ${index + 1} is not declared in part-list.`,
          'Add a matching <score-part> declaration with the same id.',
        ),
      );
    const measures = arrayOf(part.measure);
    if (measures.length === 0)
      errors.push(
        issue(
          xml,
          '<part',
          null,
          `Part ${index + 1} has no measures.`,
          'Add one or more numbered measures to each part.',
        ),
      );
    else if (!measures.some(hasDurationOrType))
      errors.push(
        issue(
          xml,
          '<measure',
          null,
          `Part ${index + 1} has no note durations.`,
          'Add duration and type elements to notes.',
        ),
      );
  }
  return { valid: errors.length === 0, errors };
}

export function scoreFacts(xml, maxPlaybackMeasures = 20_000, maxPlaybackTempoEvents = 20_000) {
  const semanticXml = withoutNonElements(xml);
  const partCount = [...semanticXml.matchAll(/<part(?=\s|>)[^>]*id=["'][^"']+["'][^>]*>/gi)].length;
  const keyFifths = Number(semanticXml.match(/<fifths>\s*(-?\d+)\s*<\/fifths>/i)?.[1] ?? 0);
  const mode = semanticXml.match(/<mode>\s*(major|minor)\s*<\/mode>/i)?.[1] ?? 'major';
  const parts = semanticXml.match(/<part(?=\s|>)[\s\S]*?<\/part>/gi) ?? [];
  const partFacts = parts.map((part) =>
    partDuration(part, maxPlaybackMeasures, maxPlaybackTempoEvents),
  );
  const longest = partFacts.reduce(
    (current, candidate) => (candidate.seconds > current.seconds ? candidate : current),
    { tempo: 120, seconds: 0 },
  );
  const durationModelError = partFacts.find((part) => part.durationModelError)?.durationModelError;
  return {
    partCount,
    tempo: longest.tempo,
    key: { fifths: keyFifths, mode },
    scoreDurationSeconds: longest.seconds,
    ...(durationModelError ? { durationModelError } : {}),
  };
}

function partDuration(part, maxPlaybackMeasures, maxPlaybackTempoEvents) {
  if (hasUnsupportedNavigation(part))
    return {
      tempo: 120,
      seconds: 0,
      durationModelError:
        'Audio rendering does not support navigation-based playback duration modeling.',
    };
  let divisions = 1;
  const measures = (part.match(/<measure\b[\s\S]*?<\/measure>/gi) ?? []).map((measure) => {
    const data = measureData(measure, divisions);
    divisions = data.divisions;
    return data;
  });
  const playback = playbackFacts(measures, maxPlaybackMeasures, maxPlaybackTempoEvents);
  if (playback.error) return { tempo: 120, seconds: 0, durationModelError: playback.error };
  const events = [...playback.tempoEvents.entries()].sort((a, b) => a[0] - b[0]);
  if (events.length === 0 || events[0][0] > 0) events.unshift([0, 120]);
  let seconds = 0;
  for (let index = 0; index < events.length; index += 1) {
    const start = Math.min(playback.quarters, events[index][0]);
    const end = Math.min(playback.quarters, events[index + 1]?.[0] ?? playback.quarters);
    if (end > start) seconds += ((end - start) * 60) / Math.max(1, events[index][1]);
  }
  return { tempo: events[0][1], seconds };
}

function hasUnsupportedNavigation(part) {
  if (
    /<sound\b[^>]*\b(?:dacapo|dalsegno|tocoda|fine|forward-repeat|segno|coda|eyeglasses)\s*=/i.test(
      part,
    ) ||
    /<(?:segno|coda)\b/i.test(part)
  )
    return true;
  return [...part.matchAll(/<words\b[^>]*>([\s\S]*?)<\/words>/gi)].some((match) =>
    /\bd\s*\.?\s*c\.?|\bda\s+capo\b|\bd\s*\.?\s*s\.?|\bdal\s+segno\b|\bto\s+coda\b|\bfine\b/i.test(
      match[1],
    ),
  );
}

function measureData(measure, initialDivisions) {
  let divisions = initialDivisions;
  let cursor = 0;
  let maximum = 0;
  const tempoEvents = new Map();
  const tokens = measure.matchAll(
    /<direction\b[\s\S]*?<\/direction>|<divisions>\s*(\d+)\s*<\/divisions>|<sound\b[^>]*\btempo=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*>|<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>|<(note|backup|forward)\b[\s\S]*?<\/\4>/gi,
  );
  for (const token of tokens) {
    if (token[0].startsWith('<direction')) {
      const tempo = tempoInDirection(token[0]);
      if (tempo) {
        const offset =
          Number(token[0].match(/<offset\b[^>]*>\s*(-?\d+)\s*<\/offset>/i)?.[1] ?? 0) / divisions;
        tempoEvents.set(Number(Math.max(0, cursor + offset).toFixed(6)), tempo);
      }
      continue;
    }
    if (token[1]) {
      divisions = Math.max(1, Number(token[1]));
      continue;
    }
    if (token[2] || token[3]) {
      tempoEvents.set(Number(cursor.toFixed(6)), Number(token[2] ?? token[3]));
      continue;
    }
    const duration = durationInQuarters(token[0], divisions);
    if (token[4].toLowerCase() === 'backup') cursor = Math.max(0, cursor - duration);
    else if (token[4].toLowerCase() === 'note' && /<chord\s*\/?\s*>/i.test(token[0])) continue;
    else cursor += duration;
    maximum = Math.max(maximum, cursor);
  }
  return {
    divisions,
    quarters: maximum,
    tempoEvents,
    forward: repeatMarker(measure, 'forward'),
    backward: repeatMarker(measure, 'backward'),
    hasEnding: /<ending\b/i.test(measure),
  };
}

function playbackFacts(measures, maxPlaybackMeasures, maxPlaybackTempoEvents) {
  if (measures.some((measure) => measure.hasEnding))
    return { error: 'Audio rendering does not support ending-based repeat duration modeling.' };
  if (measures.some((measure) => measure.forward?.invalid || measure.backward?.invalid))
    return { error: 'Audio rendering has an unsupported repeat count.' };
  const limit = Math.max(
    1,
    Number.isSafeInteger(maxPlaybackMeasures) ? maxPlaybackMeasures : 20_000,
  );
  const tempoEventLimit = Math.max(
    1,
    Number.isSafeInteger(maxPlaybackTempoEvents) ? maxPlaybackTempoEvents : 20_000,
  );
  const tempoEvents = new Map();
  const repeats = new Map();
  let repeatStart = null;
  let forwardOpen = false;
  let quarters = 0;
  let playedMeasures = 0;
  let processedTempoEvents = 0;
  for (let index = 0; index < measures.length;) {
    if (playedMeasures >= limit)
      return { error: `Audio rendering exceeds the ${limit}-measure playback modeling limit.` };
    const measure = measures[index];
    playedMeasures += 1;
    if (processedTempoEvents + measure.tempoEvents.size > tempoEventLimit)
      return {
        error: `Audio rendering exceeds the ${tempoEventLimit}-event tempo modeling limit.`,
      };
    processedTempoEvents += measure.tempoEvents.size;
    for (const [position, tempo] of measure.tempoEvents)
      tempoEvents.set(Number((quarters + position).toFixed(6)), tempo);
    quarters += measure.quarters;
    if (measure.forward) {
      const start = measure.forward.location === 'right' ? index + 1 : index;
      if (forwardOpen && repeatStart !== start)
        return { error: 'Audio rendering does not support nested repeat duration modeling.' };
      repeatStart = start;
      forwardOpen = true;
    }
    if (measure.backward) {
      const start = repeatStart ?? 0;
      const key = `${start}:${index}`;
      const played = repeats.get(key) ?? 1;
      if (played < measure.backward.times) {
        repeats.set(key, played + 1);
        index = start;
        continue;
      }
      forwardOpen = false;
    }
    index += 1;
  }
  return { quarters, tempoEvents };
}

function repeatMarker(measure, direction) {
  const match = measure.match(
    new RegExp(`<repeat\\b(?=[^>]*\\bdirection=["']${direction}["'])[^>]*>`, 'i'),
  );
  if (!match) return null;
  const times =
    direction === 'backward' ? Number(match[0].match(/\btimes=["'](\d+)["']/i)?.[1] ?? 2) : 1;
  if (!Number.isInteger(times) || times < 1 || times > 16) return { invalid: true };
  const location =
    measure.match(
      /<barline\b[^>]*\blocation=["'](left|right)["'][^>]*>[\s\S]*?<repeat\b(?=[^>]*\bdirection=["'](?:forward|backward)["'])/i,
    )?.[1] ?? 'left';
  return { times, location };
}

function durationInQuarters(event, divisions) {
  const encoded = event.match(/<duration>\s*(\d+)\s*<\/duration>/i)?.[1];
  if (encoded !== undefined) return Number(encoded) / divisions;
  if (/^<note\b/i.test(event) && /<grace\b[^>]*\/?\s*>/i.test(event)) return 0;
  const type = event
    .match(/<type>\s*(whole|half|quarter|eighth|16th|32nd|64th|128th|256th)\s*<\/type>/i)?.[1]
    ?.toLowerCase();
  const quarters =
    {
      whole: 4,
      half: 2,
      quarter: 1,
      eighth: 0.5,
      '16th': 0.25,
      '32nd': 0.125,
      '64th': 0.0625,
      '128th': 0.03125,
      '256th': 0.015625,
    }[type] ?? 0;
  const dots = event.match(/<dot\b[^>]*\/?\s*>/gi)?.length ?? 0;
  const actualNotes = Number(
    event.match(/<time-modification>[\s\S]*?<actual-notes>\s*(\d+)\s*<\/actual-notes>/i)?.[1] ?? 1,
  );
  const normalNotes = Number(
    event.match(/<time-modification>[\s\S]*?<normal-notes>\s*(\d+)\s*<\/normal-notes>/i)?.[1] ?? 1,
  );
  return (quarters * (2 - 2 ** -dots) * normalNotes) / actualNotes;
}

function tempoInDirection(direction) {
  return Number(
    direction.match(/<sound\b[^>]*\btempo=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*>/i)?.[1] ??
      direction.match(/<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>/i)?.[1] ??
      0,
  );
}

function withoutNonElements(xml) {
  return xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
}

function arrayOf(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function hasDurationOrType(value) {
  if (Array.isArray(value)) return value.some(hasDurationOrType);
  if (!value || typeof value !== 'object') return false;
  if ('duration' in value || 'type' in value) return true;
  return Object.values(value).some(hasDurationOrType);
}
