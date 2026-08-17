import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateMusicXml, scoreFacts } from '../src/validate.js';
import { compareConstraints } from '../src/qc.js';
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

test('constraint mismatches are deterministic and payment cannot capture before QC', async () => {
  const facts = scoreFacts(validScore);
  assert.deepEqual(compareConstraints(facts, { tempo: 120, key_fifths: -1, mode: 'minor' }), ['tempo', 'key_fifths', 'mode']);
  const payments = new PaymentService();
  await assert.rejects(payments.captureAfterQc({ status: 'not_charged' }), /only permitted/);
  const captured = await payments.captureAfterQc({ status: 'pending_qc' });
  assert.equal(captured.status, 'capture_stubbed');
});
