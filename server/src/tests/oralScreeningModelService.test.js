import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOralScreeningModelProvider,
  getOralPhotoRetakeReasons,
  isOralScreeningModelConfigured,
} from '../services/oralScreeningModelService.js';
import { calculateOralScreeningRisk } from '../services/oralScreeningRiskService.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const probabilities = {
  white_patch: 0.8,
  red_patch: 0.05,
  ulcer_like_area: 0.05,
  raised_area: 0.05,
  no_visible_finding: 0.05,
};

function configuredProvider(response, status = 200, expectedPath = '/v1/oral-screenings/predict') {
  return createOralScreeningModelProvider(
    {
      ORAL_MODEL_API_URL: 'http://model-service:8000',
      ORAL_MODEL_API_TOKEN: 'test-token',
    },
    async (url, options) => {
      assert.equal(url.toString(), `http://model-service:8000${expectedPath}`);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(JSON.parse(options.body).imageBase64, Buffer.from('image').toString('base64'));
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => response,
      };
    },
  );
}

test('model provider is disabled unless URL and server-only token are configured', () => {
  assert.equal(isOralScreeningModelConfigured({}), false);
  assert.equal(
    isOralScreeningModelConfigured({
      ORAL_MODEL_API_URL: 'http://model-service:8000',
    }),
    false,
  );
});

test('model provider validates and decodes a calibrated prediction and PNG heatmap', async () => {
  const provider = configuredProvider({
    modelVersion: 'validated-artifact-v1',
    status: 'classified',
    finding: 'white_patch',
    confidence: 0.8,
    probabilities,
    heatmapBase64: png.toString('base64'),
    imageQuality: 'adequate',
    uncertaintyReason: null,
  });

  const prediction = await provider.analyze({
    imageBuffer: Buffer.from('image'),
    mimeType: 'image/jpeg',
    region: 'tongue',
  });

  assert.equal(prediction.finding, 'white_patch');
  assert.equal(prediction.heatmapBuffer.equals(png), true);
});

test('model provider preserves an unclear result without inventing a finding or heatmap', async () => {
  const provider = configuredProvider({
    modelVersion: 'v2',
    status: 'unclear',
    finding: null,
    confidence: null,
    probabilities: {},
    heatmapBase64: '',
    imageQuality: 'uncertain',
    uncertaintyReason: 'segmentation_ambiguous',
  });
  const prediction = await provider.analyze({
    imageBuffer: Buffer.from('image'),
    mimeType: 'image/jpeg',
    region: 'tongue',
  });
  assert.equal(prediction.status, 'unclear');
  assert.equal(prediction.finding, null);
  assert.equal(prediction.heatmapBuffer, null);
});

test('model provider validates oral-photo retake checks and reason codes', async () => {
  const provider = configuredProvider(
    {
      accepted: false,
      imageQuality: 'inadequate',
      reasons: ['not_oral'],
      width: 1280,
      height: 960,
      metrics: { blurScore: 120, brightness: 95 },
    },
    200,
    '/v1/oral-screenings/validate',
  );
  const result = await provider.validatePhoto({
    imageBuffer: Buffer.from('image'),
    mimeType: 'image/jpeg',
    region: 'tongue',
  });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.reasons, ['not_oral']);
});

test('trained classifier endpoint validates class probabilities and preserves uncalibrated confidence', async () => {
  const classProbabilities = { benign: 0.2, malignant: 0.8 };
  const prediction = await configuredProvider(
    {
      modelVersion: 'checkpoint-v1',
      status: 'classified',
      predictedClass: 'malignant',
      confidence: 0.8,
      confidenceCalibrated: false,
      classProbabilities,
      riskLevel: 'high',
      imageQuality: 'adequate',
      reasons: [],
      disclaimer:
        'This is an AI screening aid and not a medical diagnosis. Please consult a qualified doctor.',
    },
    200,
    '/predict',
  ).predict({
    imageBuffer: Buffer.from('image'),
    mimeType: 'image/jpeg',
    region: 'tongue',
  });

  assert.equal(prediction.predictedClass, 'malignant');
  assert.equal(prediction.confidence, 0.8);
  assert.equal(prediction.confidenceCalibrated, false);
  assert.equal(prediction.riskLevel, 'high');
});

