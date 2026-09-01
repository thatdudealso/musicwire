import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateMusicXml, scoreFacts } from '../src/validate.js';
import {
  kitInstruments,
  part,
  rest,
  score,
  writtenSeconds,
} from './lib/musicxml-candidate-score.mjs';

const candidatesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/examples/candidates',
);

const R = rest(4);

const measureDuration = (source) =>
  source
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, event) => sum + Number(event.match(/:(\d+)$/)?.[1] ?? 0), 0);

const assemble = (sections) => {
  const measures = [];
  const directions = [];
  for (const section of sections) {
    for (let index = 0; index < section.count; index += 1) {
      const source = section.bars ?? section.pattern;
      const measure = typeof source === 'function' ? source(index) : source[index % source.length];
      assert.equal(measureDuration(measure), 16, `Measure duration: ${measure}`);
      measures.push(measure);
      directions.push(
        index === 0 && (section.words || section.dynamic)
          ? { words: section.words, dynamic: section.dynamic }
          : null,
      );
    }
  }
  return { measures, directions };
};

const kitPart = (id, measures, directions, name = 'Drum Kit') =>
  part(id, name, 'Drs.', 'Acoustic Bass Drum', 10, 1, 'percussion', measures, {
    percussionInstruments: kitInstruments(id),
    directions,
  });

const hats8 = 'UHG5:2 UHG5:2 UHG5:2 UHG5:2 UHG5:2 UHG5:2 UHG5:2 UHG5:2';
const backbeat = 'UKC4,UHG5:2 UHG5:2 USC5,UHG5:2 UHG5:2 UKC4,UHG5:2 UHG5:2 USC5,UHG5:2 UHG5:2';
const floor8 =
  'UKC4,UHG5:2 UHG5:2 UKC4,USC5,UHG5:2 UHG5:2 UKC4,UHG5:2 UHG5:2 UKC4,USC5,UHG5:2 UHG5:2';
const crashBackbeat =
  'UCC6,UKC4,UHG5:2 UHG5:2 USC5,UHG5:2 UHG5:2 UKC4,UHG5:2 UHG5:2 USC5,UHG5:2 UHG5:2';
const crashFloor =
  'UCC6,UKC4,UHG5:2 UHG5:2 UKC4,USC5,UHG5:2 UHG5:2 UKC4,UHG5:2 UHG5:2 UKC4,USC5,UHG5:2 UHG5:2';
const kickHats = 'UKC4,UHG5:4 UKC4,UHG5:4 UKC4,UHG5:4 UKC4,UHG5:4';
const fill = 'UKC4,UHG5:2 USC5:2 USC5:2 UKC4:2 USC5:2 USC5:2 UKC4,USC5:4';

const openHatFloor =
  'UKC4,UHG5:2 UOA5:2 UKC4,USC5,UHG5:2 UOA5:2 UKC4,UHG5:2 UOA5:2 UKC4,USC5,UHG5:2 UOA5:2';

const twoStep =
  'UKC4,UHG5:1 UHG5:1 UHG5:1 R:1 USC5,UHG5:1 UHG5:1 UKC4,UHG5:1 R:1 UHG5:1 UKC4,UHG5:1 UHG5:1 R:1 USC5,UHG5:1 UHG5:1 UOA5:1 R:1';

const dnbDrop =
  'UKC4,UHG5:1 UHG5:1 USC5:1 UHG5:1 USC5,UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1 UHG5:1 UHG5:1';

const trapVerse = 'UKC4,UHG5:4 UHG5:4 USC5,UHG5:4 UHG5:4';
const trapDrop =
  'UKC4,UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 USC5,UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1';

const popRockLead = [
  'C#5:2 E5:2 F#5:4 A5:4 E5:4',
  'F#5:2 E5:2 C#5:4 B4:2 C#5:2 E5:4',
  'A5:2 F#5:2 E5:4 C#5:4 E5:4',
  'D5:4 C#5:2 B4:2 A4:8',
];
const popRockMute = [
  'A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 E3:2 A2:2',
  'D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2',
  'F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 F#2:2 C#3:2 F#2:2',
  'E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2',
];
const popRockOpen = [
  '[A2,E3,A3]:8 [A2,E3,A3]:8',
  '[D2,A2,D3]:8 [D2,A2,D3]:8',
  '[F#2,C#3,F#3]:8 [F#2,C#3,F#3]:8',
  '[E2,B2,E3]:8 [E2,B2,E3]:8',
];
const popRockBass = [
  'A2:4 E2:4 A2:4 E2:4',
  'D2:4 A1:4 D2:4 A1:4',
  'F#2:4 C#2:4 F#2:4 C#2:4',
  'E2:4 B1:4 E2:2 F#2:2 E2:4',
];

const edmLead = [
  'G5:4 Bb5:2 C6:2 D6:4 Bb5:4',
  'C6:2 Bb5:2 G5:4 F5:4 D5:4',
  'G5:2 Bb5:2 C6:2 D6:2 F6:4 D6:4',
  'Bb5:4 G5:4 D5:8',
];
const edmLeadPeak = [
  'G6:2 G6:2 Bb5:2 C6:2 D6:4 Bb5:4',
  'D6:2 C6:2 Bb5:2 G5:2 F5:4 G5:4',
  'G6:2 Bb6:2 C7:2 D7:2 Bb6:4 G6:4',
  'D6:4 Bb5:4 G5:8',
];
const edmBass = [
  'G2:2 G2:2 D3:2 G3:2 G2:2 G2:2 D3:2 F3:2',
  'Eb2:2 Eb2:2 Bb2:2 Eb3:2 Eb2:2 Eb2:2 Bb2:2 D3:2',
  'Bb1:2 Bb1:2 F2:2 Bb2:2 Bb1:2 Bb1:2 F2:2 Ab2:2',
  'F2:2 F2:2 C3:2 F3:2 F2:2 F2:2 C3:2 Eb3:2',
];
const edmPad = ['[G3,Bb3,D4]:16', '[Eb3,G3,Bb3]:16', '[Bb3,D4,F4]:16', '[F3,A3,C4]:16'];
const snareRoll =
  'USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1 USC5:1';

const houseLead = [
  'A5:1 R:1 C6:2 E6:1 R:1 A5:2 C6:2 E6:2 A5:4',
  'G5:2 E5:1 R:1 A5:2 C6:4 A5:2 E5:4',
  'A5:1 C6:1 E6:2 R:2 A5:2 G5:1 R:1 E5:4 A5:2',
  'C6:4 A5:2 E5:2 A4:8',
];
const houseBass = [
  'A2:2 R:2 E2:4 A2:2 R:2 C3:4',
  'F2:2 R:2 C3:4 F2:2 R:2 A2:4',
  'G2:2 R:2 D3:4 G2:2 R:2 B2:4',
  'E2:2 R:2 B2:4 E2:2 F2:2 E2:4',
];
const housePad = ['[A3,C4,E4]:16', '[F3,A3,C4]:16', '[G3,B3,D4]:16', '[E3,G#3,B3]:16'];

