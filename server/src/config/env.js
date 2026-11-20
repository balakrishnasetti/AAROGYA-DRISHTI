import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const optionalUrl = z.union([z.string().url(), z.literal('')]).default('');
const optionalPort = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(1).max(65535).optional(),
);
const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEPLOYMENT_ENV: z.enum(['development', 'staging', 'production']).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    SEED_DEMO: booleanFromEnv,
    DEV_PATIENT_REGISTRATION_OTP: booleanFromEnv,
    MODEL_VALIDATED: booleanFromEnv,
    ABDM_ENABLED: booleanFromEnv,
    ABDM_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    ABDM_CLIENT_ID: z.string().default(''),
    ABDM_CLIENT_SECRET: z.string().default(''),
    ABDM_CM_ID: z.string().default(''),
    ABDM_SANDBOX_GATEWAY_URL: z.string().url().default('https://dev.abdm.gov.in'),
    ABDM_SANDBOX_API_URL: z.string().url().default('https://abhasbx.abdm.gov.in'),
    ABDM_PRODUCTION_GATEWAY_URL: optionalUrl,
    ABDM_PRODUCTION_API_URL: optionalUrl,
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    DATA_ENCRYPTION_KEY: z.string().default(''),
    SEED_STAFF_PASSWORD: z
      .string()
      .default('')
      .refine(
        (value) =>
          value === '' ||
          (value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)),
        'SEED_STAFF_PASSWORD must be at least 12 characters with upper, lower, and numeric characters',
      ),
    CLIENT_URL: z.string().url('CLIENT_URL must be a valid URL'),
    GEMINI_API_KEY: z.string().default(''),
    GEMINI_MODEL: z.string().trim().min(1).default('gemini-flash-lite-latest'),
    ORAL_MODEL_API_URL: optionalUrl,
    ORAL_MODEL_API_TOKEN: z.string().default(''),
    ORAL_MODEL_VERSION: z.string().default(''),
    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
    STORAGE_ENDPOINT: optionalUrl,
    STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./private-storage'),
    STORAGE_BUCKET: z.string().default(''),
    STORAGE_REGION: z.string().default(''),
    STORAGE_ACCESS_KEY: z.string().default(''),
    STORAGE_SECRET_KEY: z.string().default(''),
    MAPS_KEY: z.string().default(''),
    SMS_PROVIDER: z.string().default(''),
    SMS_API_KEY: z.string().default(''),
    SMS_TEMPLATE_ID: z.string().default(''),
    SMS_SENDER_ID: z.string().default(''),
    TURNSTILE_SECRET_KEY: z.string().default(''),
    TURNSTILE_SITE_KEY: z.string().default(''),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: optionalPort,
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().default(''),
    VIDEO_PROVIDER: z.string().default(''),
    VIDEO_API_KEY: z.string().default(''),
    VIDEO_WEBHOOK_SECRET: z.string().default(''),
    STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
    TURN_URLS: z.string().default(''),
    TURN_SHARED_SECRET: z.string().default(''),
    VAPID_PUBLIC_KEY: z.string().default(''),
    VAPID_PRIVATE_KEY: z.string().default(''),
    VAPID_SUBJECT: z.string().default('mailto:admin@example.invalid'),
  })
  .superRefine((environment, context) => {
    if (environment.ABDM_ENABLED) {
      for (const name of ['ABDM_CLIENT_ID', 'ABDM_CLIENT_SECRET', 'ABDM_CM_ID']) {
        if (!environment[name]) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: `${name} is required when ABDM_ENABLED is true.`,
          });
        }
      }
      if (
        environment.ABDM_ENVIRONMENT === 'production' &&
        (!environment.ABDM_PRODUCTION_GATEWAY_URL || !environment.ABDM_PRODUCTION_API_URL)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['ABDM_PRODUCTION_API_URL'],
          message: 'Configure both approved production ABDM base URLs before enabling production.',
        });
      }
    }

    const deploymentEnvironment =
      environment.DEPLOYMENT_ENV ??
      (environment.NODE_ENV === 'production' ? 'production' : 'development');
    if (
      environment.SEED_DEMO &&
      (deploymentEnvironment === 'production' ||
        (environment.NODE_ENV === 'production' && deploymentEnvironment !== 'staging'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SEED_DEMO'],
        message: 'SEED_DEMO must be false in production.',
      });
    }
    if (
      environment.DEV_PATIENT_REGISTRATION_OTP &&
      (environment.NODE_ENV !== 'development' ||
        environment.DEPLOYMENT_ENV === 'staging' ||
        environment.DEPLOYMENT_ENV === 'production')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DEV_PATIENT_REGISTRATION_OTP'],
        message: 'DEV_PATIENT_REGISTRATION_OTP is allowed only in local development.',
      });
    }
    if (
      environment.MODEL_VALIDATED &&
      (!environment.ORAL_MODEL_API_URL ||
        !environment.ORAL_MODEL_API_TOKEN ||
        !environment.ORAL_MODEL_VERSION)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['MODEL_VALIDATED'],
        message: 'A validated model requires its API URL, token, and version.',
      });
    }
    if (Boolean(environment.VAPID_PUBLIC_KEY) !== Boolean(environment.VAPID_PRIVATE_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['VAPID_PRIVATE_KEY'],
        message: 'Configure both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable browser push',
      });
    }
    if (Boolean(environment.TURNSTILE_SECRET_KEY) !== Boolean(environment.TURNSTILE_SITE_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SITE_KEY'],
        message: 'Configure both TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY.',
      });
    }
    if (environment.TURN_URLS && !environment.TURN_SHARED_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['TURN_SHARED_SECRET'],
        message: 'TURN_SHARED_SECRET is required when TURN_URLS are configured',
      });
    }
    if (environment.JWT_ACCESS_SECRET === environment.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT refresh and access secrets must be different',
      });
    }
    if (environment.NODE_ENV === 'production' && environment.DATA_ENCRYPTION_KEY.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['DATA_ENCRYPTION_KEY'],
        message: 'DATA_ENCRYPTION_KEY must be configured with at least 32 characters in production',
      });
    }
    if (environment.NODE_ENV === 'production' && environment.STORAGE_BACKEND === 'local') {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_BACKEND'],
        message: 'Local private storage is allowed only outside production.',
      });
    }
  });

export function parseEnv(environment) {
  return envSchema.safeParse(environment);
}

export function loadEnv(environment = process.env) {
  const parsed = parseEnv(environment);

  if (!parsed.success) {
    const invalidNames = parsed.error.issues
      .map((issue) => issue.path.join('.'))
      .filter((name, index, names) => names.indexOf(name) === index);
    throw new Error(`Invalid server environment. Check: ${invalidNames.join(', ')}`);
  }

  return parsed.data;
}
