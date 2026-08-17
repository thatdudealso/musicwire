import { XMLValidator } from 'fast-xml-parser';

const lineOf = (xml, needle) => xml.slice(0, Math.max(0, xml.indexOf(needle))).split('\n').length;
const issue = (xml, needle, measure, message, fixHint) => ({ line: lineOf(xml, needle), measure, message, fix_hint: fixHint });

export function validateMusicXml(xml) {
  const errors = [];
  if (typeof xml !== 'string' || xml.length === 0) return { valid: false, errors: [issue('', '', null, 'MusicXML must be a non-empty string or byte body.', 'Send raw application/xml bytes or JSON {"musicxml":"..."}; filesystem paths are never accepted.')] };
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(xml)) errors.push(issue(xml, '<!', null, 'DOCTYPE, entities, and stylesheets are not accepted.', 'Remove external declarations. Musicwire parses XML without entity or network access.'));
  if (!/<score-partwise\b[^>]*version=["']4(?:\.0|\.1)?["']/i.test(xml)) errors.push(issue(xml, '<score-partwise', null, 'Expected a MusicXML 4.0 score-partwise root.', 'Use <score-partwise version="4.0"> as the document root.'));
  const parsed = XMLValidator.validate(xml, { allowBooleanAttributes: false, unpairedTags: [] });
  if (parsed !== true) errors.push({ line: parsed.err.line, measure: null, message: parsed.err.msg, fix_hint: 'Correct the XML syntax and submit a complete MusicXML document.' });
  if (!/<part-list\b/i.test(xml)) errors.push(issue(xml, '<score-partwise', null, 'Missing part-list.', 'Add a part-list containing one score-part for every part.'));
  const parts = [...xml.matchAll(/<part\b[^>]*id=["']([^"']+)["'][^>]*>/gi)];
  if (parts.length === 0) errors.push(issue(xml, '<score-partwise', null, 'Missing score part.', 'Add at least one <part id="P1"> with one or more measures.'));
  for (const part of parts) {
    const afterPart = xml.slice(part.index);
    if (!/<measure\b/i.test(afterPart)) errors.push(issue(xml, part[0], null, `Part ${part[1]} has no measures.`, 'Add one or more numbered measures to each part.'));
  }
  const measures = [...xml.matchAll(/<measure\b[^>]*number=["']?([^"' >]+)["']?[^>]*>/gi)];
  if (measures.length > 0 && !/<(duration|type)\b/i.test(xml)) errors.push(issue(xml, measures[0][0], measures[0][1], 'Score has no note durations.', 'Add duration and type elements to notes.'));
  return { valid: errors.length === 0, errors };
}

export function scoreFacts(xml) {
  const partCount = [...xml.matchAll(/<part\b[^>]*id=["'][^"']+["'][^>]*>/gi)].length;
  const tempo = Number(xml.match(/<sound\b[^>]*\btempo=["']([0-9]+(?:\.[0-9]+)?)["']/i)?.[1] ?? xml.match(/<per-minute>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/per-minute>/i)?.[1] ?? 90);
  const keyFifths = Number((xml.match(/<fifths>\s*(-?\d+)\s*<\/fifths>/i)?.[1]) ?? 0);
  const mode = xml.match(/<mode>\s*(major|minor)\s*<\/mode>/i)?.[1] ?? 'major';
  const parts = xml.match(/<part\b[\s\S]*?<\/part>/gi) ?? [];
  const durationByPart = parts.map((part) => {
    let total = 0;
    for (const measure of part.match(/<measure\b[\s\S]*?<\/measure>/gi) ?? []) {
      let cursor = 0;
      let maximum = 0;
      for (const token of measure.match(/<(?:note|backup|forward)\b[\s\S]*?<\/(?:note|backup|forward)>/gi) ?? []) {
        const duration = Number(token.match(/<duration>\s*(\d+)\s*<\/duration>/i)?.[1] ?? 0);
        if (/^<backup\b/i.test(token)) cursor = Math.max(0, cursor - duration);
        else if (/^<note\b/i.test(token) && /<chord\s*\/?\s*>/i.test(token)) continue;
        else cursor += duration;
        maximum = Math.max(maximum, cursor);
      }
      total += maximum;
    }
    return total;
  });
  const divisions = Number(xml.match(/<divisions>\s*(\d+)\s*<\/divisions>/i)?.[1] ?? 1);
  const scoreDurationSeconds = Math.max(0, ...durationByPart) / Math.max(1, divisions) * 60 / Math.max(1, tempo);
  return { partCount, tempo, key: { fifths: keyFifths, mode }, scoreDurationSeconds };
}