const altPianoVerse = [
  '[C3,Eb3,G3]:4 [C3,Eb3,G3]:4 [C3,Eb3,G3]:4 [C3,Eb3,G3]:4',
  '[Ab2,C3,Eb3]:4 [Ab2,C3,Eb3]:4 [Ab2,C3,Eb3]:4 [Ab2,C3,Eb3]:4',
  '[Eb3,G3,Bb3]:4 [Eb3,G3,Bb3]:4 [Eb3,G3,Bb3]:4 [Eb3,G3,Bb3]:4',
  '[G2,Bb2,D3]:4 [G2,Bb2,D3]:4 [G2,Bb2,D3]:4 [G2,Bb2,D3]:4',
];
const altPianoChorus = [
  '[C3,Eb3,G3,C4]:8 [C3,Eb3,G3,C4]:8',
  '[Bb2,D3,F3,Bb3]:8 [Bb2,D3,F3,Bb3]:8',
  '[Ab2,C3,Eb3,Ab3]:8 [Ab2,C3,Eb3,Ab3]:8',
  '[G2,B2,D3,G3]:8 [G2,B2,D3,G3]:8',
];
const altLead = [
  'C5:2 Eb5:2 G5:4 Bb5:4 G5:4',
  'F5:2 Eb5:2 C5:4 Bb4:4 G4:4',
  'G5:2 Bb5:2 C6:4 Eb6:2 C6:2 Bb5:4',
  'G5:4 Eb5:4 C5:8',
];
const altBassVerse = ['C2:8 G1:8', 'Ab1:8 Eb2:8', 'Eb2:8 Bb1:8', 'G1:8 D2:8'];
const altBassChorus = [
  'C2:2 C2:2 G2:2 C3:2 C2:2 G2:2 C3:2 G2:2',
  'Bb1:2 Bb1:2 F2:2 Bb2:2 Bb1:2 F2:2 Bb2:2 F2:2',
  'Ab1:2 Ab1:2 Eb2:2 Ab2:2 Ab1:2 Eb2:2 Ab2:2 Eb2:2',
  'G1:2 G1:2 D2:2 G2:2 G1:2 B1:2 D2:2 G2:2',
];
const altVerseKit = 'UHG5:2 UHG5:2 UHG5:2 UHG5:2 UHG5:2 UHG5:2 USC5,UHG5:2 UHG5:2';
const altPreKit = 'UKC4,UHG5:4 UHG5:4 USC5,UHG5:4 UHG5:4';

const popPiano = [
  '[F3,A3,C4]:4 [F3,A3,C4]:4 [F3,A3,C4]:4 [F3,A3,C4]:4',
  '[A3,C4,E4]:4 [A3,C4,E4]:4 [A3,C4,E4]:4 [A3,C4,E4]:4',
  '[Bb3,D4,F4]:4 [Bb3,D4,F4]:4 [Bb3,D4,F4]:4 [Bb3,D4,F4]:4',
  '[C4,E4,G4]:4 [C4,E4,G4]:4 [C4,E4,G4]:4 [C4,E4,G4]:4',
];
const popLead = [
  'A5:4 C6:2 A5:2 F5:4 G5:4',
  'A5:2 G5:2 F5:4 E5:4 C5:4',
  'C6:2 Bb5:2 A5:4 G5:2 A5:2 C6:4',
  'A5:4 F5:4 F5:8',
];
const popBassV = [
  'F2:4 C2:4 F2:4 C2:4',
  'A1:4 E2:4 A1:4 E2:4',
  'Bb1:4 F2:4 Bb1:4 F2:4',
  'C2:4 G2:4 C2:4 G2:4',
];
const popBassC = [
  'F2:2 F2:2 C3:2 F3:2 F2:2 C3:2 F3:2 C3:2',
  'A2:2 A2:2 E3:2 A3:2 A2:2 E3:2 A3:2 E3:2',
  'Bb1:2 Bb1:2 F2:2 Bb2:2 Bb1:2 F2:2 Bb2:2 F2:2',
  'C2:2 C2:2 G2:2 C3:2 C2:2 E2:2 G2:2 C3:2',
];
const popPad = ['[F3,A3,C4]:16', '[A3,C4,E4]:16', '[Bb3,D4,F4]:16', '[C4,E4,G4]:16'];
const popVerseKit = 'UKC4,UHG5:4 UHG5:4 USC5,UHG5:4 UHG5:4';

const britGuitar = [
  'E4:2 B3:2 E4:2 G#4:2 B4:4 G#4:4',
  'C#4:2 E4:2 G#4:2 B4:2 A4:4 E4:4',
  'A3:2 C#4:2 E4:2 A4:2 C#5:4 B4:4',
  'B3:2 D#4:2 F#4:2 B4:2 G#4:4 E4:4',
];
const britPiano = [
  'R:2 [E3,G#3,B3]:2 R:2 [E3,G#3,B3]:2 R:2 [E3,G#3,B3]:2 R:2 [E3,G#3,B3]:2',
  'R:2 [C#3,E3,G#3]:2 R:2 [C#3,E3,G#3]:2 R:2 [C#3,E3,G#3]:2 R:2 [C#3,E3,G#3]:2',
  'R:2 [A2,C#3,E3]:2 R:2 [A2,C#3,E3]:2 R:2 [A2,C#3,E3]:2 R:2 [A2,C#3,E3]:2',
  'R:2 [B2,D#3,F#3]:2 R:2 [B2,D#3,F#3]:2 R:2 [B2,D#3,F#3]:2 R:2 [B2,D#3,F#3]:2',
];
const britBass = [
  'E2:4 R:2 B1:2 E2:4 B1:4',
  'C#2:4 R:2 G#1:2 C#2:4 G#1:4',
  'A1:4 R:2 E2:2 A1:4 E2:4',
  'B1:4 R:2 F#1:2 B1:2 C#2:2 B1:4',
];

const technoStab = ['D4:2 R:2 D4:4 R:8', 'F4:2 R:2 F4:4 R:8', 'C4:2 R:2 C4:4 R:8', 'D4:4 R:4 A3:8'];
const technoBass = [
  'D2:2 R:2 D2:2 R:2 D2:2 R:2 D2:2 R:2',
  'D2:2 R:2 D2:2 R:2 F2:2 R:2 F2:2 R:2',
  'F2:2 R:2 F2:2 R:2 C2:2 R:2 C2:2 R:2',
  'C2:2 R:2 C2:2 R:2 D2:4 A1:4',
];
const technoPad = ['[D3,F3,A3]:16', '[F3,A3,C4]:16', '[C3,E3,G3]:16', '[D3,F3,A3]:16'];
const technoKick = 'UKC4:4 UKC4:4 UKC4:4 UKC4:4';
const technoHats = 'UKC4,UHG5:4 UKC4,UHG5:4 UKC4,UHG5:4 UKC4,UHG5:4';
const technoOpen =
  'UKC4,UHG5:2 UOA5:2 UKC4,UHG5:2 UOA5:2 UKC4,UHG5:2 UOA5:2 UKC4,USC5,UHG5:2 UOA5:2';
const technoRide =
  'UKC4,URD5:2 UOA5:2 UKC4,URD5:2 UOA5:2 UKC4,URD5:2 UOA5:2 UKC4,USC5,URD5:2 UOA5:2';
const technoHats16 =
  'UKC4,UHG5:1 UHG5:1 UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 UHG5:1 UHG5:1 UKC4,UHG5:1 UHG5:1 UHG5:1 UHG5:1 UKC4,USC5,UHG5:1 UHG5:1 UHG5:1 UHG5:1';

const gallop = (root) =>
  `${root}:2 ${root}:1 ${root}:1 ${root}:2 ${root}:1 ${root}:1 ${root}:2 ${root}:1 ${root}:1 ${root}:2 ${root}:1 ${root}:1`;
const metalOpen = [
  '[E2,B2,E3]:8 [E2,B2,E3]:8',
  '[G2,D3,G3]:8 [G2,D3,G3]:8',
  '[D2,A2,D3]:8 [D2,A2,D3]:8',
  '[C2,G2,C3]:8 [C2,G2,C3]:8',
];
const metalHarmony = ['G4:4 B4:4 E5:8', 'B4:4 D5:4 G5:8', 'A4:4 D5:4 F#5:8', 'G4:4 C5:4 E5:8'];
const metalKit =
  'UKC4,UHG5:2 UKC4:1 UKC4:1 USC5,UHG5:2 UKC4:1 UKC4:1 UKC4,UHG5:2 UKC4:1 UKC4:1 USC5,UHG5:2 UKC4:1 UKC4:1';
const metalCrash =
  'UCC6,UKC4,UHG5:2 UKC4:1 UKC4:1 USC5,UHG5:2 UKC4:1 UKC4:1 UKC4,UHG5:2 UKC4:1 UKC4:1 USC5,UHG5:2 UKC4:1 UKC4:1';

