import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantLanguages, assistantText, detectAssistantLanguage } from './assistantLocales.js';

test('assistant provides UI labels for all supported languages', () => {
  assert.deepEqual(assistantLanguages.map((language) => language.code), [
    'en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr',
  ]);
  for (const { code } of assistantLanguages) {
    assert.notEqual(assistantText(code, 'title'), 'title');
    assert.notEqual(assistantText(code, 'send'), 'send');
  }
});

test('assistant detects Indian writing systems and respects Hindi/Marathi preference', () => {
  assert.equal(detectAssistantLanguage('తెలుగు సందేశం'), 'te');
  assert.equal(detectAssistantLanguage('தமிழ் செய்தி'), 'ta');
  assert.equal(detectAssistantLanguage('ಕನ್ನಡ ಸಂದೇಶ'), 'kn');
  assert.equal(detectAssistantLanguage('മലയാളം സന്ദേശം'), 'ml');
  assert.equal(detectAssistantLanguage('বাংলা বার্তা'), 'bn');
  assert.equal(detectAssistantLanguage('नमस्ते', 'mr'), 'mr');
  assert.equal(detectAssistantLanguage('नमस्ते', 'en'), 'hi');
  assert.equal(detectAssistantLanguage('English sentence', 'te'), 'te');
});
