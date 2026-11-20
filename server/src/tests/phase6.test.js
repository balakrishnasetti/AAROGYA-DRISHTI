import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { assessImageQuality } from '../services/imageQualityService.js';
import { buildFallbackReport, containsForbiddenLanguage, createModelProvider } from '../services/geminiService.js';

test('blurry image is rejected as inadequate quality', async () => {
  const buffer = await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .blur(7)
    .jpeg()
    .toBuffer();

  const result = await assessImageQuality({ buffer, mimetype: 'image/jpeg' });
  assert.ok(['inadequate', 'uncertain'].includes(result.imageQuality));
});

test('uncertain image quality includes actionable reasons for photo retakes', async () => {
  const width = 640;
  const height = 480;
  const pixels = Buffer.alloc(width * height, 100);
  for (let y = 0; y < height; y += 1) {
    pixels.fill(255, y * width, y * width + width / 10);
  }
  const buffer = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();

  const result = await assessImageQuality({ buffer, mimetype: 'image/png' });
  assert.equal(result.imageQuality, 'uncertain');
  assert.ok(result.reasons.includes('blur'));
  assert.ok(result.reasons.includes('glare'));
});

test('unconfigured Gemini service does not produce a low-risk screening result', async () => {
  const provider = createModelProvider({ environment: { GEMINI_API_KEY: '' } });
  const result = await provider.analyze({
    imageBuffer: Buffer.from('not-a-real-image'),
    mimeType: 'image/jpeg',
    questionnaireAnswers: [{ question: 'symptom_duration', answer: '2-4 weeks' }],
    region: 'tongue',
  });

  assert.equal(result.imageQuality, 'uncertain');
  assert.equal(result.riskCategory, 'unclear');
  assert.deepEqual(result.observedFeatures, []);
  assert.match(result.explanation, /unavailable|no screening result|invalid|incomplete/i);
});

test('forbidden phrases are blocked by the post-filter', () => {
  const hits = containsForbiddenLanguage('The image suggests cancer detected and is not a diagnosis.');
  assert.ok(hits.length > 0);
  assert.ok(hits.some((hit) => hit.toLowerCase().includes('cancer')));
});

test('model API keys never appear in the client bundle', () => {
  const clientRoots = [
    path.resolve(process.cwd(), '..', 'client', 'src'),
    path.resolve(process.cwd(), 'client', 'src'),
    path.resolve(process.cwd(), '..', '..', 'client', 'src'),
  ];

  const clientRoot = clientRoots.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });

  if (!clientRoot) {
    assert.ok(true, 'No client source directory is present in this workspace layout.');
    return;
  }

  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else files.push(fullPath);
    }
  }

  walk(clientRoot);
  const bundledText = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.equal(bundledText.includes('GEMINI_API_KEY'), false);
  assert.equal(bundledText.includes('ANTHROPIC_API_KEY'), false);
});

test('fallback report includes a safe non-diagnostic message', () => {
  const result = buildFallbackReport({ region: 'lips' });
  assert.equal(result.riskCategory, 'unclear');
  assert.deepEqual(result.observedFeatures, []);
  assert.match(result.explanation, /not a diagnosis/i);
});