const coreChug = [
  'B1:2 B1:2 B1:2 B1:2 B1:2 B1:2 F#2:2 B1:2',
  'G1:2 G1:2 G1:2 G1:2 G1:2 G1:2 D2:2 G1:2',
  'D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2',
  'A1:2 A1:2 A1:2 A1:2 A1:2 A1:2 E2:2 A1:2',
];
const coreOpen = [
  '[B1,F#2,B2]:8 [B1,F#2,B2]:8',
  '[G1,D2,G2]:8 [G1,D2,G2]:8',
  '[D2,A2,D3]:8 [D2,A2,D3]:8',
  '[A1,E2,A2]:8 [A1,E2,A2]:8',
];
const coreHalf = [
  'B1:4 B1:4 B1:4 B1:4',
  'G1:4 G1:4 G1:4 G1:4',
  'D2:4 D2:4 D2:4 D2:4',
  'A1:4 A1:4 A1:4 A1:4',
];
const coreLead = [
  'F#5:2 D5:2 B4:4 D5:4 F#5:4',
  'G5:2 F#5:2 D5:4 B4:4 G4:4',
  'A5:2 F#5:2 D5:4 E5:4 F#5:4',
  'D5:4 B4:4 B4:8',
];
const coreVerseKit = backbeat;
const coreBdKit = 'UCC6,UKC4:4 UKC4:4 USC5,UKC4:4 UKC4:4';
const coreHit = 'B1:4 R:12';
const coreHitKit = 'UCC6,UKC4:4 R:12';

const countryAc = [
  '[A3,C#4,E4]:2 [A3,C#4,E4]:2 [A3,C#4,E4]:2 [A3,C#4,E4]:2 [A3,C#4,E4]:2 [A3,C#4,E4]:2 [A3,C#4,E4]:2 [A3,C#4,E4]:2',
  '[E3,G#3,B3]:2 [E3,G#3,B3]:2 [E3,G#3,B3]:2 [E3,G#3,B3]:2 [E3,G#3,B3]:2 [E3,G#3,B3]:2 [E3,G#3,B3]:2 [E3,G#3,B3]:2',
  '[F#3,A3,C#4]:2 [F#3,A3,C#4]:2 [F#3,A3,C#4]:2 [F#3,A3,C#4]:2 [F#3,A3,C#4]:2 [F#3,A3,C#4]:2 [F#3,A3,C#4]:2 [F#3,A3,C#4]:2',
  '[D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2 [D3,F#3,A3]:2',
];
const countryOpen = [
  '[A3,C#4,E4,A4]:8 [A3,C#4,E4,A4]:8',
  '[E3,G#3,B3,E4]:8 [E3,G#3,B3,E4]:8',
  '[F#3,A3,C#4,F#4]:8 [F#3,A3,C#4,F#4]:8',
  '[D3,F#3,A3,D4]:8 [D3,F#3,A3,D4]:8',
];
const countryLead = [
  'C#5:2 E5:2 A5:4 E5:4 C#5:4',
  'B4:2 G#4:2 E4:4 G#4:4 B4:4',
  'A4:2 C#5:2 F#5:4 E5:4 C#5:4',
  'D5:4 C#5:2 B4:2 A4:8',
];
const countryBassV = [
  'A2:4 E2:4 A2:4 E2:4',
  'E2:4 B1:4 E2:4 B1:4',
  'F#2:4 C#2:4 F#2:4 C#2:4',
  'D2:4 A1:4 D2:4 A1:4',
];
const countryBassC = [
  'A2:2 E3:2 A2:2 B2:2 C#3:4 E2:4',
  'E2:2 B2:2 E2:2 F#2:2 G#2:4 B1:4',
  'F#2:2 C#3:2 F#2:2 G#2:2 A2:4 C#2:4',
  'D2:2 A2:2 D2:2 E2:2 F#2:4 A1:4',
];

const rnbRhodes = [
  '[Bb3,Db4,F4]:8 [Bb3,Db4,F4]:8',
  '[Gb3,Bb3,Db4]:8 [Gb3,Bb3,Db4]:8',
  '[Ab3,C4,Eb4]:8 [Ab3,C4,Eb4]:8',
  '[Db4,F4,Ab4]:8 [Db4,F4,Ab4]:8',
];
const rnbPad = [
  '[Bb3,Db4,F4,Ab4]:16',
  '[Gb3,Bb3,Db4,F4]:16',
  '[Ab3,C4,Eb4,Gb4]:16',
  '[Db4,F4,Ab4,C5]:16',
];
const rnbBass = ['Bb1:8 F2:8', 'Gb1:8 Db2:8', 'Ab1:8 Eb2:8', 'Db2:8 Ab1:8'];
const rnbVerseKit = 'UKC4:8 USC5:8';
const rnbChorusKit = 'UKC4,UHG5:2 UHG5:2 USC5,UHG5:2 UHG5:2 UKC4,UHG5:2 UHG5:2 USC5,UHG5:2 UOA5:2';

const waveLead = [
  'C5:4 Eb5:2 G5:2 Bb5:4 G5:4',
  'Ab5:2 G5:2 F5:4 Eb5:4 C5:4',
  'G5:2 Bb5:2 C6:4 Eb6:4 C6:4',
  'Bb5:4 G5:4 C5:8',
];
const waveBrass = [
  '[C4,Eb4,G4]:8 [C4,Eb4,G4]:8',
  '[Bb3,D4,F4]:8 [Bb3,D4,F4]:8',
  '[Ab3,C4,Eb4]:8 [Ab3,C4,Eb4]:8',
  '[G3,B3,D4]:8 [G3,B3,D4]:8',
];
const waveBass = [
  'C2:2 C2:2 G2:2 C3:2 C2:2 C2:2 G2:2 Bb2:2',
  'Bb1:2 Bb1:2 F2:2 Bb2:2 Bb1:2 Bb1:2 F2:2 Ab2:2',
  'Ab1:2 Ab1:2 Eb2:2 Ab2:2 Ab1:2 Ab1:2 Eb2:2 G2:2',
  'G1:2 G1:2 D2:2 G2:2 G1:2 B1:2 D2:2 G2:2',
];
const wavePad = ['[C3,Eb3,G3]:16', '[Bb2,D3,F3]:16', '[Ab2,C3,Eb3]:16', '[G2,B2,D3]:16'];
const waveHats =
  'UKC4,UHG5:1 UHG5:1 UHG5:1 R:1 UKC4,USC5,UHG5:1 UHG5:1 UHG5:1 R:1 UKC4,UHG5:1 UHG5:1 UHG5:1 R:1 UKC4,USC5,UHG5:1 UHG5:1 UOA5:1 R:1';

const dnbBass = ['F#1:8 C#2:8', 'D1:8 A1:8', 'E1:8 B1:8', 'C#1:8 G#1:8'];
const dnbLead = [
  'C#5:2 F#5:2 A5:4 F#5:4 C#5:4',
  'E5:2 D5:2 C#5:4 B4:4 A4:4',
  'F#5:2 A5:2 B5:4 C#6:4 A5:4',
  'F#5:8 C#5:8',
];
const dnbPad = ['[F#3,A3,C#4]:16', '[D3,F#3,A3]:16', '[E3,G#3,B3]:16', '[C#3,E3,G#3]:16'];
const dnbHats =
  'UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1 UHG5:1';

const trapBass = ['E1:12 B1:4', 'C2:12 G1:4', 'G1:12 D2:4', 'D1:12 A1:4'];
const trapLead = ['E5:8 B4:8', 'G5:4 E5:4 D5:8', 'B4:8 G4:8', 'A4:4 G4:4 E4:8'];
const trapPad = ['[E3,G3,B3]:16', '[C3,E3,G3]:16', '[G3,B3,D4]:16', '[D3,F#3,A3]:16'];

