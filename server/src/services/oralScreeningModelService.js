import { z } from 'zod';

const findingNames = [
  'white_patch',
  'red_patch',
  'ulcer_like_area',
  'raised_area',
  'no_visible_finding',
];

const probabilitiesSchema = z
  .object(Object.fromEntries(findingNames.map((finding) => [finding, z.number().min(0).max(1)])))
  .strict();

const predictionSchema = z
  .object({
    modelVersion: z.string().trim().min(1).max(80),
    status: z.enum(['classified', 'unclear']),
    finding: z.enum(findingNames).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    probabilities: z.union([probabilitiesSchema, z.object({}).strict()]),
    heatmapBase64: z.string().max(3_000_000),
    imageQuality: z.enum(['adequate', 'uncertain']),
    uncertaintyReason: z.string().max(80).nullable(),
  })
  .strict()
  .superRefine((prediction, context) => {
    if (prediction.status === 'classified') {
      if (!prediction.finding || !prediction.confidence || prediction.imageQuality !== 'adequate') {
        context.addIssue({
          code: 'custom',
          message: 'A classified result must include a finding and confidence.',
        });
      }
      if (!prediction.heatmapBase64) {
        context.addIssue({
          code: 'custom',
          message: 'A classified result must include a heatmap.',
        });
      }
    } else if (
      prediction.finding ||
      prediction.heatmapBase64 ||
      prediction.imageQuality !== 'uncertain'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An unclear result must not include a finding or heatmap.',
      });
    }
  });

const validationSchema = z
  .object({
    accepted: z.boolean(),
    imageQuality: z.enum(['adequate', 'inadequate']),
    reasons: z.array(z.enum(['resolution', 'blur', 'too_dark', 'glare', 'not_oral'])),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    metrics: z.record(z.string(), z.number().finite()),
  })
  .strict();

const trainedPredictionSchema = z
  .object({
    modelVersion: z.string().trim().min(1).max(80),
    status: z.enum(['classified', 'inconclusive']),
    predictedClass: z.enum(['benign', 'malignant']).nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    confidenceCalibrated: z.boolean(),
    classProbabilities: z.record(z.string(), z.number().min(0).max(1)),
    riskLevel: z.enum(['low', 'moderate', 'high', 'unclear']),
    imageQuality: z.enum(['adequate', 'inadequate']),
    reasons: z.array(z.enum(['resolution', 'blur', 'too_dark', 'glare', 'low_confidence'])),
    disclaimer: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((prediction, context) => {
    if (prediction.status === 'classified') {
      if (
        !prediction.predictedClass ||
        prediction.confidence === null ||
        prediction.imageQuality !== 'adequate' ||
        prediction.riskLevel === 'unclear'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A classified result must include a usable prediction.',
        });
        return;
      }
      const probabilities = Object.values(prediction.classProbabilities);
      if (
        probabilities.length !== 2 ||
        Math.abs(probabilities.reduce((total, value) => total + value, 0) - 1) > 0.02 ||
        prediction.classProbabilities[prediction.predictedClass] !== prediction.confidence
      ) {
        context.addIssue({
          code: 'custom',
          message: 'The prediction probabilities are inconsistent.',
        });
      }
    } else if (
      prediction.predictedClass ||
      prediction.confidence !== null ||
      Object.keys(prediction.classProbabilities).length !== 0 ||
      prediction.riskLevel !== 'unclear'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An inconclusive result must not include a prediction.',
      });
    }
  });

export function isOralScreeningModelConfigured(environment = {}) {
  return Boolean(environment.ORAL_MODEL_API_URL && environment.ORAL_MODEL_API_TOKEN);
}

export function getOralPhotoRetakeReasons(reasons) {
  return reasons?.length ? reasons : ['not_oral'];
}

export function createOralScreeningModelProvider(environment = {}, fetchImplementation = fetch) {
  const configured = isOralScreeningModelConfigured(environment);

  async function post(path, { imageBuffer, mimeType, region }) {
    const baseUrl = new URL(environment.ORAL_MODEL_API_URL);
    const endpoint = new URL(path, baseUrl);
    return fetchImplementation(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${environment.ORAL_MODEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageBase64: imageBuffer.toString('base64'),
        mimeType,
        region,
      }),
      signal: AbortSignal.timeout(path.endsWith('/validate') ? 30_000 : 45_000),
    });
  }

  return {
    configured,
    async getStatus() {
      if (!configured) return { status: 'not_configured', modelVersion: null };
      const endpoint = new URL('/health', environment.ORAL_MODEL_API_URL);
      const response = await fetchImplementation(endpoint, {
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return { status: 'unavailable', modelVersion: null };
      const result = await response.json();
      const modelStatus = result.classifierModel?.status || result.status;
      return {
        status: ['ready', 'not_ready'].includes(modelStatus) ? modelStatus : 'unavailable',
        modelVersion: result.classifierModel?.version || result.modelVersion || null,
      };
    },
    async validatePhoto({ imageBuffer, mimeType, region }) {
      if (!configured) return null;
      const response = await post('/v1/oral-screenings/validate', {
        imageBuffer,
        mimeType,
        region,
      });
      if (!response.ok) {
        throw new Error(`Oral model validation service returned HTTP ${response.status}.`);
      }
      const parsed = validationSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('Oral model service returned an invalid image validation response.');
      }
      return parsed.data;
    },
    async analyze({ imageBuffer, mimeType, region }) {
      if (!configured) return null;
      const response = await post('/v1/oral-screenings/predict', {
        imageBuffer,
        mimeType,
        region,
      });
      if (!response.ok) {
        throw new Error(`Oral model service returned HTTP ${response.status}.`);
      }

      const parsed = predictionSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('Oral model service returned an invalid prediction payload.');
      }

      const heatmap = parsed.data.heatmapBase64
        ? Buffer.from(parsed.data.heatmapBase64, 'base64')
        : null;
      if (heatmap) {
        const validBase64 = heatmap.toString('base64') === parsed.data.heatmapBase64;
        const isPng =
          heatmap.length >= 8 &&
          heatmap.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (!validBase64 || !isPng || heatmap.length > 2_000_000) {
          throw new Error('Oral model service returned an invalid heatmap.');
        }
      }

      const probabilities = parsed.data.probabilities;
      if (parsed.data.status === 'classified') {
        const probabilityTotal = Object.values(probabilities).reduce(
          (total, value) => total + value,
          0,
        );
        if (Math.abs(probabilityTotal - 1) > 0.02) {
          throw new Error('Oral model service returned invalid class probabilities.');
        }
        if (probabilities[parsed.data.finding] !== parsed.data.confidence) {
          throw new Error('Oral model confidence does not match the selected class.');
        }
      } else if (Object.keys(probabilities).length !== 0 && !parsed.data.confidence) {
        throw new Error('Unclear model output has inconsistent confidence data.');
      }

      return {
        ...parsed.data,
        heatmapBuffer: heatmap,
      };
    },
    async predict({ imageBuffer, mimeType, region }) {
      if (!configured) return null;
      const response = await post('/predict', { imageBuffer, mimeType, region });
      if (!response.ok) {
        throw new Error(`Oral model service returned HTTP ${response.status}.`);
      }
      const parsed = trainedPredictionSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('Oral model service returned an invalid prediction payload.');
      }
      return parsed.data;
    },
  };
}
