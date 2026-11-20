import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

const forbiddenPatterns = [
  /cancer detected/i,
  /cancer ruled out/i,
  /healthy/i,
  /staging/i,
  /diagnosis/i,
  /diagnosed with/i,
  /cancer[- ]free/i,
  /not cancer/i,
];

const geminiResponseSchema = z.object({
  imageQuality: z.enum(['adequate', 'inadequate', 'uncertain']),
  observedFeatures: z.array(z.string().max(200)).default([]),
  region: z.string().trim().min(1).max(120),
  riskCategory: z.enum(['low', 'moderate', 'high', 'urgent_evaluation']),
  explanation: z.string().trim().min(1).max(3000),
  reportedSymptoms: z.array(z.string().trim().min(1).max(200)).default([]),
  lifestyleFactors: z.array(z.string().trim().min(1).max(200)).default([]),
  recommendedNextSteps: z.array(z.string().trim().min(1).max(200)).default([]),
  urgency: z.enum(['routine', 'soon', 'urgent']).default('routine'),
  limitations: z.array(z.string().trim().min(1).max(200)).default([]),
});

export function containsForbiddenLanguage(text = '') {
  return forbiddenPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => pattern.source);
}

export function buildFallbackReport({
  region = 'unspecified',
  reason = 'The system could not produce a screening result.',
} = {}) {
  return {
    imageQuality: 'uncertain',
    observedFeatures: [],
    region,
    riskCategory: 'unclear',
    explanation: `${reason} No finding was assigned. This is advisory only and not a diagnosis.`,
    reportedSymptoms: [],
    lifestyleFactors: [],
    recommendedNextSteps: ['Please seek clinician review. Retry with a new photo only if the service is available.'],
    urgency: 'soon',
    limitations: ['No reliable model result was produced.', 'Not for clinical use.'],
  };
}

function parseResponsePayload(content) {
  const raw = typeof content === 'string' ? content : JSON.stringify(content ?? {});
  const match = raw.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : raw;
  const parsed = JSON.parse(candidate);
  return geminiResponseSchema.parse(parsed);
}

function withBackoff(fn, retries = 2, delayMs = 250) {
  return async function execute(...args) {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        return await fn(...args);
      } catch (error) {
        if (attempt >= retries) throw error;
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
    throw new Error('Retry attempts exhausted');
  };
}

export function createModelProvider({ environment, modelName = 'gemini-1.5-flash' } = {}) {
  const apiKey = environment?.GEMINI_API_KEY || '';
  const client = apiKey ? new GoogleGenerativeAI(apiKey) : null;

  const run = withBackoff(async ({ imageBuffer, mimeType, questionnaireAnswers = [] }) => {
    if (!client) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
      systemInstruction:
        'Review this oral health photo only as an advisory, non-clinical aid. Use neutral wording. Never state a diagnosis, rule out cancer, or say someone is healthy. If the photo quality is poor, return imageQuality as inadequate or uncertain and request a new photo instead of a result.',
    });

    const prompt = [
      'Return JSON only with these keys: imageQuality, observedFeatures, region, riskCategory, explanation, reportedSymptoms, lifestyleFactors, recommendedNextSteps, urgency, limitations.',
      'Use only neutral descriptive language. Do not use diagnosis, staging, or cancer-free wording.',
      'Include the relevant questionnaire answers in context if provided.',
      `Questionnaire answers: ${JSON.stringify(questionnaireAnswers)}`,
    ].join('\n');

    const result = await Promise.race([
      model.generateContent([
        {
          inlineData: {
            mimeType,
            data: imageBuffer.toString('base64'),
          },
        },
        { text: prompt },
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('gemini timeout')), 30000)),
    ]);

    const text = result.response.text();
    const matches = containsForbiddenLanguage(text);
    if (matches.length > 0) {
      throw new Error(`Forbidden language blocked: ${matches.join(', ')}`);
    }

    const payload = parseResponsePayload(text);
    if (payload.imageQuality === 'inadequate' || payload.imageQuality === 'uncertain') {
      payload.recommendedNextSteps = ['Please retake the photo in better light, at a clearer angle, and without glare.'];
      payload.explanation = 'The image quality is not sufficient for a reliable oral screening assessment, so a new photo is requested.';
    }

    return payload;
  });

  return {
    async analyze({ imageBuffer, mimeType, questionnaireAnswers = [], region = 'unspecified' }) {
      try {
        return await run({ imageBuffer, mimeType, questionnaireAnswers, region });
      } catch (error) {
        const message = error?.message || 'Model error';
        const matches = containsForbiddenLanguage(message);
        if (matches.length > 0) {
          console.warn('Gemini output rejected by forbidden-language filter', { matches });
        }

        const fallback = buildFallbackReport({
          region,
          reason: message.includes('timeout') || message.includes('quota')
            ? 'The model was unavailable or timed out.'
            : 'The model response was invalid, incomplete, or unavailable.',
        });

        return fallback;
      }
    },
  };
}

export const geminiModelProvider = createModelProvider;
