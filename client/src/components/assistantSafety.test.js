import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssistantSafetyReply } from './assistantSafety.js';

test('English oral warning signs receive a prompt clinician recommendation', () => {
  for (const phrase of [
    'I have bleeding from my mouth',
    'This mouth ulcer is not healing',
    'I feel a lump in my mouth',
    'I have difficulty swallowing',
  ]) {
    const reply = getAssistantSafetyReply(phrase);
    assert.ok(reply, phrase);
    assert.match(reply.text, /clinician promptly/i);
    assert.ok(reply.actions.some((action) => action.href === '/patient/appointments'));
    assert.ok(reply.actions.some((action) => action.href === '/patient/hospitals'));
  }
});

test('Telugu and transliterated oral warning signs receive Telugu guidance', () => {
  for (const phrase of [
    'నోటిలో రక్తస్రావం ఉంది',
    'నోటి పుండు నయం కావడం లేదు',
    'నోటిలో గడ్డ ఉంది',
    'మింగడంలో ఇబ్బంది ఉంది',
    'naa notilo gadda undi',
    'raktam vastondi',
  ]) {
    const reply = getAssistantSafetyReply(phrase);
    assert.ok(reply, phrase);
    assert.match(reply.text, /వైద్యుడిని/);
  }
});

test('emergency breathing or severe bleeding advice includes 112', () => {
  for (const phrase of ['I cannot breathe', 'I have severe bleeding', 'శ్వాస తీసుకోవడం కష్టం']) {
    const reply = getAssistantSafetyReply(phrase);
    assert.equal(reply?.emergency, true, phrase);
    assert.ok(reply.actions.some((action) => action.href === 'tel:112'));
    assert.match(reply.text, /112/);
  }
});

test('ordinary oral-health questions do not trigger urgent guidance', () => {
  assert.equal(getAssistantSafetyReply('How should I brush my teeth?'), null);
});
