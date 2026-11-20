import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpeechPreview,
  markdownToSpeechText,
  normalizeAssistantMarkdown,
  speechErrorKey,
} from './assistantSpeech.js';

test('speech text removes Markdown syntax but preserves readable content', () => {
  assert.equal(
    markdownToSpeechText('**Important:** use *gentle brushing* and [see a doctor](https://example.test).'),
    'Important: use gentle brushing and see a doctor.',
  );
  assert.equal(markdownToSpeechText('- First item\n- `Second item`'), 'First item Second item');
});

test('assistant Markdown removes stray separator asterisks without losing emphasis or lists', () => {
  const normalized = normalizeAssistantMarkdown(
    'Daily habits: * **Brush twice a day:** use fluoride toothpaste. *\n- Floss daily',
  );
  assert.doesNotMatch(normalized, /(^|\s)\*(\s|$)/);
  assert.match(normalized, /\*\*Brush twice a day:\*\*/);
  assert.match(normalized, /- Floss daily/);
});

test('long spoken replies provide a short preview and readable remainder', () => {
  const result = getSpeechPreview('First sentence. '.repeat(60), 80);
  assert.match(result.text, /^First sentence\./);
  assert.ok(result.text.length <= 82);
  assert.ok(result.remainder.startsWith('First sentence.'));
});

test('short replies are read in full', () => {
  assert.deepEqual(getSpeechPreview('A short reply.'), {
    text: 'A short reply.',
    remainder: '',
  });
});

test('browser speech errors map to distinct patient messages', () => {
  for (const [error, key] of [
    ['not-allowed', 'micDenied'],
    ['service-not-allowed', 'micDenied'],
    ['no-speech', 'noSpeech'],
    ['audio-capture', 'audioCapture'],
    ['network', 'networkError'],
    ['language-not-supported', 'languageNotSupported'],
    ['aborted', 'recognitionAborted'],
    ['unexpected-browser-error', 'speechError'],
  ]) {
    assert.equal(speechErrorKey(error), key);
  }
});
