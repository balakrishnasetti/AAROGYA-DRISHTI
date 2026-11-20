export function normalizeAssistantMarkdown(value) {
  return String(value || '')
    .replace(/([.!?:])\s+\*{1,3}(?=\s|$)/gm, '$1\n\n')
    .replace(/^\s*\*{1,3}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function markdownToSpeechText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|~~|`|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getSpeechPreview(value, maxLength = 320) {
  const text = markdownToSpeechText(value);
  if (text.length <= maxLength) return { text, remainder: '' };
  const segment = text.slice(0, maxLength);
  const sentenceEnd = Math.max(
    segment.lastIndexOf('. '),
    segment.lastIndexOf('! '),
    segment.lastIndexOf('? '),
  );
  const splitAt = sentenceEnd >= maxLength * 0.45 ? sentenceEnd + 1 : segment.lastIndexOf(' ');
  const offset = splitAt > 0 ? splitAt : maxLength;
  return {
    text: `${text.slice(0, offset).trim()}…`,
    remainder: text.slice(offset).trim(),
  };
}

export function speechErrorKey(error) {
  return {
    'not-allowed': 'micDenied',
    'service-not-allowed': 'micDenied',
    'no-speech': 'noSpeech',
    'audio-capture': 'audioCapture',
    network: 'networkError',
    'language-not-supported': 'languageNotSupported',
    aborted: 'recognitionAborted',
  }[error] || 'speechError';
}
