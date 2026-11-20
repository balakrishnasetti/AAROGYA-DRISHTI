import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEmergencyRedFlag } from './emergencyRedFlags.js';

test('English emergency phrases are detected in free text', () => {
  for (const message of [
    'I have heavy bleeding',
    'I am having difficulty breathing',
    'I have difficulty swallowing',
  ]) {
    assert.equal(hasEmergencyRedFlag(message), true);
  }
});

test('Telugu emergency phrases are detected in free text', () => {
  for (const message of ['చాలా రక్తం వస్తోంది', 'శ్వాస తీసుకోవడం కష్టం', 'మింగడంలో ఇబ్బంది']) {
    assert.equal(hasEmergencyRedFlag(message, 'te'), true);
  }
});

test('emergency phrases are detected across all assistant languages', () => {
  const examples = [
    ['बहुत खून बह रहा है', 'hi'],
    ['सांस लेने में कठिनाई', 'hi'],
    ['நிறைய இரத்தம்', 'ta'],
    ['மூச்சு விடுவதில் சிரமம்', 'ta'],
    ['ಹೆಚ್ಚು ರಕ್ತಸ್ರಾವ', 'kn'],
    ['ನುಂಗಲು ಕಷ್ಟ', 'kn'],
    ['കനത്ത രക്തസ്രാവം', 'ml'],
    ['വിഴുങ്ങാൻ ബുദ്ധിമുട്ട്', 'ml'],
    ['প্রচুর রক্তপাত', 'bn'],
    ['গিলতে অসুবিধা', 'bn'],
    ['खूप रक्तस्राव', 'mr'],
    ['गिळण्यास त्रास', 'mr'],
  ];
  for (const [message, language] of examples) {
    assert.equal(hasEmergencyRedFlag(message, language), true, message);
  }
});

test('non-emergency text does not trigger emergency guidance', () => {
  assert.equal(hasEmergencyRedFlag('I would like general brushing tips.'), false);
});
