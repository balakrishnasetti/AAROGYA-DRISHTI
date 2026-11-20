import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { createAiAssistantService, readAiSettings } from '../services/aiAssistantService.js';
import {
  AiAssistantSettings,
  AiReport,
  AiReportFeedback,
  Consent,
  Patient,
} from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { writeAuditLog } from '../services/auditService.js';

const createSessionSchema = z
  .object({
    language: z.enum(['en', 'te']).default('en'),
  })
  .strict();

const messageSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    language: z.enum(['en', 'te']).default('en'),
  })
  .strict();

async function assertAiProcessingConsent(patientId) {
  const consent = await Consent.findOne({ patientId, consentType: 'ai_processing' })
    .sort({ recordedAt: -1 })
    .lean();
  if (!consent?.granted || consent.withdrawnAt) {
    throw new ApiError(
      403,
      'CONSENT_REQUIRED',
      'Active AI processing consent is required before using the assistant.',
    );
  }
}

export function createAiRoutes(environment) {
  const router = Router();
  const service = createAiAssistantService({
    apiKey: environment.GEMINI_API_KEY,
    modelName: environment.GEMINI_MODEL,
  });

  router.use(authenticate(environment));

  async function getOwnedSession(req) {
    if (!mongoose.isValidObjectId(req.params.sessionId)) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'AI session not found.');
    }
    const patient = await Patient.findOne({ userId: req.user.id, active: true })
      .select('_id')
      .lean();
    const session = await service.getSession(req.params.sessionId);
    if (
      !patient ||
      !session ||
      session.userId.toString() !== req.user.id.toString() ||
      session.patientId.toString() !== patient._id.toString()
    ) {
      throw new ApiError(404, 'SESSION_NOT_FOUND', 'AI session not found.');
    }
    await assertAiProcessingConsent(patient._id);
    return session;
  }

  router.post(
    '/sessions',
    authorize('patient'),
    validateBody(createSessionSchema),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true }).lean();
      if (!patient) {
        return res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'Patient record not found.',
        });
      }
      await assertAiProcessingConsent(patient._id);
      const session = await service.startSession({
        patientId: patient._id.toString(),
        userId: req.user.id,
        language: req.body.language || 'en',
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'ai_assistant_session',
        resourceId: session._id.toString(),
        requestId: req.id,
      });
      return res.status(201).json({ success: true, data: session });
    }),
  );

  router.get(
    '/sessions',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true }).lean();
      if (!patient) {
        return res.status(404).json({
          success: false,
          code: 'PATIENT_NOT_FOUND',
          message: 'Patient record not found.',
        });
      }
      await assertAiProcessingConsent(patient._id);
      const sessions = await service.listSessions(patient._id.toString());
      return res.json({ success: true, data: sessions });
    }),
  );

  router.get(
    '/sessions/:sessionId',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const session = await getOwnedSession(req);
      return res.json({ success: true, data: session });
    }),
  );

  router.post(
    '/sessions/:sessionId/message',
    authorize('patient'),
    validateBody(messageSchema),
    asyncHandler(async (req, res) => {
      await getOwnedSession(req);
      const acceptsSse = req.get('accept')?.includes('text/event-stream');

      if (acceptsSse) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
      }

      const result = await service.generateReply({
        sessionId: req.params.sessionId,
        userText: req.body.message,
        language: req.body.language || 'en',
      });
      if (result.unavailable) {
        throw new ApiError(
          503,
          'AI_ASSISTANT_UNAVAILABLE',
          'The AI assistant could not reach its configured provider. Please try again later.',
        );
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'ai_assistant_message',
        resourceId: req.params.sessionId,
        requestId: req.id,
        metadata: { urgent: Boolean(result.urgent) },
      });

      if (acceptsSse) {
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify({ success: true, data: result })}\n\n`);
        res.end();
        return;
      }

      return res.json({ success: true, data: result });
    }),
  );

  router.post(
    '/sessions/:sessionId/end',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      await getOwnedSession(req);
      const session = await service.endSession(req.params.sessionId);
      if (!session) {
        return res
          .status(404)
          .json({ success: false, code: 'SESSION_NOT_FOUND', message: 'AI session not found.' });
      }
      return res.json({ success: true, data: session });
    }),
  );

  router.get(
    '/sessions/:sessionId/summary',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      await getOwnedSession(req);
      const summary = await service.createSummary(req.params.sessionId);
      if (!summary) {
        return res
          .status(404)
          .json({ success: false, code: 'SESSION_NOT_FOUND', message: 'AI session not found.' });
      }
      return res.json({ success: true, data: summary });
    }),
  );

  router.get(
    '/sessions/:sessionId/summary.pdf',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      await getOwnedSession(req);
      const buffer = await service.createSummaryPdf(req.params.sessionId);
      if (!buffer) {
        return res
          .status(404)
          .json({ success: false, code: 'SESSION_NOT_FOUND', message: 'AI session not found.' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="ai-summary.pdf"');
      return res.send(buffer);
    }),
  );

  router.get(
    '/settings',
    authorize('admin'),
    asyncHandler(async (_req, res) => {
      const settings = await readAiSettings(AiAssistantSettings);
      return res.json({ success: true, data: settings });
    }),
  );

  router.patch(
    '/settings',
    authorize('admin'),
    validateBody(
      z.object({
        provider: z.enum(['gemini', 'openai', 'custom']).optional(),
        languages: z.array(z.enum(['en', 'te'])).optional(),
        safetyText: z.string().trim().min(1).max(2000).optional(),
        avatarEnabled: z.boolean().optional(),
        avatarLabel: z.string().trim().min(1).max(200).optional(),
        voiceEnabled: z.boolean().optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const settings = await AiAssistantSettings.findOneAndUpdate(
        {},
        { $set: req.body },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      return res.json({ success: true, data: settings });
    }),
  );

  router.get(
    '/screening-monitoring',
    authorize('admin'),
    asyncHandler(async (req, res) => {
      const query = z
        .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
        .safeParse(req.query);
      if (!query.success) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Choose a monitoring window between 7 and 365 days.',
        );
      }
      const since = new Date(Date.now() - query.data.days * 24 * 60 * 60 * 1000);
      const [dailyPredictions, clinicianFeedback] = await Promise.all([
        AiReport.aggregate([
          { $match: { generatedAt: { $gte: since } } },
          {
            $group: {
              _id: {
                day: { $dateToString: { format: '%Y-%m-%d', date: '$generatedAt' } },
                modelVersion: '$modelVersion',
              },
              predictionCount: { $sum: 1 },
              unclearCount: {
                $sum: { $cond: [{ $eq: ['$riskCategory', 'unclear'] }, 1, 0] },
              },
              highCount: { $sum: { $cond: [{ $eq: ['$riskCategory', 'high'] }, 1, 0] } },
              averageConfidence: { $avg: '$confidence' },
            },
          },
          { $sort: { '_id.day': 1, '_id.modelVersion': 1 } },
        ]),
        AiReportFeedback.aggregate([
          { $match: { createdAt: { $gte: since } } },
          {
            $lookup: {
              from: 'ai_reports',
              localField: 'reportId',
              foreignField: '_id',
              as: 'report',
            },
          },
          { $unwind: '$report' },
          {
            $group: {
              _id: '$report.modelVersion',
              feedbackCount: { $sum: 1 },
              corrections: { $sum: { $cond: ['$agreesWithFinding', 0, 1] } },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'oral_screening_model_monitoring',
        requestId: req.id,
        metadata: { days: query.data.days, dataPoints: dailyPredictions.length },
      });
      return res.json({
        success: true,
        details: {
          since,
          days: query.data.days,
          dailyPredictions,
          clinicianFeedback,
          limitation:
            'Distribution changes are monitoring signals, not measured clinical drift or performance. Ground-truth labels and subgroup evaluation are required.',
        },
      });
    }),
  );

  return router;
}
