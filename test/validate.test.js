import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateMusicXml, scoreFacts } from '../src/validate.js';
import { checkAudioDuration, compareConstraints } from '../src/qc.js';
import { PaymentService } from '../src/payment.js';

const validScore = fs.readFileSync(new URL('./fixtures/two-bar-piano.musicxml', import.meta.url), 'utf8');

test('validates a MusicXML 4.0 partwise score and extracts render facts', () => {
  assert.deepEqual(validateMusicXml(validScore), { valid: true, errors: [] });
  const facts = scoreFacts(validScore);
  assert.equal(facts.partCount, 1);
  assert.equal(facts.tempo, 90);
  assert.equal(facts.key.fifths, 0);
  assert.ok(facts.scoreDurationSeconds > 3.9 && facts.scoreDurationSeconds < 4.1);
});

test('rejects external entity declarations before XML parsing', () => {
  const result = validateMusicXml(`<!DOCTYPE score [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><score-partwise version="4.0">&xxe;</score-partwise>`);
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /DOCTYPE/);
});

test('rejects documents whose root is not a MusicXML score-partwise element', () => {
  const result = validateMusicXml(`<wrapper><score-partwise version="4.0"><part-list/><part id="P1"><measure number="1"><note><duration>1</duration></note></measure></part></score-partwise></wrapper>`);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.message === 'Expected a MusicXML 4.0 score-partwise root.'));
});

test('does not treat comments as MusicXML semantic elements', () => {
  const result = validateMusicXml(`<score-partwise version="4.0"><!-- <part-list/> --><part id="P1"><measure number="1"><note><duration>1</duration></note></measure></part></score-partwise>`);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.message === 'Missing part-list.'));
});

test('constraint mismatches are deterministic and payment cannot capture before QC', async () => {
  const facts = scoreFacts(validScore);
  assert.deepEqual(compareConstraints(facts, { tempo: 120, key_fifths: -1, mode: 'minor' }), ['tempo', 'key_fifths', 'mode']);
  const payments = new PaymentService();
  await assert.rejects(payments.captureAfterQc({ status: 'not_charged' }), /only permitted/);
  const captured = await payments.captureAfterQc({ status: 'pending_qc' });
  assert.equal(captured.status, 'capture_stubbed');
});

test('score facts incorporate tempo and division changes, while audio allows a bounded release tail', () => {
  const score = `<score-partwise version="4.0"><part id="P1">
    <measure number="1"><attributes><divisions>1</divisions></attributes><sound tempo="60"/><note><duration>4</duration></note></measure>
    <measure number="2"><attributes><divisions>2</divisions></attributes><sound tempo="120"/><note><duration>8</duration></note></measure>
  </part></score-partwise>`;
  const facts = scoreFacts(score);
  assert.equal(facts.scoreDurationSeconds, 6);
  assert.equal(checkAudioDuration(6, 8, 2).ok, true);
  assert.equal(checkAudioDuration(6, 8.61, 2).code, 'audio_duration_mismatch');
});

test('score facts use MuseScore default tempo until an authored tempo takes effect', () => {
  const facts = scoreFacts(`<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><duration>4</duration></note></measure><measure number="2"><sound tempo="60"/><note><duration>4</duration></note></measure></part></score-partwise>`);
  assert.equal(facts.tempo, 120);
  assert.equal(facts.scoreDurationSeconds, 6);
});

test('score facts apply direction tempo changes at their MusicXML offsets', () => {
  const facts = scoreFacts(`<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><direction><offset>2</offset><sound tempo="60"/></direction><note><duration>4</duration></note></measure></part></score-partwise>`);
  assert.equal(facts.scoreDurationSeconds, 3);
});

test('score facts use the longest independently timed part', () => {
  const facts = scoreFacts(`<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><sound tempo="60"/><note><duration>4</duration></note></measure></part><part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes><sound tempo="120"/><note><duration>4</duration></note></measure></part></score-partwise>`);
  assert.equal(facts.tempo, 60);
  assert.equal(facts.scoreDurationSeconds, 4);
});

test('score facts ignore commented parts and derive dotted note types', () => {
  const facts = scoreFacts(`<score-partwise version="4.0"><!-- <part id="P2"><measure number="1"><sound tempo="1"/><note><duration>100</duration></note></measure></part> --><part id="P1"><measure number="1"><note><type>quarter</type><dot/></note></measure></part></score-partwise>`);
  assert.equal(facts.partCount, 1);
  assert.equal(facts.scoreDurationSeconds, 0.75);
});

test('semantic and fact extraction ignore CDATA and processing instructions', () => {
  const xml = `<score-partwise version="4.0"><![CDATA[<part-list/><part id="P2"><measure number="1"><sound tempo="1"/><note><duration>100</duration></note></measure></part>]]><?fake <part-list/>?><part id="P1"><measure number="1"><note><duration>1</duration></note></measure></part></score-partwise>`;
  assert.equal(validateMusicXml(xml).valid, false);
  assert.equal(scoreFacts(xml).partCount, 1);
});

test('score facts expand ordinary forward and backward repeats', () => {
  const facts = scoreFacts(`<score-partwise version="4.0"><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><sound tempo="60"/><barline location="left"><repeat direction="forward"/></barline><note><duration>4</duration></note></measure><measure number="2"><note><duration>4</duration></note><barline location="right"><repeat direction="backward"/></barline></measure></part></score-partwise>`);
  assert.equal(facts.scoreDurationSeconds, 16);
});
