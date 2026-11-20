import { createHmac, randomUUID } from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import {
  AiReport,
  ConsultationRequest,
  Consent,
  DoctorProfile,
  FollowUp,
  Hospital,
  Patient,
  PushSubscription,
  Referral,
  ScreeningSession,
  TeleconsultationNote,
  User,
} from '../models/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../utils/apiError.js';
import { getAppointableDoctorFilter } from '../utils/providerEligibility.js';
import { writeAuditLog } from '../services/auditService.js';
import { isAllowedPushEndpoint } from '../services/webPushService.js';
import { detectUrgentCall } from '../services/consultationRules.js';
import { decryptField, encryptField } from '../services/fieldEncryption.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const requestSchema = z
  .object({
    doctorId: objectId.optional(),
    reason: z.enum(['follow_up', 'new_symptom', 'report_question']),
    details: z.string().trim().max(1200).default(''),
    reportId: objectId.optional(),
    consentAccepted: z.literal(true),
    consentVersion: z.literal('video-call-v1'),
    language: z.enum(['en', 'te']),
  })
  .strict();
const responseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }).strict(),
  z.object({ action: z.literal('decline'), reason: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal('suggest_time'), suggestedAt: z.coerce.date() }).strict(),
]);
const subscriptionSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    expirationTime: z.number().positive().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(16).max(256),
        auth: z.string().min(8).max(256),
      })
      .strict(),
  })
  .strict();
const noteSchema = z
  .object({
    body: z.string().trim().min(5).max(20000),
    followUpDate: z.coerce.date().optional(),
    followUpInstructions: z.string().trim().max(2000).optional(),
    referralReason: z.string().trim().min(10).max(2000).optional(),
    referralSpecialty: z.string().trim().max(120).optional(),
    referralDestination: z.string().trim().max(160).optional(),
  })
  .strict();

const reasonLabels = {
  follow_up: 'Follow-up',
  new_symptom: 'New symptom',
  report_question: 'Question about a screening report',
};

function isActiveConsent(consent) {
  return consent?.granted === true && !consent.withdrawnAt;
}

function callSummary(request, report) {
  return {
    reportId: report?._id ?? null,
    report: report
      ? {
          finding: report.finding ?? null,
          region: report.region,
          riskCategory: report.riskCategory,
          urgency: report.urgency,
          generatedAt: report.generatedAt,
          notForClinicalUse: true,
        }
      : null,
    reason: request.reason,
    urgent: request.urgent,
  };
}

async function getVisibleRequest(requestId, user, environment) {
  const request = await ConsultationRequest.findById(requestId).lean();
  if (!request) throw new ApiError(404, 'CALL_REQUEST_NOT_FOUND', 'Call request not found.');
  const patient =
    user.role === 'patient'
      ? await Patient.findOne({ _id: request.patientId, userId: user.id, active: true })
          .select('_id')
          .lean()
      : null;
  const isPatient = Boolean(patient);
  const isDoctor =
    ['doctor', 'specialist'].includes(user.role) &&
    request.doctorId.toString() === user.id.toString();
  if (!isPatient && !isDoctor) {
    throw new ApiError(403, 'CALL_REQUEST_ACCESS_DENIED', 'You are not a participant in this request.');
  }
  const [patientUser, doctor, report] = await Promise.all([
    Patient.findById(request.patientId).select('userId').lean(),
    User.findById(request.doctorId).select('fullName').lean(),
    request.screeningReportId
      ? Consent.findOne({ patientId: request.patientId, consentType: 'data_sharing' })
          .sort({ recordedAt: -1 })
          .lean()
          .then((consent) =>
            isActiveConsent(consent)
              ? AiReport.findById(request.screeningReportId)
                  .select('finding region riskCategory urgency generatedAt')
                  .lean()
              : null,
          )
      : null,
  ]);
  const patientRecord = patientUser
    ? await User.findById(patientUser.userId).select('fullName').lean()
    : null;
  return {
    ...request,
    patientName: patientRecord?.fullName ?? 'Patient',
    doctorName: doctor?.fullName ?? 'Doctor',
    ...callSummary(request, report),
    details: decryptField(
      request.details,
      environment.DATA_ENCRYPTION_KEY || environment.JWT_ACCESS_SECRET,
    ),
  };
}