const candidates = [
  {
    id: 'pop-rock',
    order: 1,
    slug: '01-pop-rock',
    title: 'Harbor Charge',
    genre: 'Pop-rock',
    tempo: 132,
    keyFifths: 3,
    mode: 'major',
    measures: 88,
    divisions: 4,
    parts: (() => {
      const lead = assemble([
        { count: 8, bars: popRockLead, words: 'intro hook', dynamic: 'mf' },
        {
          count: 16,
          bars: [R, R, R, 'C#5:8 R:8', R, R, R, R, R, R, R, 'E5:4 C#5:4 A4:8', R, R, R, R],
          words: 'verse',
        },
        {
          count: 8,
          bars: [
            'C#5:2 E5:2 F#5:4 A5:8',
            'B5:4 A5:4 F#5:8',
            'A5:2 F#5:2 E5:4 C#5:8',
            'E5:8 C#5:8',
            'C#5:2 E5:2 F#5:4 A5:8',
            'B5:4 A5:4 F#5:8',
            'A5:4 F#5:4 E5:8',
            'C#5:16',
          ],
          words: 'prechorus',
          dynamic: 'f',
        },
        { count: 16, bars: popRockLead, words: 'chorus', dynamic: 'ff' },
        { count: 8, bars: [R, R, R, 'C#5:8 R:8', R, R, R, R], words: 'verse two' },
        { count: 16, bars: popRockLead, words: 'chorus two', dynamic: 'ff' },
        {
          count: 8,
          bars: [
            'E5:8 F#5:8',
            'A5:8 E5:8',
            'F#5:8 C#5:8',
            'B4:16',
            'E5:8 F#5:8',
            'A5:8 C#6:8',
            'B5:8 A5:8',
            'E5:16',
          ],
          words: 'bridge',
          dynamic: 'mp',
        },
        { count: 8, bars: popRockLead, words: 'final chorus', dynamic: 'ff' },
      ]);
      const rhythm = assemble([
        { count: 8, bars: popRockMute, words: 'muted eighths' },
        { count: 16, bars: popRockMute, words: 'verse chug' },
        { count: 8, bars: popRockMute, words: 'prechorus' },
        { count: 16, bars: popRockOpen, words: 'open chorus' },
        { count: 8, bars: popRockMute },
        { count: 16, bars: popRockOpen },
        { count: 8, bars: popRockMute, words: 'bridge mute' },
        { count: 8, bars: popRockOpen, words: 'tag' },
      ]);
      const bass = assemble([
        { count: 8, bars: popRockBass },
        { count: 16, bars: popRockBass },
        { count: 8, bars: popRockBass },
        { count: 16, bars: popRockBass },
        { count: 8, bars: popRockBass },
        { count: 16, bars: popRockBass },
        { count: 8, bars: popRockBass },
        { count: 8, bars: popRockBass },
      ]);
      const drums = assemble([
        { count: 4, bars: [hats8], words: 'hats only' },
        { count: 4, bars: [backbeat], words: 'backbeat in' },
        { count: 16, bars: [backbeat] },
        { count: 7, bars: [backbeat] },
        { count: 1, bars: [fill], words: 'fill' },
        { count: 1, bars: [crashBackbeat], words: 'chorus' },
        { count: 15, bars: [backbeat] },
        { count: 8, bars: [backbeat] },
        { count: 1, bars: [crashBackbeat] },
        { count: 15, bars: [backbeat] },
        { count: 8, bars: [hats8], words: 'bridge' },
        { count: 1, bars: [crashBackbeat], words: 'final' },
        { count: 7, bars: [backbeat] },
      ]);
      return [
        part(
          'P1',
          'Overdriven Guitar',
          'Gtr.',
          'Overdriven Guitar',
          1,
          30,
          'treble',
          lead.measures,
          { directions: lead.directions },
        ),
        part(
          'P2',
          'Distortion Guitar',
          'D.Gtr',
          'Distortion Guitar',
          2,
          31,
          'treble',
          rhythm.measures,
          { directions: rhythm.directions },
        ),
        part(
          'P3',
          'Electric Bass (pick)',
          'Bass',
          'Electric Bass (pick)',
          3,
          35,
          'bass',
          bass.measures,
        ),
        kitPart('P4', drums.measures, drums.directions),
      ];
    })(),
  },
];

const buildEdm = () => {
  const lead = assemble([
    { count: 16, bars: [R], words: 'intro - pad only' },
    { count: 15, bars: edmLead, words: 'build', dynamic: 'mf' },
    { count: 1, bars: [R], words: 'roll bar' },
    { count: 8, bars: ['G5:16', R, 'G5:8 R:8', R, R, R, R, R], words: 'break', dynamic: 'p' },
    { count: 16, bars: edmLead, words: 'drop 1', dynamic: 'f' },
    { count: 8, bars: [R, R, 'G5:8 R:8', R, R, R, R, R], words: 'break 2', dynamic: 'p' },
    { count: 16, bars: edmLeadPeak, words: 'drop 2', dynamic: 'ff' },
    { count: 8, bars: [R, R, R, R, R, R, R, 'G5:16'], words: 'outro' },
  ]);
  const bass = assemble([
    { count: 8, bars: [R] },
    { count: 8, bars: edmBass, words: 'groove' },
    { count: 16, bars: edmBass },
    { count: 8, bars: [R] },
    { count: 16, bars: edmBass },
    { count: 8, bars: [R] },
    { count: 16, bars: edmBass },
    { count: 8, bars: [R, R, R, R, edmBass[0], edmBass[1], edmBass[2], 'G2:8 D2:8'] },
  ]);
  const pad = assemble([{ count: 88, bars: edmPad, dynamic: 'mp' }]);
  const drums = assemble([
    { count: 8, bars: [R], words: 'no drums' },
    { count: 8, bars: [floor8], words: 'four on the floor' },
    { count: 15, bars: [floor8] },
    { count: 1, bars: [snareRoll], words: 'snare roll' },
    { count: 8, bars: [R], words: 'break' },
    { count: 1, bars: [crashFloor], words: 'drop' },
    { count: 15, bars: [floor8] },
    { count: 8, bars: [R] },
    { count: 1, bars: [crashFloor], words: 'drop 2' },
    { count: 15, bars: [floor8] },
    { count: 8, bars: [kickHats], words: 'outro' },
  ]);
  return { lead, bass, pad, drums };
};

const edm = buildEdm();
candidates.push({
  id: 'big-room-edm',
  order: 2,
  slug: '02-big-room-edm',
  title: 'Summit Grid',
  genre: 'Big-room EDM',
  tempo: 128,
  keyFifths: -2,
  mode: 'minor',
  measures: 88,
  divisions: 4,
  parts: [
    part('P1', 'Synth Lead', 'Lead', 'Synth Lead', 1, 82, 'treble', edm.lead.measures, {
      directions: edm.lead.directions,
    }),
    part('P2', 'Synth Bass', 'Bass', 'Synth Bass', 2, 39, 'bass', edm.bass.measures, {
      directions: edm.bass.directions,
    }),
    part('P3', 'Synth Pad', 'Pad', 'Synth Pad', 3, 89, 'treble', edm.pad.measures, {
      directions: edm.pad.directions,
    }),
    kitPart('P4', edm.drums.measures, edm.drums.directions, 'House Drum Kit'),
  ],
});

const house = (() => {
  const lead = assemble([
    { count: 24, bars: [R], words: 'tacet' },
    { count: 16, bars: houseLead, words: 'stabs', dynamic: 'mf' },
    { count: 8, bars: [R], words: 'break' },
    { count: 24, bars: houseLead, words: 'drop', dynamic: 'f' },
    { count: 8, bars: [R], words: 'perc break' },
    { count: 8, bars: houseLead, words: 'reprise', dynamic: 'f' },
  ]);
  const bass = assemble([
    { count: 8, bars: [R] },
    { count: 16, bars: houseBass, words: 'bass stabs' },
    { count: 16, bars: houseBass },
    { count: 8, bars: [R] },
    { count: 24, bars: houseBass },
    { count: 8, bars: [R] },
    { count: 8, bars: houseBass },
  ]);
  const pad = assemble([
    { count: 40, bars: [R] },
    { count: 8, bars: housePad, words: 'break pad', dynamic: 'p' },
    { count: 40, bars: [R] },
  ]);
  const drums = assemble([
    { count: 8, bars: [openHatFloor], words: 'kick + offbeat hats' },
    { count: 32, bars: [openHatFloor] },
    { count: 8, bars: [R], words: 'break' },
    { count: 1, bars: [crashFloor], words: 'drop' },
    { count: 23, bars: [openHatFloor] },
    { count: 8, bars: [kickHats], words: 'perc break' },
    { count: 8, bars: [openHatFloor] },
  ]);
  return { lead, bass, pad, drums };
})();

