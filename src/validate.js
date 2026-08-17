import { XMLValidator } from 'fast-xml-parser';

const lineOf = (xml, needle) => xml.slice(0, Math.max(0, xml.indexOf(needle))).split('\n').length;
const issue = (xml, needle, measure, message, fixHint) => ({ line: lineOf(xml, needle), measure, message, fix_hint: fixHint });

export function validateMusicXml(xml) {
  const errors = [];
  if (typeof xml !== 'string' || xml.length === 0) return { valid: false, errors: [issue('', '', null, 'MusicXML must be a non-empty string or byte body.', 'Send raw application/xml bytes or JSON {"musicxml":"..."}; filesystem paths are never accepted.')] };
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) errors.push(issue(xml, '<!', null, 'DOCTYPE, entities, and stylesheets are not accepted.', 'Remove external declarations. Musicwire parses XML without entity or network access.'));
  if (!/^\uFEFF?\s*(?:<\?xml\b[\s\S]*?\?>\s*)?(?:(?:<!--[\s\S]*?-->)|(?:<\?(?!xml\b)[\s\S]*?\?>))*\s*<score-partwise\b[^>]*\bversion=["']4(?:\.0|\.1)?["']/i.test(xml)) errors.push(issue(xml, '<score-partwise', null, 'Expected a MusicXML 4.0 score-partwise root.', 'Use <score-partwise version="4.0"> as the document root.'));
  const parsed = XMLValidator.validate(xml, { allowBooleanAttributes: false, unpairedTags: [] });
  if (parsed !== true) errors.push({ line: parsed.err.line, measure: null, message: parsed.err.msg, fix_hint: 'Correct the XML syntax and submit a complete MusicXML document.' });
  const semanticXml = xml.replace(/<!--[\s\S]*?-->/g, '');
  if (!/<part-list\b/i.test(semanticXml)) errors.push(issue(xml, '<score-partwise', null, 'Missing part-list.', 'Add a part-list containing one score-part for every part.'));
  const parts = [...semanticXml.matchAll(/<part(?=\s|>)[^>]*id=["']([^"']+)["'][^>]*>/gi)];
  if (parts.length === 0) errors.push(issue(xml, '<score-partwise', null, 'Missing score part.', 'Add at least one <part id="P1"> with one or more measures.'));
  for (const part of parts) {
    const afterPart = semanticXml.slice(part.index);
    if (!/<measure\b/i.test(afterPart)) errors.push(issue(xml, part[0], null, `Part ${part[1]} has no measures.`, 'Add one or more numbered measures to each part.'));
  }
  const measures = [...semanticXml.matchAll(/<measure\b[^>]*number=["']?([^"' >]+)["']?[^>]*>/gi)];
  if (measures.length > 0 && !/<(duration|type)\b/i.test(semanticXml)) errors.push(issue(xml, measures[0][0], measures[0][1], 'Score has no note durations.', 'Add duration and type elements to notes.'));
  return { valid: errors.length === 0, errors };
}

export function scoreFacts(xml) {
  const partCount = [...xml.matchAll(/<part\b[^>]*id=["'][^"']+["'][^>]*>/gi)].length;
  const keyFifths = Number((xml.match(/<fifths>\s*(-?\d+)\s*<\/fifths>/i)?.[1]) ?? 0);
  const mode = xml.match(/<mode>\s*(major|minor)\s*<\/mode>/i)?.[1] ?? 'major';
  const parts = xml.match(/<part(?=\s|>)[\s\S]*?<\/part>/gi) ?? [];
  const longest = parts.map(partDuration).reduce((current, candidate) => candidate.seconds > current.seconds ? candidate : current, { tempo: 120, seconds: 0 });
  return { partCount, tempo: longest.tempo, key: { fifths: keyFifths, mode }, scoreDurationSeconds: longest.seconds };
}

function partDuration(part) {
  const tempoEvents = new Map();
  let divisions = 1;
  let partQuarters = 0;
  for (const measure of part.match(/<measure\b[\s\S]*?<\/measure>/gi) ?? []) {
    let cursor = 0;
    let maximum = 0;
    const tokens = measure.matchAll(/<direction\b[\s\S]*?<\/direction>|<divisions>\s*(\d+)\s*<\/divisions>|<sound\b[^>]*\btempo=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*>|<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>|<(note|backup|forward)\b[\s\S]*?<\/\4>/gi);
    for (const token of tokens) {
      if (token[0].startsWith('<direction')) {
        const tempo = tempoInDirection(token[0]);
        if (tempo) {
          const offset = Number(token[0].match(/<offset\b[^>]*>\s*(-?\d+)\s*<\/offset>/i)?.[1] ?? 0) / divisions;
          tempoEvents.set(Number(Math.max(0, partQuarters + cursor + offset).toFixed(6)), tempo);
        }
        continue;
      }
      if (token[1]) { divisions = Math.max(1, Number(token[1])); continue; }
      if (token[2] || token[3]) { tempoEvents.set(Number((partQuarters + cursor).toFixed(6)), Number(token[2] ?? token[3])); continue; }
      const duration = Number(token[0].match(/<duration>\s*(\d+)\s*<\/duration>/i)?.[1] ?? 0) / divisions;
      if (token[4].toLowerCase() === 'backup') cursor = Math.max(0, cursor - duration);
      else if (token[4].toLowerCase() === 'note' && /<chord\s*\/?\s*>/i.test(token[0])) continue;
      else cursor += duration;
      maximum = Math.max(maximum, cursor);
    }
    partQuarters += maximum;
  }
  const events = [...tempoEvents.entries()].sort((a, b) => a[0] - b[0]);
  if (events.length === 0 || events[0][0] > 0) events.unshift([0, 120]);
  let seconds = 0;
  for (let index = 0; index < events.length; index += 1) {
    const start = Math.min(partQuarters, events[index][0]);
    const end = Math.min(partQuarters, events[index + 1]?.[0] ?? partQuarters);
    if (end > start) seconds += (end - start) * 60 / Math.max(1, events[index][1]);
  }
  return { tempo: events[0][1], seconds };
}

function tempoInDirection(direction) {
  return Number(direction.match(/<sound\b[^>]*\btempo=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*>/i)?.[1]
    ?? direction.match(/<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>/i)?.[1]
    ?? 0);
}
