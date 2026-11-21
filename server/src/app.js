import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { createHealthRoutes } from './routes/healthRoutes.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createUserRoutes } from './routes/userRoutes.js';
import { createPatientRoutes } from './routes/patientRoutes.js';
import { createAdminRoutes, createHospitalManagerRoutes } from './routes/managementRoutes.js';
import { createDiscoveryRoutes } from './routes/discoveryRoutes.js';
import { createAppointmentRoutes } from './routes/appointmentRoutes.js';
import { createDoctorRoutes } from './routes/doctorRoutes.js';
import { createNotificationRoutes } from './routes/notificationRoutes.js';
import { createVideoRoutes } from './routes/videoRoutes.js';
import { createAiRoutes } from './routes/aiRoutes.js';
import { createAssistantRoutes } from './routes/assistantRoutes.js';
import { createSyncRoutes } from './routes/syncRoutes.js';
import { createGovernanceRoutes } from './routes/governanceRoutes.js';
import { createFieldWorkRoutes } from './routes/fieldWorkRoutes.js';
import { createDemoProviderAdminRoutes } from './routes/demoProviderAdminRoutes.js';
import { createCallRoutes } from './routes/callRoutes.js';
import { createStaffAccessRequestRoutes } from './routes/staffAccessRequestRoutes.js';
import { loggerOptions } from './config/logger.js';
import { requestIdMiddleware } from './utils/requestId.js';
import { ApiError } from './utils/apiError.js';
import { isDemoSeedEnabled } from './config/demoMode.js';

export function createApp(environment) {
  const app = express();
  const defaultCspDirectives = helmet.contentSecurityPolicy.getDefaultDirectives();
  const cspDirectives = {
    ...defaultCspDirectives,
    'script-src': [...defaultCspDirectives['script-src'], 'https://challenges.cloudflare.com'],
    'frame-src': ["'self'", 'https://challenges.cloudflare.com'],
    'connect-src': [
      ...(defaultCspDirectives['connect-src'] ?? defaultCspDirectives['default-src']),
      'https://challenges.cloudflare.com',
    ],
  };
  const allowedOrigins = new Set([environment.CLIENT_URL]);
  if (environment.NODE_ENV === 'development') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  app.set('trust proxy', environment.NODE_ENV === 'production' ? 1 : false);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(pinoHttp({ ...loggerOptions, genReqId: (req) => req.id }));
  app.use(
    helmet({
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      contentSecurityPolicy: { directives: cspDirectives },
    }),
  );
  if (environment.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.secure) return next();
      return res.status(400).json({
        success: false,
        code: 'HTTPS_REQUIRED',
        message: 'Use a secure HTTPS connection to access this service.',
        details: null,
      });
    });
  }
  app.use(
    cors(),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: environment.NODE_ENV === 'development' ? 1000 : 100,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a few minutes and try again.',
        details: null,
      },
    }),
  );
  app.use(
    '/api/v1/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: environment.NODE_ENV === 'development' ? 500 : 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(
    '/api/v1/patients',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(
    '/api/v1/governance',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(
    '/api/v1/field',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  app.use('/api/v1', createHealthRoutes(environment));
  app.use('/api/v1/auth', createAuthRoutes(environment));
  app.use('/api/v1/staff-access-requests', createStaffAccessRequestRoutes(environment));
  app.use('/api/v1/users', createUserRoutes(environment));
  app.use('/api/v1/patients', createPatientRoutes(environment));
  if (isDemoSeedEnabled(environment)) {
    app.use('/api/v1/admin/demo-providers', createDemoProviderAdminRoutes(environment));
  }
  app.use('/api/v1/admin', createAdminRoutes(environment));
  app.use('/api/v1/hospital-manager', createHospitalManagerRoutes(environment));
  app.use('/api/v1/appointments', createAppointmentRoutes(environment));
  app.use('/api/v1/doctor', createDoctorRoutes(environment));
  app.use('/api/v1/notifications', createNotificationRoutes(environment));
  app.use('/api/v1/video', createVideoRoutes(environment));
  app.use('/api/v1/calls', createCallRoutes(environment));
  app.use('/api/v1/ai', createAiRoutes(environment));
  const assistantRoutes = createAssistantRoutes(environment);
  app.use('/api/assistant', assistantRoutes);
  app.use('/api/v1/assistant', assistantRoutes);
  app.use('/api/v1/sync', createSyncRoutes(environment));
  app.use('/api/v1/governance', createGovernanceRoutes(environment));
  app.use('/api/v1/field', createFieldWorkRoutes(environment));
  app.use('/api/v1', createDiscoveryRoutes(environment));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