candidates.push({
  id: 'house',
  order: 3,
  slug: '03-house',
  title: 'Clubwire Stabs',
  genre: 'House',
  tempo: 128,
  keyFifths: 0,
  mode: 'minor',
  measures: 88,
  divisions: 4,
  parts: [
    part('P1', 'Synth Lead', 'Lead', 'Synth Lead', 1, 81, 'treble', house.lead.measures, {
      directions: house.lead.directions,
    }),
    part('P2', 'Synth Bass', 'Bass', 'Synth Bass', 2, 39, 'bass', house.bass.measures, {
      directions: house.bass.directions,
    }),
    part('P3', 'Synth Pad', 'Pad', 'Synth Pad', 3, 90, 'treble', house.pad.measures, {
      directions: house.pad.directions,
    }),
    kitPart('P4', house.drums.measures, house.drums.directions, 'House Drum Kit'),
  ],
});

const alt = (() => {
  const piano = assemble([
    { count: 8, bars: altPianoVerse, words: 'piano intro', dynamic: 'mp' },
    { count: 16, bars: altPianoVerse, words: 'verse' },
    { count: 8, bars: altPianoVerse, words: 'prechorus' },
    { count: 16, bars: altPianoChorus, words: 'chorus', dynamic: 'f' },
    { count: 8, bars: altPianoVerse, words: 'verse two', dynamic: 'mp' },
    { count: 16, bars: altPianoChorus, words: 'final chorus', dynamic: 'ff' },
  ]);
  const lead = assemble([
    { count: 32, bars: [R] },
    { count: 16, bars: altLead, words: 'chorus hook', dynamic: 'f' },
    { count: 8, bars: [R] },
    { count: 16, bars: altLead, words: 'final hook', dynamic: 'ff' },
  ]);
  const bass = assemble([
    { count: 8, bars: [R] },
    { count: 16, bars: altBassVerse, words: 'ghost bass' },
    { count: 8, bars: altBassVerse },
    { count: 16, bars: altBassChorus, words: 'chorus eighths' },
    { count: 8, bars: altBassVerse },
    { count: 16, bars: altBassChorus },
  ]);
  const drums = assemble([
    { count: 8, bars: [R], words: 'no drums' },
    { count: 16, bars: [altVerseKit], words: 'snare on 4' },
    { count: 8, bars: [altPreKit], words: 'kick enters' },
    { count: 1, bars: [crashBackbeat], words: 'chorus' },
    { count: 15, bars: [backbeat] },
    { count: 8, bars: [altVerseKit] },
    { count: 1, bars: [crashBackbeat] },
    { count: 15, bars: [backbeat] },
  ]);
  return { piano, lead, bass, drums };
})();

candidates.push({
  id: 'alt-pop',
  order: 4,
  slug: '04-alt-pop',
  title: 'Split Signal',
  genre: 'Alt-pop',
  tempo: 96,
  keyFifths: -3,
  mode: 'minor',
  measures: 72,
  divisions: 4,
  parts: [
    part('P1', 'Piano', 'Pno.', 'Piano', 1, 1, 'treble', alt.piano.measures, {
      directions: alt.piano.directions,
    }),
    part('P2', 'Synth Lead', 'Lead', 'Synth Lead', 2, 81, 'treble', alt.lead.measures, {
      directions: alt.lead.directions,
    }),
    part('P3', 'Synth Bass', 'Bass', 'Synth Bass', 3, 39, 'bass', alt.bass.measures, {
      directions: alt.bass.directions,
    }),
    kitPart('P4', alt.drums.measures, alt.drums.directions),
  ],
});

const pop = (() => {
  const piano = assemble([
    { count: 8, bars: popPiano, words: 'intro', dynamic: 'mp' },
    { count: 16, bars: popPiano, words: 'verse' },
    { count: 8, bars: popPiano, words: 'prechorus' },
    { count: 16, bars: popPiano, words: 'chorus', dynamic: 'f' },
    { count: 8, bars: popPiano, words: 'verse two' },
    { count: 8, bars: popPiano, words: 'chorus two', dynamic: 'f' },
    { count: 8, bars: popPiano, words: 'postchorus tag' },
  ]);
  const lead = assemble([
    { count: 8, bars: popLead, words: 'hook tease' },
    { count: 24, bars: [R] },
    { count: 16, bars: popLead, words: 'chorus topline', dynamic: 'f' },
    { count: 8, bars: [R] },
    { count: 8, bars: popLead },
    { count: 8, bars: popLead, words: 'tag' },
  ]);
  const bass = assemble([
    { count: 8, bars: [R] },
    { count: 24, bars: popBassV },
    { count: 16, bars: popBassC },
    { count: 8, bars: popBassV },
    { count: 16, bars: popBassC },
  ]);
  const pad = assemble([
    { count: 32, bars: [R] },
    { count: 16, bars: popPad, words: 'chorus pad', dynamic: 'mp' },
    { count: 8, bars: [R] },
    { count: 16, bars: popPad },
  ]);
  const drums = assemble([
    { count: 8, bars: [hats8], words: 'hats' },
    { count: 16, bars: [popVerseKit], words: 'verse backbeat' },
    { count: 8, bars: [popVerseKit], words: 'prechorus' },
    { count: 1, bars: [crashFloor], words: 'chorus floor' },
    { count: 15, bars: [floor8] },
    { count: 8, bars: [popVerseKit] },
    { count: 1, bars: [crashFloor] },
    { count: 7, bars: [floor8] },
    { count: 8, bars: [floor8] },
  ]);
  return { piano, lead, bass, pad, drums };
})();

candidates.push({
  id: 'mainstream-pop',
  order: 5,
  slug: '05-mainstream-pop',
  title: 'Chartline Glow',
  genre: 'Mainstream pop',
  tempo: 104,
  keyFifths: -1,
  mode: 'major',
  measures: 72,
  divisions: 4,
  parts: [
    part('P1', 'Piano', 'Pno.', 'Piano', 1, 1, 'treble', pop.piano.measures, {
      directions: pop.piano.directions,
    }),
    part('P2', 'Synth Lead', 'Lead', 'Synth Lead', 2, 82, 'treble', pop.lead.measures, {
      directions: pop.lead.directions,
    }),
    part('P3', 'Synth Bass', 'Bass', 'Synth Bass', 3, 39, 'bass', pop.bass.measures),
    part('P4', 'Synth Pad', 'Pad', 'Synth Pad', 4, 89, 'treble', pop.pad.measures, {
      directions: pop.pad.directions,
    }),
    kitPart('P5', pop.drums.measures, pop.drums.directions),
  ],
});

const brit = (() => {
  const guitar = assemble([
    { count: 8, bars: [R] },
    { count: 16, bars: britGuitar, words: 'verse guitar' },
    { count: 8, bars: britGuitar, words: 'prechorus opens' },
    { count: 16, bars: britGuitar, words: 'chorus hook', dynamic: 'f' },
    { count: 8, bars: britGuitar },
    { count: 24, bars: britGuitar, words: 'chorus two', dynamic: 'f' },
    { count: 8, bars: britGuitar, words: 'tag' },
  ]);
  const piano = assemble([
    { count: 8, bars: [R] },
    { count: 80, bars: britPiano, words: 'offbeat piano' },
  ]);
  const bass = assemble([
    { count: 8, bars: britBass, words: '2-step bass' },
    { count: 80, bars: britBass },
  ]);
  const drums = assemble([
    { count: 8, bars: [twoStep], words: '2-step kit' },
    { count: 80, bars: [twoStep] },
  ]);
  return { guitar, piano, bass, drums };
})();

