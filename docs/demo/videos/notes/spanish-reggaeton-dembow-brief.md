# Spanish reggaeton production brief — Bad Bunny / Daddy Yankee-class dembow

Genre 4 of 4. Original instrumental only. Style-of Spanish-language-market reggaeton (Bad Bunny / Daddy Yankee class: dembow groove, minor-key synth hook, 808-ish bass). Do not quote any copyrighted melody, lyric, or Gasolina/Titi hook.

Sources (accessed 2026-08-31):

- Orphiq, "What Is Reggaeton?": most tracks 85-100 BPM; kick+snare dembow plus conga/timbale texture; synth pads and piano loops sit on top; bass follows the kick and adds melodic movement.
- BeatKey, "How to Make Reggaeton Music": classic perreo 90-98 BPM, modern 94-100; keys G/A/D minor; 16-step dembow with snares on steps 7 and 15 (the "e" of 2 and 4); im7-bVII-bVI core.
- Native Instruments, "What is reggaeton? How to make reggaeton beats" (2023-03-20): start 90 BPM; kick on the first two beats of each half-bar; snare on the last 16th of beat 1 and the third 16th of beat 2, then duplicate - the Dem Bow foundation.
- Berklee, "Dembow Explained" (2024-03-18): Dem Bow from dancehall into Puerto Rican reggaeton; Gasolina and Un Verano Sin Ti as _class_ references, never copies.
- Se7en BPM Index (updated 2026-07): 90-96 BPM pocket, 95 typical; hook-first form, chorus often inside 20 seconds.

On an 8th-note grid (divisions=2) the classic dembow approximates as: kick on 1 and the "and" of 2, snare on the "and" of 2 and on 4, hats 8ths. Pattern per bar: `UKC4,UHG5 :1  UHG5 :1  USC5,UKC4,UHG5 :1  UHG5 :1  UKC4,UHG5 :1  UHG5 :1  USC5,UHG5 :1  UHG5 :1`.

## Instrumentation (MusicXML ensemble, not piano)

| Part       | MusicXML / GM                                            | Role                                                                        |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Synth Lead | GM 82 saw lead                                           | Short 8th-note dembow topline. Tacet on the first intro bars.               |
| Synth Bass | GM 39                                                    | Root 8ths locking kick, fifth on offbeats. Leaves space on the break.       |
| Synth Pad  | GM 89 pad                                                | Minor-key pads so QC uses the sustained tail allowance. Piano on the break. |
| Dembow Kit | unpitched GM kit ch.10: kick 36, snare 38, closed hat 42 | The dembow pattern above. No four-on-the-floor house kit.                   |

## Tempo, key, length

- 96 BPM, 4/4, D minor (one flat). Perreo sweet-spot (BeatKey 94-96) in a guitar/synth-friendly minor.
- 24 bars = 60.0s written (`24 * 4 * 60 / 96`). Exactly the render cap. Pad sustain must not run far past 60s; keep the last bar a short cadence, not a held whole-note pad if that overruns. If QC is tight on the 60s wall, drop to 20 bars = 50.0s.
- Using **20 bars = 50.0s** to leave headroom under `maxRenderSeconds=60` plus the 3.25s sustained pad tail.
- Divisions=2.

## Harmony and groove

Loop: Dm | C | Bb | C (i - bVII - bVI - bVII). Two-bar harmonic rhythm inside a 4-bar phrase.

Bass 8ths on D2 / C2 / Bb1 / C2 with a fifth on the "and" of 2.

## Arrangement arc (20 bars)

1. Bars 1-4: intro. Pad + hats, no kick/snare, no bass. Lead states a 2-bar cell in bars 3-4.
2. Bars 5-8: groove. Full dembow + bass; pad continues; lead tacet.
3. Bars 9-12: hook. Lead 8ths over full groove (the "chorus" inside 20 seconds, per Se7en).
4. Bars 13-14: break. Kit and bass drop; pad piano; one lead hold.
5. Bars 15-20: dembow drop. Full kit, bass, pad forte, lead hook. Final bar cadences on D.

## Anti-patterns

- Four-on-the-floor house drums instead of dembow.
- Piano solo substituting for synth/bass/kit.
- Copying Gasolina / Tití Me Preguntó / Dakiti / Despacito riffs, or any lyric.
- Dominican dembow 115-130 BPM (wrong subgenre).
- Scores that write 24 bars at 96 BPM (exactly 60s) and then overrun the render cap via pad tail.

## Captions for the live demo (no narration)

Compose -> Validate $0.10 -> Render ensemble $0.50 -> Pay USDC (self-test) -> Play.

Original title: **Noche Baja**.
