# Metalcore production brief — gym-pump / I Prevail-class

Genre 2 of 4. Original instrumental only. Style-of modern metalcore gym-pump (I Prevail class: melodic chorus hook over low chugs, then a half-time breakdown). Do not quote any copyrighted riff or lyric.

Sources (accessed 2026-08-31):

- Songbrain, "How to Write Metalcore Breakdowns That Hit" (2026-04-20): keep tempo; cut subdivision in half for the breakdown (1/8 chugs at 150 BPM feel like 75 BPM halftime); dead-air gap before the drop; one chug pattern per section; kick locked to chugs, snare on 2 and 4 or beat 3 in half-time, crash/china on bar 1.
- Lyric Assistant, "How to Write Metalcore Songs" (2024-09-30): energetic riffs 140-190 BPM; breakdowns drop busy high end, use silence as weight, keep tempo and switch to half-time rather than slowing the click.
- I Prevail class references (structure only, never the riffs): Songsterr lists Bow Down at 155 BPM 4/4 Drop G-class tuning; Gasoline lesson video clocks the body at 135 BPM 4/4 with a short 140 BPM bridge. Use that _class_ (drop-tuned chug verse, open chorus, half-time breakdown). Do not quote Bow Down / Gasoline / Hurricane / Body Bag.

## Instrumentation (MusicXML ensemble, not piano)

| Part                 | MusicXML / GM                                                      | Role                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Distortion Guitar    | GM 31                                                              | Palm-muted 8th chugs on the verse; open power chords on the chorus; quarter chugs on the breakdown.                                         |
| Overdriven Guitar    | GM 30                                                              | Melodic gym-hook on the chorus only. Tacet on verse/breakdown so the riff stays dry.                                                        |
| Electric Bass (pick) | GM 35                                                              | Locks to the guitar root. 8ths on verse, quarters on breakdown.                                                                             |
| Drum Kit             | unpitched GM kit ch.10: kick 36, snare 38, closed hat 42, crash 49 | Verse = kick 1+3, snare 2+4, hats 8ths. Breakdown = crash+kick on 1, kick on 3, snare on 3. Unpitched encoding, never pitched "drum" notes. |

## Tempo, key, length

- 150 BPM, 4/4, D minor (one flat). Gym-pump metalcore tempo in the Songbrain 150 BPM half-time example; D minor maps cleanly to drop-D power chords without copying I Prevail Drop B/A# tunings.
- 32 bars = 51.2s written (`32 * 4 * 60 / 150`). Under the 60s render cap. Distortion guitar is not a sustained pad, so QC tail is the 3s base allowance.
- Divisions=2 (8th-note grid). Same generator that already passed production QC on the EDM cut.

## Harmony and groove

Loop: Dm | Bb | F | C (i - VI - III - VII). Regular 4-bar phrases.

Verse chug: 8ths on the root with a fifth on the last offbeat of each bar. One pattern for the whole verse (Songbrain: pick ONE chug pattern per section).

Breakdown: same roots as quarters (half the subdivision, same 150 BPM click).

Chorus: open power-chord halves so the lead hook can sit on top.

## Arrangement arc (32 bars)

1. Bars 1-4: intro. Muted chugs + kick only. No snare, no lead.
2. Bars 5-12: verse. Full kit (kick 1+3, snare 2+4, hats 8ths), bass, rhythm. Lead tacet.
3. Bars 13-16: chorus. Open power chords, lead hook, full kit.
4. Bars 17-18: dead air. Bar 17 rest; bar 18 one guitar hit then rest (Songbrain silence-before-drop).
5. Bars 19-26: breakdown. Quarter chugs, crash on 1, kick locked, snare on 3. Heaviest moment.
6. Bars 27-28: chorus tag (lead returns).
7. Bars 29-32: final breakdown cadence on D.

## Anti-patterns

- Piano or clean-guitar substituting for the distortion/kit skeleton.
- Slowing the tempo for the breakdown instead of cutting subdivision.
- Copying Bow Down / Gasoline / Hurricane / Body Bag riffs, or any lyric.
- Scores much shorter than ~40s (QC tail vs duration).
- Pitched "drum" notes instead of unpitched kit.
- Mixing several chug patterns inside one section.

## Captions for the live demo (no narration)

Compose -> Validate $0.10 -> Render ensemble $0.50 -> Pay USDC (self-test) -> Play.

Original title: **Forge Current**.