candidates.push({
  id: 'british-pop',
  order: 6,
  slug: '06-british-pop',
  title: 'Skipstep Spark',
  genre: 'British pop',
  tempo: 130,
  keyFifths: 4,
  mode: 'major',
  measures: 88,
  divisions: 4,
  parts: [
    part(
      'P1',
      'Electric Guitar (clean)',
      'Gtr.',
      'Electric Guitar (clean)',
      1,
      28,
      'treble',
      brit.guitar.measures,
      { directions: brit.guitar.directions },
    ),
    part('P2', 'Piano', 'Pno.', 'Piano', 2, 1, 'treble', brit.piano.measures, {
      directions: brit.piano.directions,
    }),
    part(
      'P3',
      'Electric Bass (finger)',
      'Bass',
      'Electric Bass (finger)',
      3,
      34,
      'bass',
      brit.bass.measures,
      { directions: brit.bass.directions },
    ),
    kitPart('P4', brit.drums.measures, brit.drums.directions),
  ],
});

const techno = (() => {
  const bass = assemble([
    { count: 16, bars: [R] },
    { count: 16, bars: technoBass, words: 'rumble' },
    { count: 16, bars: technoBass },
    { count: 8, bars: [R], words: 'kickless' },
    { count: 24, bars: technoBass, words: 'drop 2' },
    { count: 12, bars: technoBass, words: 'outro' },
  ]);
  const stab = assemble([
    { count: 32, bars: [R] },
    { count: 16, bars: technoStab, words: 'stabs', dynamic: 'mf' },
    { count: 8, bars: technoStab, words: 'breakdown stabs', dynamic: 'p' },
    { count: 24, bars: technoStab, words: 'peak stabs', dynamic: 'f' },
    { count: 12, bars: [R] },
  ]);
  const pad = assemble([
    { count: 56, bars: [R] },
    { count: 24, bars: technoPad, words: 'new layer', dynamic: 'mp' },
    { count: 12, bars: [R] },
  ]);
  const drums = assemble([
    { count: 8, bars: [technoKick], words: 'kick only' },
    { count: 8, bars: [technoHats], words: 'hats on' },
    { count: 16, bars: [technoOpen], words: 'open-hat offbeats' },
    { count: 16, bars: [technoHats16], words: '16th hats' },
    { count: 8, bars: [hats8], words: 'kickless hats' },
    { count: 24, bars: [technoRide], words: 'ride peak' },
    { count: 12, bars: [technoHats], words: 'outro' },
  ]);
  return { bass, stab, pad, drums };
})();

candidates.push({
  id: 'techno',
  order: 7,
  slug: '07-techno',
  title: 'Peaktime Lock',
  genre: 'Techno',
  tempo: 132,
  keyFifths: -1,
  mode: 'minor',
  measures: 92,
  divisions: 4,
  parts: [
    part('P1', 'Synth Bass', 'Bass', 'Synth Bass', 1, 40, 'bass', techno.bass.measures, {
      directions: techno.bass.directions,
    }),
    part('P2', 'Synth Lead', 'Stab', 'Synth Lead', 2, 83, 'treble', techno.stab.measures, {
      directions: techno.stab.directions,
    }),
    part('P3', 'Synth Pad', 'Pad', 'Synth Pad', 3, 90, 'treble', techno.pad.measures, {
      directions: techno.pad.directions,
    }),
    kitPart('P4', techno.drums.measures, techno.drums.directions, 'Techno Drum Kit'),
  ],
});

const metalGallops = [gallop('E2'), gallop('G2'), gallop('D2'), gallop('C2')];
const metalBassGallops = [gallop('E2'), gallop('G2'), gallop('D2'), gallop('C2')];
const metal = (() => {
  const rhythm = assemble([
    { count: 16, bars: metalGallops, words: 'intro gallop', dynamic: 'mf' },
    { count: 32, bars: metalGallops, words: 'verse riffs' },
    { count: 16, bars: metalOpen, words: 'refrain open', dynamic: 'f' },
    { count: 16, bars: metalGallops, words: 'verse three' },
    { count: 16, bars: metalOpen, words: 'refrain two', dynamic: 'ff' },
    { count: 16, bars: metalGallops, words: 'outro gallop' },
  ]);
  const harmony = assemble([
    { count: 48, bars: [R] },
    { count: 16, bars: metalHarmony, words: 'twin thirds' },
    { count: 16, bars: [R] },
    { count: 16, bars: metalHarmony, words: 'twin thirds return' },
    { count: 16, bars: [R] },
  ]);
  const bass = assemble([{ count: 112, bars: metalBassGallops }]);
  const drums = assemble([
    { count: 16, bars: [metalKit], words: 'gallop kit' },
    { count: 32, bars: [metalKit] },
    { count: 1, bars: [metalCrash], words: 'refrain' },
    { count: 15, bars: [metalKit] },
    { count: 16, bars: [metalKit] },
    { count: 1, bars: [metalCrash] },
    { count: 15, bars: [metalKit] },
    { count: 16, bars: [metalKit] },
  ]);
  return { rhythm, harmony, bass, drums };
})();

candidates.push({
  id: 'metal',
  order: 8,
  slug: '08-metal',
  title: 'Iron Lattice',
  genre: 'Metal',
  tempo: 160,
  keyFifths: 1,
  mode: 'minor',
  measures: 112,
  divisions: 4,
  parts: [
    part(
      'P1',
      'Distortion Guitar',
      'Gtr.',
      'Distortion Guitar',
      1,
      31,
      'treble',
      metal.rhythm.measures,
      { directions: metal.rhythm.directions },
    ),
    part(
      'P2',
      'Overdriven Guitar',
      'Gtr.2',
      'Overdriven Guitar',
      2,
      30,
      'treble',
      metal.harmony.measures,
      { directions: metal.harmony.directions },
    ),
    part(
      'P3',
      'Electric Bass (pick)',
      'Bass',
      'Electric Bass (pick)',
      3,
      35,
      'bass',
      metal.bass.measures,
    ),
    kitPart('P4', metal.drums.measures, metal.drums.directions),
  ],
});

const core = (() => {
  const rhythm = assemble([
    { count: 8, bars: coreChug, words: 'intro chugs', dynamic: 'mf' },
    { count: 16, bars: coreChug, words: 'verse' },
    { count: 16, bars: coreOpen, words: 'chorus', dynamic: 'f' },
    { count: 1, bars: [R], words: 'dead air' },
    { count: 1, bars: [coreHit], words: 'hit' },
    { count: 16, bars: coreHalf, words: 'breakdown 1', dynamic: 'ff' },
    { count: 16, bars: coreOpen, words: 'chorus two' },
    { count: 1, bars: [R] },
    { count: 1, bars: [coreHit] },
    { count: 20, bars: coreHalf, words: 'breakdown 2', dynamic: 'ff' },
    {
      count: 8,
      bars: [
        '[B1,F#2,B2]:16',
        '[B1,F#2,B2]:16',
        '[B1,F#2,B2]:8 [B1,F#2,B2]:8',
        '[B1,F#2,B2]:16',
        R,
        R,
        R,
        '[B1,F#2,B2]:16',
      ],
      words: 'cadence',
    },
  ]);
  const lead = assemble([
    { count: 24, bars: [R] },
    { count: 16, bars: coreLead, words: 'melodic hook', dynamic: 'f' },
    { count: 18, bars: [R] },
    { count: 16, bars: coreLead, words: 'hook return' },
    { count: 30, bars: [R] },
  ]);
  const bass = assemble([
    { count: 8, bars: coreChug },
    { count: 16, bars: coreChug },
    { count: 16, bars: coreChug },
    { count: 1, bars: [R] },
    { count: 1, bars: [coreHit] },
    { count: 16, bars: coreHalf },
    { count: 16, bars: coreChug },
    { count: 1, bars: [R] },
    { count: 1, bars: [coreHit] },
    { count: 20, bars: coreHalf },
    { count: 8, bars: [coreHalf[0]] },
  ]);
  const drums = assemble([
    { count: 8, bars: [kickHats], words: 'kick only' },
    { count: 16, bars: [coreVerseKit], words: 'verse kit' },
    { count: 1, bars: [crashBackbeat], words: 'chorus' },
    { count: 15, bars: [backbeat] },
    { count: 1, bars: [R] },
    { count: 1, bars: [coreHitKit] },
    { count: 16, bars: [coreBdKit], words: 'half-time' },
    { count: 1, bars: [crashBackbeat] },
    { count: 15, bars: [backbeat] },
    { count: 1, bars: [R] },
    { count: 1, bars: [coreHitKit] },
    { count: 20, bars: [coreBdKit], words: 'breakdown 2' },
    { count: 8, bars: [coreBdKit] },
  ]);
  return { rhythm, lead, bass, drums };
})();

