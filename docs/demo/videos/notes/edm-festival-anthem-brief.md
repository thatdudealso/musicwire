# EDM production brief — festival / big-room anthem

Genre 1 of 4. Original instrumental only. Style-of Avicii / Calvin Harris-class festival EDM; do not quote any copyrighted melody or lyric.

Sources (accessed 2026-08-31):

- The Ghost Production, "EDM festival tracks: 9 Stage Rules" (2026-07-10): big-room/mainstage tempo 126-130 BPM (128 still DJ-compatible); core skeleton is kick, bass, lead hook, clap/snare; keys F/G/A minor sit well on large systems; phrase lengths stay regular.
- Melodigging, "Big Room House": 126-132 BPM (128 standard); four-on-the-floor; supersaw or horn-like stabs; lush reverberant breakdown vs dry punchy drop; intro 8-16 bars, breakdown, 8-16 bar build (snare rolls / risers), 16-32 bar drop.
- EDM Tips (Ableton tutorial "How to Make PROGRESSIVE HOUSE (like AVICII)"): start 126 BPM; chord progression first, then kick+bass, then drop; sidechain implied by groove contrast rather than a DAW compressor (MusicXML cannot encode sidechain).
- Dance-Charts EDM-Klassiker list: Avicii = memorable synth topline over four-on-the-floor; Calvin Harris festival records = bright major/minor hooks and dry drops. Use that _class_ of writing, never those riffs.

## Instrumentation (MusicXML ensemble, not piano)

| Part           | MusicXML / GM                                            | Role                                                                                                            |
| -------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Synth Lead     | GM 82 saw lead                                           | Festival topline. Narrower/drier on the drop (shorter notes).                                                   |
| Synth Bass     | GM 39 synth bass                                         | Root + fifth 8ths. Leaves space on the break.                                                                   |
| Synth Pad      | GM 89 pad                                                | Wide Fm-family pads on intro/break; full on drop. Declared "Synth Pad" so QC uses the sustained tail allowance. |
| House Drum Kit | unpitched GM kit ch.10: kick 36, snare 38, closed hat 42 | Four-on-the-floor; hats 8ths; snare on 2 and 4; 8th snare roll on the last build bar.                           |

Same percussion encoding as the proven `08-ensemble-house-edm-lantern-call` showcase (unpitched + `midi-unpitched`). Do not write drums as pitched notes.

## Tempo, key, length

- 128 BPM, 4/4, F minor (four flats). Festival-safe key per Ghost Production.
- 24 bars = 45.0s written (`24 * 4 * 60 / 128`). Showcase ensembles that pass QC are ~46s; avoid sub-10s scores (the old two-voice docs example failed `audio_duration_mismatch` because strings/pads overran a short duration).
- Divisions=2 (8th-note grid). Matches the generator that already passes production QC.

## Harmony and groove

Loop: Fm | Db | Eb | Ab (i - VI - VII - III). Regular 8-bar phrases.

Bass 8ths on the groove/drop: F2 / Db2 / Eb2 / Ab1 with a fifth above on offbeats. Rest during intro and the 2-bar break.

Kick every quarter. Closed hat every 8th. Snare with kick on beats 2 and 4.

## Arrangement arc (24 bars)

1. Bars 1-4: pad-only intro (no drums, no bass, no lead).
2. Bars 5-8: groove enters (kick/hat/snare + bass); pad continues; lead still tacet.
3. Bars 9-16: build. Lead states a short rising cell, then climbs. Last build bar is an 8th-note snare roll.
4. Bars 17-18: break. Drums and bass drop out; pad piano; one bar of lead held quiet.
5. Bars 19-24: drop. Full kit, bass, pad forte, lead hook in 8ths. Final bar cadences on F.

## Anti-patterns

- Generic piano-led writing.
- Straight 8-bar loop with no break before the drop.
- Acoustic drumset or piano substituting for the synth/kit skeleton.
- Copying Levels / Wake Me Up / Summer / Outside / I'm Not Alone riffs, or any lyric.
- Scores much shorter than ~40s (QC tail vs duration).
- Pitched "drum" notes instead of unpitched kit.

## Captions for the live demo (no narration)

Compose -> Validate $0.10 -> Render ensemble $0.50 -> Pay USDC (self-test) -> Play.