export function createCallRoutes(environment) {
  const router = Router();
  router.use(authenticate(environment));
  router.param('requestId', (req, _res, next, requestId) => {
    if (!/^[a-f\d]{24}$/i.test(requestId)) {
      return next(new ApiError(404, 'CALL_REQUEST_NOT_FOUND', 'Call request not found.'));
    }
    return next();
  });

  router.get(
    '/push/public-key',
    authorize('patient', 'doctor', 'specialist'),
    asyncHandler(async (req, res) => {
      res.json({
        success: true,
        details: { publicKey: req.app.get('pushService')?.publicKey || '' },
      });
    }),
  );

  router.put(
    '/push/subscription',
    authorize('patient', 'doctor', 'specialist'),
    validateBody(subscriptionSchema),
    asyncHandler(async (req, res) => {
      if (!req.app.get('pushService')?.publicKey) {
        throw new ApiError(503, 'PUSH_NOT_CONFIGURED', 'Browser push is not configured on this server.');
      }
      if (!isAllowedPushEndpoint(req.body.endpoint)) {
        throw new ApiError(400, 'PUSH_ENDPOINT_NOT_ALLOWED', 'This browser push endpoint is not supported.');
      }
      await PushSubscription.findOneAndUpdate(
        { endpoint: req.body.endpoint },
        {
          $set: {
            userId: req.user.id,
            endpoint: req.body.endpoint,
            keys: req.body.keys,
            expirationTime: req.body.expirationTime
              ? new Date(req.body.expirationTime)
              : null,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
      res.status(204).end();
    }),
  );

  router.delete(
    '/push/subscription',
    authorize('patient', 'doctor', 'specialist'),
    validateBody(z.object({ endpoint: z.string().url().max(2048) }).strict()),
    asyncHandler(async (req, res) => {
      await PushSubscription.deleteOne({ userId: req.user.id, endpoint: req.body.endpoint });
      res.status(204).end();
    }),
  );

  router.get(
    '/doctors',
    authorize('patient'),
    asyncHandler(async (_req, res) => {
      const profiles = await DoctorProfile.find({ $or: getAppointableDoctorFilter() })
        .sort({ specialty: 1, createdAt: 1 })
        .limit(100)
        .lean();
      const [users, hospitals] = await Promise.all([
        User.find({
          _id: { $in: profiles.map((profile) => profile.userId) },
          role: { $in: ['doctor', 'specialist'] },
          status: 'active',
        })
          .select('_id fullName')
          .lean(),
        Hospital.find({
          _id: { $in: profiles.map((profile) => profile.hospitalId) },
          status: 'active',
        })
          .select('_id name')
          .lean(),
      ]);
      const userById = new Map(users.map((item) => [item._id.toString(), item]));
      const hospitalById = new Map(hospitals.map((item) => [item._id.toString(), item]));
      res.json({
        success: true,
        details: profiles
          .filter(
            (profile) =>
              userById.has(profile.userId.toString()) &&
              hospitalById.has(profile.hospitalId.toString()),
          )
          .map((profile) => ({
            id: profile.userId,
            fullName: userById.get(profile.userId.toString()).fullName,
            specialty: profile.specialty || 'Doctor',
            hospitalId: profile.hospitalId,
            hospitalName: hospitalById.get(profile.hospitalId.toString()).name,
          })),
      });
    }),
  );

  router.get(
    '/mine',
    authorize('patient', 'doctor', 'specialist'),
    asyncHandler(async (req, res) => {
      await ConsultationRequest.updateMany(
        { status: 'pending', expiresAt: { $lte: new Date() } },
        { $set: { status: 'expired' } },
      );
      let filter;
      if (req.user.role === 'patient') {
        const patient = await Patient.findOne({
          userId: req.user.id,
          active: true,
        }).select('_id');
        if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');
        filter = { patientId: patient._id };
      } else {
        filter = { doctorId: req.user.id };
      }
      const requests = await ConsultationRequest.find(filter)
        .sort({ requestedAt: -1 })
        .limit(50)
        .lean();
      const details = await Promise.all(
        requests.map((request) => getVisibleRequest(request._id, req.user, environment)),
      );
      res.json({ success: true, details });
    }),
  );

  router.post(
    '/requests',
    authorize('patient'),
    validateBody(requestSchema),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ userId: req.user.id, active: true })
        .select('_id')
        .lean();
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient record not found.');

      let selectedProfile;
      if (req.body.doctorId) {
        selectedProfile = await DoctorProfile.findOne({
          userId: req.body.doctorId,
          $or: getAppointableDoctorFilter(),
        }).lean();
        if (!selectedProfile) {
          throw new ApiError(404, 'DOCTOR_NOT_AVAILABLE', 'That doctor is not available for calls.');
        }
      } else {
        const profiles = await DoctorProfile.find({ $or: getAppointableDoctorFilter() })
          .sort({ createdAt: 1 })
          .limit(50)
          .lean();
        const activeProfiles = [];
        for (const profile of profiles) {
          const [user, hospital] = await Promise.all([
            User.exists({
              _id: profile.userId,
              role: { $in: ['doctor', 'specialist'] },
              status: 'active',
            }),
            Hospital.exists({ _id: profile.hospitalId, status: 'active' }),
          ]);
          if (user && hospital) activeProfiles.push(profile);
        }
        const workloads = await Promise.all(
          activeProfiles.map(async (profile) => ({
            profile,
            pendingCount: await ConsultationRequest.countDocuments({
              doctorId: profile.userId,
              status: 'pending',
              expiresAt: { $gt: new Date() },
            }),
          })),
        );
        selectedProfile = workloads
          .sort((left, right) => left.pendingCount - right.pendingCount)[0]?.profile;
        if (!selectedProfile) {
          throw new ApiError(503, 'NO_DOCTOR_AVAILABLE', 'No doctor is available to receive this request.');
        }
      }

      const [doctor, hospital] = await Promise.all([
        User.findOne({
          _id: selectedProfile.userId,
          role: { $in: ['doctor', 'specialist'] },
          status: 'active',
        })
          .select('_id fullName')
          .lean(),
        Hospital.findOne({ _id: selectedProfile.hospitalId, status: 'active' })
          .select('_id')
          .lean(),
      ]);
      if (!doctor || !hospital) {
        throw new ApiError(503, 'DOCTOR_NOT_AVAILABLE', 'That doctor is not available for calls.');
      }

      let screeningSessionId;
      let screeningReportId;
      if (req.body.reportId) {
        const report = await AiReport.findById(req.body.reportId)
          .select('_id screeningSessionId')
          .lean();
        const screening = report
          ? await ScreeningSession.findOne({
              _id: report.screeningSessionId,
              patientId: patient._id,
            })
              .select('_id')
              .lean()
          : null;
        if (!screening) throw new ApiError(404, 'SCREENING_REPORT_NOT_FOUND', 'That report was not found.');
        const consent = await Consent.findOne({
          patientId: patient._id,
          consentType: 'data_sharing',
        })
          .sort({ recordedAt: -1 })
          .lean();
        if (!isActiveConsent(consent)) {
          throw new ApiError(
            403,
            'DATA_SHARING_CONSENT_REQUIRED',
            'Active data-sharing consent is required to attach a screening report.',
          );
        }
        screeningSessionId = screening._id;
        screeningReportId = report._id;
      }

      const now = new Date();
      const urgent = detectUrgentCall(req.body.details);
      const consent = await Consent.create({
        patientId: patient._id,
        consentType: 'teleconsultation',
        consentVersion: req.body.consentVersion.slice(0, 40),
        textVersion: req.body.consentVersion,
        language: req.body.language,
        granted: true,
        recordedAt: now,
        recordedBy: req.user.id,
      });
      const request = await ConsultationRequest.create({
        patientId: patient._id,
        doctorId: doctor._id,
        hospitalId: hospital._id,
        reason: req.body.reason,
        details: encryptField(
          req.body.details,
          environment.DATA_ENCRYPTION_KEY || environment.JWT_ACCESS_SECRET,
        ),
        urgent,
        ...(screeningSessionId ? { screeningSessionId, screeningReportId } : {}),
        teleconsultationConsentVersion: consent.textVersion,
        teleconsultationConsentedAt: now,
        requestedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
      const payload = {
        requestId: request._id.toString(),
        doctorId: doctor._id.toString(),
        patientUserId: req.user.id.toString(),
        patientName: req.user.fullName,
        reason: reasonLabels[request.reason],
        urgent: request.urgent,
        reportAttached: Boolean(request.screeningReportId),
        status: request.status,
      };
      req.app.get('io')?.to(`user:${doctor._id}`).emit('consultation:request-created', payload);
      await req.app.get('pushService')?.sendToUser(doctor._id, {
        title: urgent ? 'Urgent call request' : 'New doctor call request',
        body: 'Sign in to review this patient request.',
        url: '/doctor',
        tag: `call-${request._id}`,
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        severity: urgent ? 'high' : 'medium',
        resourceType: 'consultation_request',
        resourceId: request._id.toString(),
        hospitalId: hospital._id,
        requestId: req.id,
        metadata: { urgent, reportAttached: Boolean(screeningReportId) },
      });
      const details = await getVisibleRequest(request._id, req.user, environment);
      res.status(201).json({
        success: true,
        code: 'CALL_REQUEST_CREATED',
        message: 'Your request was sent to the doctor.',
        details,
      });
    }),
  );

  router.get(
    '/requests/:requestId',
    authorize('patient', 'doctor', 'specialist'),
    asyncHandler(async (req, res) => {
      if (!/^[a-f\d]{24}$/i.test(req.params.requestId)) {
        throw new ApiError(404, 'CALL_REQUEST_NOT_FOUND', 'Call request not found.');
      }
      res.json({
        success: true,
        details: await getVisibleRequest(req.params.requestId, req.user, environment),
      });
    }),
  );

  router.post(
    '/requests/:requestId/respond',
    authorize('doctor', 'specialist'),
    validateBody(responseSchema),
    asyncHandler(async (req, res) => {
      const existing = await ConsultationRequest.findOne({
        _id: req.params.requestId,
        doctorId: req.user.id,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      });
      if (!existing) throw new ApiError(409, 'CALL_REQUEST_NOT_PENDING', 'This request is no longer pending.');
      const now = new Date();
      if (req.body.action === 'suggest_time') {
        if (req.body.suggestedAt <= now || req.body.suggestedAt.getTime() > now.getTime() + 30 * 86400000) {
          throw new ApiError(400, 'INVALID_SUGGESTED_TIME', 'Choose a time within the next 30 days.');
        }
        existing.suggestedAt = req.body.suggestedAt;
      } else if (req.body.action === 'decline') {
        existing.status = 'declined';
        existing.declinedAt = now;
      } else {
        existing.status = 'accepted';
        existing.acceptedAt = now;
        existing.callRoomName = `call-${randomUUID()}`;
      }
      await existing.save();
      const patient = await Patient.findById(existing.patientId).select('userId').lean();
      const details = await getVisibleRequest(existing._id, req.user, environment);
      const update = {
        requestId: existing._id.toString(),
        status: existing.status,
        suggestedAt: existing.suggestedAt || null,
      };
      if (patient) {
        req.app.get('io')?.to(`user:${patient.userId}`).emit('consultation:request-updated', update);
        await req.app.get('pushService')?.sendToUser(patient.userId, {
          title: 'Doctor call request updated',
          body: 'Sign in to view the latest update.',
          url: '/patient/appointments',
          tag: `call-${existing._id}`,
        });
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        severity: 'medium',
        resourceType: 'consultation_request',
        resourceId: existing._id.toString(),
        hospitalId: existing.hospitalId,
        requestId: req.id,
        metadata: { event: req.body.action, status: existing.status },
      });
      res.json({ success: true, details });
    }),
  );

  router.post(
    '/requests/:requestId/accept-suggestion',
    authorize('patient'),
    asyncHandler(async (req, res) => {
      const request = await ConsultationRequest.findOne({
        _id: req.params.requestId,
        status: 'pending',
        suggestedAt: { $gt: new Date() },
      });
      if (!request) throw new ApiError(404, 'SUGGESTED_TIME_NOT_FOUND', 'There is no active suggested time.');
      const patient = await Patient.findOne({ _id: request.patientId, userId: req.user.id, active: true });
      if (!patient) throw new ApiError(403, 'CALL_REQUEST_ACCESS_DENIED', 'You are not a participant in this request.');
      request.suggestionAcceptedAt = new Date();
      await request.save();
      req.app.get('io')?.to(`user:${request.doctorId}`).emit('consultation:request-updated', {
        requestId: request._id.toString(),
        suggestionAcceptedAt: request.suggestionAcceptedAt,
      });
      res.json({ success: true, details: await getVisibleRequest(request._id, req.user, environment) });
    }),
  );

  router.post(
    '/requests/:requestId/token',
    authorize('patient', 'doctor', 'specialist'),
    asyncHandler(async (req, res) => {
      const request = await ConsultationRequest.findOne({
        _id: req.params.requestId,
        status: 'accepted',
      }).lean();
      if (!request || !request.callRoomName) {
        throw new ApiError(409, 'CALL_NOT_AVAILABLE', 'The doctor has not accepted this call request.');
      }
      const patient =
        req.user.role === 'patient'
          ? await Patient.findOne({ _id: request.patientId, userId: req.user.id, active: true })
              .select('_id')
              .lean()
          : null;
      const allowed =
        ['doctor', 'specialist'].includes(req.user.role)
          ? request.doctorId.toString() === req.user.id.toString()
          : Boolean(patient);
      if (!allowed) throw new ApiError(403, 'CALL_REQUEST_ACCESS_DENIED', 'You are not a participant in this call.');
      const activeTeleconsultationConsent = await Consent.findOne({
        patientId: request.patientId,
        consentType: 'teleconsultation',
      })
        .sort({ recordedAt: -1 })
        .lean();
      if (!isActiveConsent(activeTeleconsultationConsent)) {
        throw new ApiError(403, 'TELECONSULTATION_CONSENT_REQUIRED', 'Active call consent is required to join.');
      }

      const expiresInSeconds = 5 * 60;
      const roomToken = jwt.sign(
        {
          sub: req.user.id.toString(),
          role: req.user.role,
          requestId: request._id.toString(),
          room: request.callRoomName,
        },
        environment.JWT_ACCESS_SECRET,
        {
          expiresIn: expiresInSeconds,
          issuer: 'aarogya-drishti',
          audience: 'aarogya-consultation-room',
          algorithm: 'HS256',
        },
      );
      const iceServers = [];
      const stunUrls = environment.STUN_URLS.split(',').map((url) => url.trim()).filter(Boolean);
      if (stunUrls.length) iceServers.push({ urls: stunUrls });
      const turnUrls = environment.TURN_URLS.split(',').map((url) => url.trim()).filter(Boolean);
      if (turnUrls.length && environment.TURN_SHARED_SECRET) {
        const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
        const username = `${expiresAt}:${req.user.id}`;
        const credential = createHmac('sha1', environment.TURN_SHARED_SECRET)
          .update(username)
          .digest('base64');
        iceServers.push({ urls: turnUrls, username, credential });
      }
      res.json({
        success: true,
        details: {
          roomToken,
          expiresInSeconds,
          iceServers,
          recordingEnabled: false,
        },
      });
    }),
  );

  router.post(
    '/requests/:requestId/end',
    authorize('patient', 'doctor', 'specialist'),
    asyncHandler(async (req, res) => {
      const request = await ConsultationRequest.findById(req.params.requestId);
      if (!request || request.status !== 'accepted') {
        throw new ApiError(409, 'CALL_NOT_ACTIVE', 'This call is not active.');
      }
      const patient =
        req.user.role === 'patient'
          ? await Patient.exists({ _id: request.patientId, userId: req.user.id, active: true })
          : null;
      const isParticipant =
        (['doctor', 'specialist'].includes(req.user.role) &&
          request.doctorId.toString() === req.user.id.toString()) ||
        Boolean(patient);
      if (!isParticipant) throw new ApiError(403, 'CALL_REQUEST_ACCESS_DENIED', 'You are not a participant in this call.');
      const now = new Date();
      request.status = 'completed';
      request.callEndedAt = now;
      request.callDurationSeconds = request.callStartedAt
        ? Math.max(0, Math.floor((now.getTime() - request.callStartedAt.getTime()) / 1000))
        : 0;
      await request.save();
      const patientUser = await Patient.findById(request.patientId).select('userId').lean();
      const targetUserId =
        ['doctor', 'specialist'].includes(req.user.role) ? patientUser?.userId : request.doctorId;
      req.app.get('io')?.to(`consultation:${request._id}`).emit('consultation:call-ended', {
        endedAt: now,
      });
      req.app.get('io')?.in(`consultation:${request._id}`).socketsLeave(`consultation:${request._id}`);
      if (targetUserId) {
        req.app.get('io')?.to(`user:${targetUserId}`).emit('consultation:request-updated', {
          requestId: request._id.toString(),
          status: 'completed',
        });
        await req.app.get('pushService')?.sendToUser(targetUserId, {
          title: 'Video consultation completed',
          body: 'Sign in to review the consultation update.',
          url: ['doctor', 'specialist'].includes(req.user.role)
            ? '/patient/appointments'
            : '/doctor',
          tag: `call-${request._id}`,
        });
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        severity: 'medium',
        resourceType: 'teleconsultation_call',
        resourceId: request._id.toString(),
        hospitalId: request.hospitalId,
        requestId: req.id,
        metadata: {
          event: 'call_ended',
          durationSeconds: request.callDurationSeconds,
        },
      });
      res.json({ success: true, details: { status: request.status, endedAt: now } });
    }),
  );

  router.post(
    '/requests/:requestId/notes',
    authorize('doctor', 'specialist'),
    validateBody(noteSchema),
    asyncHandler(async (req, res) => {
      const request = await ConsultationRequest.findOne({
        _id: req.params.requestId,
        doctorId: req.user.id,
        status: { $in: ['accepted', 'completed'] },
      });
      if (!request) throw new ApiError(404, 'CALL_REQUEST_NOT_FOUND', 'Call request not found.');
      if (req.body.followUpDate && req.body.followUpDate <= new Date()) {
        throw new ApiError(400, 'INVALID_FOLLOW_UP_DATE', 'Choose a future follow-up date.');
      }
      const latest = await TeleconsultationNote.findOne({
        callRequestId: request._id,
      })
        .sort({ version: -1 })
        .select('_id version')
        .lean();
      const note = await TeleconsultationNote.create({
        callRequestId: request._id,
        patientId: request.patientId,
        doctorId: req.user.id,
        version: (latest?.version || 0) + 1,
        previousVersionId: latest?._id || null,
        body: req.body.body,
        signedAt: new Date(),
        releasedToPatient: true,
        releasedAt: new Date(),
      });
      const created = [];
      if (req.body.followUpDate) {
        created.push(
          await FollowUp.create({
            patientId: request.patientId,
            consultationRequestId: request._id,
            assignedTo: req.user.id,
            followUpDate: req.body.followUpDate,
            dueAt: req.body.followUpDate,
            instructions: req.body.followUpInstructions || '',
          }),
        );
      }
      if (req.body.referralReason) {
        created.push(
          await Referral.create({
            patientId: request.patientId,
            consultationRequestId: request._id,
            hospitalId: request.hospitalId,
            referredBy: req.user.id,
            reason: req.body.referralReason,
            urgency: request.urgent ? 'urgent' : 'routine',
            specialty: req.body.referralSpecialty || '',
            destinationName: req.body.referralDestination || '',
          }),
        );
      }
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        severity: 'medium',
        resourceType: 'consultation_note',
        resourceId: note._id.toString(),
        hospitalId: request.hospitalId,
        requestId: req.id,
        metadata: { releasedToPatient: true, followUpOrReferral: created.length > 0 },
      });
      const patient = await Patient.findById(request.patientId).select('userId').lean();
      if (patient) {
        req.app.get('io')?.to(`user:${patient.userId}`).emit('consultation:report-added', {
          requestId: request._id.toString(),
        });
        await req.app.get('pushService')?.sendToUser(patient.userId, {
          title: 'Consultation report available',
          body: 'Sign in to review your doctor’s consultation note.',
          url: '/patient',
          tag: `call-report-${request._id}`,
        });
      }
      res.status(201).json({
        success: true,
        details: {
          noteId: note._id,
          version: note.version,
          followUpCreated: Boolean(req.body.followUpDate),
          referralCreated: Boolean(req.body.referralReason),
        },
      });
    }),
  );

  return router;
}