candidates.push({
  id: 'metalcore',
  order: 9,
  slug: '09-metalcore',
  title: 'Break Current',
  genre: 'Metalcore',
  tempo: 152,
  keyFifths: 2,
  mode: 'minor',
  measures: 104,
  divisions: 4,
  parts: [
    part(
      'P1',
      'Distortion Guitar',
      'Gtr.',
      'Distortion Guitar',
      1,
      31,
      'treble',
      core.rhythm.measures,
      { directions: core.rhythm.directions },
    ),
    part(
      'P2',
      'Overdriven Guitar',
      'Gtr.2',
      'Overdriven Guitar',
      2,
      30,
      'treble',
      core.lead.measures,
      { directions: core.lead.directions },
    ),
    part(
      'P3',
      'Electric Bass (pick)',
      'Bass',
      'Electric Bass (pick)',
      3,
      35,
      'bass',
      core.bass.measures,
    ),
    kitPart('P4', core.drums.measures, core.drums.directions),
  ],
});

const country = (() => {
  const acoustic = assemble([
    { count: 8, bars: countryAc, words: 'intro acoustic', dynamic: 'mp' },
    { count: 16, bars: countryAc, words: 'verse' },
    { count: 8, bars: countryAc, words: 'prechorus' },
    { count: 16, bars: countryOpen, words: 'chorus', dynamic: 'f' },
    { count: 8, bars: countryAc, words: 'verse two' },
    { count: 12, bars: countryOpen, words: 'chorus tag', dynamic: 'f' },
  ]);
  const lead = assemble([
    { count: 8, bars: countryLead, words: 'Tele intro' },
    {
      count: 16,
      bars: [R, R, R, countryLead[3], R, R, R, R, R, R, R, R, R, R, R, R],
      words: 'verse answer',
    },
    { count: 8, bars: countryLead, words: 'prechorus climb' },
    { count: 16, bars: countryLead, words: 'chorus hook' },
    { count: 8, bars: [R] },
    { count: 12, bars: countryLead },
  ]);
  const bass = assemble([
    { count: 8, bars: countryBassV },
    { count: 24, bars: countryBassV },
    { count: 16, bars: countryBassC },
    { count: 8, bars: countryBassV },
    { count: 12, bars: countryBassC },
  ]);
  const drums = assemble([
    { count: 8, bars: [hats8], words: 'hats only' },
    { count: 24, bars: [backbeat], words: 'country backbeat' },
    { count: 1, bars: [crashBackbeat], words: 'chorus' },
    { count: 15, bars: [backbeat] },
    { count: 8, bars: [backbeat] },
    { count: 12, bars: [backbeat] },
  ]);
  return { acoustic, lead, bass, drums };
})();

candidates.push({
  id: 'country',
  order: 10,
  slug: '10-country',
  title: 'Wiregrass Mile',
  genre: 'Country',
  tempo: 96,
  keyFifths: 3,
  mode: 'major',
  measures: 68,
  divisions: 4,
  parts: [
    part(
      'P1',
      'Acoustic Guitar',
      'Ac.Gtr',
      'Acoustic Guitar (steel)',
      1,
      26,
      'treble',
      country.acoustic.measures,
      { directions: country.acoustic.directions },
    ),
    part(
      'P2',
      'Overdriven Guitar',
      'Tele',
      'Overdriven Guitar',
      2,
      30,
      'treble',
      country.lead.measures,
      { directions: country.lead.directions },
    ),
    part(
      'P3',
      'Electric Bass (finger)',
      'Bass',
      'Electric Bass (finger)',
      3,
      34,
      'bass',
      country.bass.measures,
    ),
    kitPart('P4', country.drums.measures, country.drums.directions),
  ],
});

const rnb = (() => {
  const rhodes = assemble([
    { count: 8, bars: rnbRhodes, words: 'Rhodes intro', dynamic: 'mp' },
    { count: 16, bars: rnbRhodes, words: 'verse' },
    { count: 8, bars: rnbRhodes, words: 'prechorus' },
    { count: 16, bars: rnbRhodes, words: 'chorus', dynamic: 'mf' },
    { count: 8, bars: rnbRhodes, words: 'verse two' },
    { count: 8, bars: rnbRhodes, words: 'tag' },
  ]);
  const pad = assemble([
    { count: 32, bars: [R] },
    { count: 16, bars: rnbPad, words: 'chorus pad' },
    { count: 8, bars: [R] },
    { count: 8, bars: rnbPad },
  ]);
  const bass = assemble([
    { count: 8, bars: [R] },
    { count: 56, bars: rnbBass, words: '808 pocket' },
  ]);
  const drums = assemble([
    { count: 8, bars: [R], words: 'no kick' },
    { count: 16, bars: [rnbVerseKit], words: 'kick 1 / snare 3' },
    { count: 8, bars: [rnbVerseKit], words: 'prechorus' },
    { count: 16, bars: [rnbChorusKit], words: 'chorus kit' },
    { count: 8, bars: [rnbVerseKit] },
    { count: 8, bars: [rnbChorusKit] },
  ]);
  return { rhodes, pad, bass, drums };
})();

candidates.push({
  id: 'rnb',
  order: 11,
  slug: '11-rnb',
  title: 'Late Lamp',
  genre: 'Contemporary R&B',
  tempo: 86,
  keyFifths: -5,
  mode: 'minor',
  measures: 64,
  divisions: 4,
  parts: [
    part('P1', 'Electric Piano', 'Rhodes', 'Electric Piano', 1, 5, 'treble', rnb.rhodes.measures, {
      directions: rnb.rhodes.directions,
    }),
    part('P2', 'Synth Pad', 'Pad', 'Synth Pad', 2, 89, 'treble', rnb.pad.measures, {
      directions: rnb.pad.directions,
    }),
    part('P3', 'Synth Bass', 'Bass', 'Synth Bass', 3, 39, 'bass', rnb.bass.measures, {
      directions: rnb.bass.directions,
    }),
    kitPart('P4', rnb.drums.measures, rnb.drums.directions),
  ],
});

const wave = (() => {
  const lead = assemble([
    { count: 24, bars: [R] },
    { count: 16, bars: waveLead, words: 'analog hook', dynamic: 'mf' },
    { count: 8, bars: [R], words: 'break' },
    { count: 16, bars: waveLead, words: 'peak', dynamic: 'f' },
    { count: 8, bars: [R, R, R, R, R, R, R, 'C5:16'], words: 'outro' },
  ]);
  const brass = assemble([
    { count: 8, bars: [R] },
    { count: 16, bars: waveBrass, words: 'brass stabs' },
    { count: 16, bars: waveBrass },
    { count: 8, bars: [R] },
    { count: 16, bars: waveBrass },
    { count: 8, bars: [R] },
  ]);
  const bass = assemble([
    { count: 8, bars: [R] },
    { count: 64, bars: waveBass, words: 'eighth bass' },
  ]);
  const pad = assemble([{ count: 72, bars: wavePad, dynamic: 'mp', words: 'atmosphere' }]);
  const drums = assemble([
    { count: 8, bars: [waveHats], words: 'analog floor' },
    { count: 32, bars: [waveHats] },
    { count: 8, bars: [hats8], words: 'break hats' },
    { count: 16, bars: [waveHats], words: 'peak' },
    { count: 8, bars: [kickHats] },
  ]);
  return { lead, brass, bass, pad, drums };
})();

