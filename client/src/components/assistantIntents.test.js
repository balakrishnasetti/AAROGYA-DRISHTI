import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAssistantIntent } from './assistantIntents.js';

test('English voice commands resolve to patient actions', () => {
  const examples = [
    ['Start a new oral screening', 'start_screening'],
    ['Upload an oral photo', 'start_screening'],
    ['Show my results', 'show_results'],
    ['Open my report', 'show_results'],
    ['Download my report', 'download_report'],
    ['Explain my last report in simple words', 'explain_report'],
    ['Book an appointment', 'book_appointment'],
    ['Call a doctor', 'call_doctor'],
    ['Find a nearby hospital', 'find_hospital'],
    ['Switch to Telugu', 'change_language'],
    ['Help', 'help'],
  ];
  for (const [phrase, expected] of examples) {
    assert.equal(detectAssistantIntent(phrase).type, expected, phrase);
  }
  assert.equal(detectAssistantIntent('Switch to Telugu').language, 'te');
});

test('Telugu and common transliterated commands resolve to patient actions', () => {
  const examples = [
    ['కొత్త స్క్రీనింగ్ ప్రారంభించు', 'start_screening'],
    ['ఫోటో అప్‌లోడ్ చేయాలి', 'start_screening'],
    ['నా రిపోర్ట్ చూపించు', 'show_results'],
    ['naa report chupinchu', 'show_results'],
    ['నా ఫలితాలు చూపించు', 'show_results'],
    ['నా రిపోర్ట్ డౌన్‌లోడ్ చేయి', 'download_report'],
    ['నా report simple ga explain cheyyi', 'explain_report'],
    ['doctor ni kalavaali appointment book cheyyali', 'book_appointment'],
    ['doctor tho matladali', 'call_doctor'],
    ['nearby hospital ekkada chupinchu', 'find_hospital'],
    ['తెలుగు లో మాట్లాడు', 'change_language'],
    ['సహాయం', 'help'],
  ];
  for (const [phrase, expected] of examples) {
    assert.equal(detectAssistantIntent(phrase).type, expected, phrase);
  }
  assert.equal(detectAssistantIntent('తెలుగు లో మాట్లాడు').language, 'te');
});

test('unmatched health questions use chat and incomplete action requests clarify', () => {
  assert.equal(detectAssistantIntent('How can I brush gently?').type, 'question');
  assert.equal(detectAssistantIntent('open my report please').type, 'show_results');
  assert.equal(detectAssistantIntent('I need help with my appointment').type, 'clarify');
  assert.equal(detectAssistantIntent('').type, 'unclear');
  assert.equal(detectAssistantIntent('change language').language, null);
});