test('trained classifier endpoint rejects an inconclusive payload containing prediction data', async () => {
  const invalidPrediction = {
    modelVersion: 'checkpoint-v1',
    status: 'inconclusive',
    predictedClass: 'healthy',
    confidence: 0.9,
    confidenceCalibrated: false,
    classProbabilities: {},
    riskLevel: 'unclear',
    imageQuality: 'inadequate',
    reasons: ['blur'],
    disclaimer: 'Please consult a qualified doctor.',
  };

  await assert.rejects(
    configuredProvider(invalidPrediction, 200, '/predict').predict({
      imageBuffer: Buffer.from('image'),
      mimeType: 'image/jpeg',
      region: 'tongue',
    }),
    /invalid prediction payload/,
  );
});

test('oral-photo validation uses a specific fallback when the service omits rejection reasons', () => {
  assert.deepEqual(getOralPhotoRetakeReasons([]), ['not_oral']);
  assert.deepEqual(getOralPhotoRetakeReasons(undefined), ['not_oral']);
  assert.deepEqual(getOralPhotoRetakeReasons(['blur']), ['blur']);
});

test('model provider rejects invalid probabilities, malformed output, and service errors', async () => {
  const badProbabilities = { ...probabilities, no_visible_finding: 0.5 };
  await assert.rejects(
    configuredProvider({
      modelVersion: 'v1',
      status: 'classified',
      finding: 'white_patch',
      confidence: 0.8,
      probabilities: badProbabilities,
      heatmapBase64: png.toString('base64'),
      imageQuality: 'adequate',
      uncertaintyReason: null,
    }).analyze({
      imageBuffer: Buffer.from('image'),
      mimeType: 'image/jpeg',
      region: 'tongue',
    }),
    /invalid class probabilities/,
  );

  await assert.rejects(
    configuredProvider({}, 503).analyze({
      imageBuffer: Buffer.from('image'),
      mimeType: 'image/jpeg',
      region: 'tongue',
    }),
    /HTTP 503/,
  );
});

test('questionnaire and image scores never treat a visual finding as a diagnosis', () => {
  const score = calculateOralScreeningRisk({
    finding: 'white_patch',
    probabilities,
    answers: [
      { questionKey: 'tobacco_type', answer: 'chewed', skipped: false },
      { questionKey: 'betel_nut', answer: true, skipped: false },
      { questionKey: 'alcohol', answer: true, skipped: false },
      { questionKey: 'symptoms', answer: ['non_healing_ulcer'], skipped: false },
      { questionKey: 'symptom_duration', answer: '2_4_weeks', skipped: false },
    ],
  });

  assert.equal(score.score, 88);
  assert.equal(score.questionnairePoints, 40);
  assert.equal(score.riskCategory, 'high');
  assert.deepEqual(score.factors, [
    'tobacco_reported',
    'betel_or_areca_reported',
    'alcohol_reported',
    'ulcer_reported_over_two_weeks',
  ]);
});

test('age and family history are included without converting skipped answers to negatives', () => {
  const score = calculateOralScreeningRisk({
    finding: 'no_visible_finding',
    probabilities: {
      ...probabilities,
      white_patch: 0,
      red_patch: 0,
      ulcer_like_area: 0,
      raised_area: 0,
      no_visible_finding: 1,
    },
    answers: [
      { questionKey: 'age', answer: '53', skipped: false },
      { questionKey: 'family_history', answer: true, skipped: false },
      { questionKey: 'betel_nut', answer: null, skipped: true },
    ],
  });
  assert.equal(score.questionnairePoints, 10);
  assert.deepEqual(score.factors, ['age_40_or_over_reported', 'family_history_reported']);
});