candidates.push({
  id: 'synthwave',
  order: 12,
  slug: '12-synthwave',
  title: 'Neon Overpass',
  genre: 'Synthwave',
  tempo: 108,
  keyFifths: -3,
  mode: 'minor',
  measures: 72,
  divisions: 4,
  parts: [
    part('P1', 'Synth Lead', 'Lead', 'Synth Lead', 1, 82, 'treble', wave.lead.measures, {
      directions: wave.lead.directions,
    }),
    part('P2', 'Synth Brass', 'Brass', 'Synth Brass 1', 2, 63, 'treble', wave.brass.measures, {
      directions: wave.brass.directions,
    }),
    part('P3', 'Synth Bass', 'Bass', 'Synth Bass', 3, 39, 'bass', wave.bass.measures, {
      directions: wave.bass.directions,
    }),
    part('P4', 'Synth Pad', 'Pad', 'Synth Pad', 4, 90, 'treble', wave.pad.measures, {
      directions: wave.pad.directions,
    }),
    kitPart('P5', wave.drums.measures, wave.drums.directions),
  ],
});

const dnb = (() => {
  const bass = assemble([
    { count: 16, bars: [R] },
    { count: 16, bars: dnbBass, words: 'Reese in' },
    { count: 16, bars: dnbBass },
    { count: 16, bars: dnbBass },
    { count: 32, bars: dnbBass, words: 'drop 2' },
    { count: 24, bars: dnbBass, words: 'outro' },
  ]);
  const lead = assemble([
    { count: 32, bars: [R] },
    { count: 16, bars: dnbLead, words: 'stab hook', dynamic: 'mf' },
    { count: 16, bars: [R], words: 'mid-break' },
    { count: 32, bars: dnbLead, words: 'peak hook', dynamic: 'f' },
    { count: 24, bars: [R] },
  ]);
  const pad = assemble([
    { count: 32, bars: dnbPad, words: 'atmosphere', dynamic: 'p' },
    { count: 16, bars: [R] },
    { count: 16, bars: dnbPad, dynamic: 'p' },
    { count: 32, bars: [R] },
    { count: 24, bars: dnbPad, dynamic: 'pp' },
  ]);
  const drums = assemble([
    { count: 16, bars: [dnbHats], words: 'hats in' },
    { count: 16, bars: [dnbHats] },
    { count: 16, bars: [dnbDrop], words: 'drop 1' },
    { count: 16, bars: [dnbHats], words: 'kick out' },
    { count: 32, bars: [dnbDrop], words: 'drop 2' },
    { count: 24, bars: [dnbHats], words: 'outro' },
  ]);
  return { bass, lead, pad, drums };
})();

candidates.push({
  id: 'drum-and-bass',
  order: 13,
  slug: '13-drum-and-bass',
  title: 'Breakline Current',
  genre: 'Drum and bass',
  tempo: 174,
  keyFifths: 3,
  mode: 'minor',
  measures: 120,
  divisions: 4,
  parts: [
    part('P1', 'Synth Bass', 'Bass', 'Synth Bass', 1, 40, 'bass', dnb.bass.measures, {
      directions: dnb.bass.directions,
    }),
    part('P2', 'Synth Lead', 'Lead', 'Synth Lead', 2, 81, 'treble', dnb.lead.measures, {
      directions: dnb.lead.directions,
    }),
    part('P3', 'Synth Pad', 'Pad', 'Synth Pad', 3, 89, 'treble', dnb.pad.measures, {
      directions: dnb.pad.directions,
    }),
    kitPart('P4', dnb.drums.measures, dnb.drums.directions, 'Breakbeat Kit'),
  ],
});

const trap = (() => {
  const bass = assemble([
    { count: 16, bars: trapBass, words: '808 in', dynamic: 'mf' },
    { count: 80, bars: trapBass },
  ]);
  const lead = assemble([
    { count: 32, bars: [R] },
    { count: 16, bars: trapLead, words: 'hook', dynamic: 'mf' },
    { count: 8, bars: [R], words: 'break' },
    { count: 24, bars: trapLead, words: 'peak hook' },
    { count: 16, bars: [R] },
  ]);
  const pad = assemble([{ count: 96, bars: trapPad, dynamic: 'mp', words: 'dark bed' }]);
  const drums = assemble([
    { count: 16, bars: [R], words: 'no hats' },
    { count: 16, bars: [trapVerse], words: 'verse hats' },
    { count: 16, bars: [trapDrop], words: '16th hats' },
    { count: 8, bars: [R], words: 'hat break' },
    { count: 24, bars: [trapDrop], words: 'drop two' },
    { count: 16, bars: [trapVerse], words: 'outro' },
  ]);
  return { bass, lead, pad, drums };
})();

candidates.push({
  id: 'trap',
  order: 14,
  slug: '14-trap',
  title: 'Halftime Wire',
  genre: 'Trap instrumental',
  tempo: 140,
  keyFifths: 1,
  mode: 'minor',
  measures: 96,
  divisions: 4,
  parts: [
    part('P1', 'Synth Bass', '808', 'Synth Bass', 1, 39, 'bass', trap.bass.measures, {
      directions: trap.bass.directions,
    }),
    part('P2', 'Synth Lead', 'Lead', 'Synth Lead', 2, 82, 'treble', trap.lead.measures, {
      directions: trap.lead.directions,
    }),
    part('P3', 'Synth Pad', 'Pad', 'Synth Pad', 3, 89, 'treble', trap.pad.measures, {
      directions: trap.pad.directions,
    }),
    kitPart('P4', trap.drums.measures, trap.drums.directions, 'Trap Kit'),
  ],
});

const writeReadme = (candidate, facts) => `# ${candidate.title}

- Lane: ${candidate.genre}
- Tempo: ${candidate.tempo} BPM, ${candidate.mode}, key fifths ${candidate.keyFifths}
- Measures: ${candidate.measures}
- Written duration: ${facts.scoreDurationSeconds.toFixed(1)}s (${(facts.scoreDurationSeconds / 60).toFixed(2)} min)
- Instruments: ${facts.instruments.join(', ')}
- Structure: see GENRE_BRIEF.md arrangement arc

## Self-evaluation

- Duration is inside the 150-180s window: **${facts.scoreDurationSeconds >= 150 && facts.scoreDurationSeconds <= 180 ? 'yes' : 'NO'}**
- Local \`validateMusicXml\` result: **valid**
- Instrumentation matches the brief (no piano-only substitute for guitar/synth/kit lanes)
- Original material only; no catalog interpolation
`;

const failures = [];
for (const candidate of candidates) {
  assert.equal(
    candidate.parts[0].measures.length,
    candidate.measures,
    `${candidate.id} lead length`,
  );
  for (const scorePart of candidate.parts) {
    assert.equal(
      scorePart.measures.length,
      candidate.measures,
      `${candidate.id} ${scorePart.name} length ${scorePart.measures.length} != ${candidate.measures}`,
    );
  }
  const xmlText = score(candidate);
  const validation = validateMusicXml(xmlText);
  if (!validation.valid) {
    failures.push(`${candidate.id}: ${JSON.stringify(validation.errors)}`);
    continue;
  }
  const facts = scoreFacts(xmlText);
  const seconds = facts.scoreDurationSeconds;
  const expected = writtenSeconds(candidate.measures, candidate.tempo);
  if (Math.abs(seconds - expected) > 1) {
    failures.push(`${candidate.id}: duration ${seconds} != expected ${expected}`);
  }
  if (seconds < 150 || seconds > 180) {
    failures.push(`${candidate.id}: duration ${seconds}s outside 2.5-3.0 min`);
  }
  const directory = path.join(candidatesRoot, candidate.slug);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${candidate.slug}.musicxml`), xmlText);
  fs.writeFileSync(path.join(directory, 'README.md'), writeReadme(candidate, facts));
  console.log(`${candidate.slug}\t${seconds.toFixed(1)}s\t${facts.instruments.join(' / ')}`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`wrote ${candidates.length} candidates`);
