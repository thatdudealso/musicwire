export const composeGuideVersion = '2026-08-17';

export function composeGuide(query) {
  const constraints = {
    style: query.style ?? null,
    use: query.use ?? null,
    duration: query.duration ?? null,
    key: query.key ?? null,
    tempo: query.tempo ?? null,
    edit: query.edit === 'true',
  };
  const editInstruction = constraints.edit
    ? 'Edit the supplied MusicXML conservatively. Preserve valid structure, existing parts, and intentional musical material unless the brief asks to change them.'
    : 'Create original MusicXML from the brief. Do not copy copyrighted melodies; use only public-domain or caller-owned material.';

  return {
    version: composeGuideVersion,
    llm_prompt: `Write a complete MusicXML 4.0 partwise score. ${editInstruction} Include title, creator, key, time signature, tempo, dynamics, and a final barline. ${constraints.style ? `Style: ${constraints.style}. ` : ''}${constraints.use ? `Use: ${constraints.use}. ` : ''}${constraints.duration ? `Target duration: ${constraints.duration}. ` : ''}${constraints.key ? `Key: ${constraints.key}. ` : ''}${constraints.tempo ? `Tempo: ${constraints.tempo}. ` : ''}Return MusicXML only.`,
    authoring_rules: [
      'Prefer MusicXML 4.0 partwise with an XML declaration and score-partwise root.',
      'Set divisions, key, time, staves, and clefs in measure 1. With divisions=1, a quarter note is duration 1; use divisions 2 or 4 for shorter notes.',
      'For piano, use two staves: right hand voice 1/staff 1, then a backup for the full measure before left hand voice 5/staff 2.',
      'Put <chord/> before every additional chord tone and use <alter>-1</alter> for flats such as B-flat.',
      'Include a metronome direction and <sound tempo="..."/>. Finish the score with a light-heavy final barline.',
    ],
    quality_bar: [
      'Give the piece a clear phrase shape and a harmonic plan that matches the key.',
      'Keep ranges playable, add dynamics and at least one tempo marking, and end on a tonic or clear cadence.',
      'For short pieces, use an 8-16 bar A-B-A-prime or cadence shape. Avoid endless drones, frozen pads, and random scale picks.',
      'Use original material only. Musicwire does not provide copyrighted-melody transcription.',
    ],
    constraints_echo: constraints,
    examples: [
      { label: 'MusicXML 4.0 partwise', url: 'https://www.w3.org/2021/06/musicxml40/' },
      { label: 'MuseScore import and export', url: 'https://musescore.org/en/faq' },
    ],
    next_steps: [
      'POST the MusicXML string or raw XML bytes to /v1/validate.',
      'POST it to /v1/render with the desired formats after validation. MusicXML and a NOTICE are always retained with the job.',
    ],
  };
}
