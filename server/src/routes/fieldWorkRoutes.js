import { createHmac, randomBytes } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import {
  Consent,
  CareAssignment,
  FieldRegistration,
  Investigation,
  NavigatorActivity,
  Notification,
  PatientPasswordActivation,
  Patient,
  Referral,
  User,
} from '../models/index.js';
import { decryptField, encryptField } from '../services/fieldEncryption.js';
import { writeAuditLog } from '../services/auditService.js';
import { createPrivateStorageService } from '../services/privateStorageService.js';
import { hashToken } from '../services/authCrypto.js';
import { ApiError } from '../utils/apiError.js';
import { mobileSchema } from '../validators/authValidators.js';

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('file');
const PATIENT_ACTIVATION_TTL_MS = 30 * 60 * 1000;

const text = (max) => z.string().trim().min(1).max(max);
const symptomKeys = [
  'white_patch',
  'red_patch',
  'non_healing_ulcer',
  'growth_or_lump',
  'difficulty_opening_mouth',
  'difficulty_swallowing',
  'pain_chewing',
  'bleeding',
  'persistent_pain_or_numbness',
  'voice_change_or_neck_lump',
];
const registrationSchema = z.object({
  clientOpId: z.string().uuid().optional(),
  fullName: text(120),
  phone: mobileSchema.optional(),
  dateOfBirth: z.string().trim().max(20).optional(),
  sexAtBirth: z.enum(['female', 'male', 'intersex', 'undisclosed']).default('undisclosed'),
  language: z.enum(['en', 'te']),
  village: text(120),
  mandal: text(120),
  phc: text(120),
  district: text(120),
  tobacco: z.object({
    type: z.enum(['smoked', 'smokeless', 'both', 'none', 'unknown']),
    frequency: z.string().trim().max(100).optional(),
    duration: z.string().trim().max(100).optional(),
  }).strict(),
  arecaNut: z.object({
    uses: z.boolean(),
    frequency: z.string().trim().max(100).optional(),
    duration: z.string().trim().max(100).optional(),
  }).strict(),
  symptoms: z.array(z.enum(symptomKeys)).max(symptomKeys.length),
  consents: z.object({
    screening: z.literal(true),
    imaging: z.boolean(),
    data_sharing: z.boolean(),
  }).strict(),
}).strict();

const activitySchema = z.object({
  type: z.enum(['contact_attempt', 'transport_request', 'missed_visit']),
  outcome: z.string().trim().min(1).max(80),
  details: z.string().trim().max(2000).optional(),
}).strict().refine(
  (activity) => activity.type === 'contact_attempt' || Boolean(activity.details?.trim()),
  'Provide a reason or details for a transport request or missed visit.',
);

const investigationCreateSchema = z.object({
  patientId: z.string().regex(/^[a-f\d]{24}$/i),
  referralId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  dueAt: z.coerce.date().optional(),
}).strict();

const investigationStateSchema = z.object({
  state: z.enum([
    'advised',
    'scheduled',
    'sample_collected',
    'report_pending',
    'report_received',
    'clinician_reviewed',
    'next_action',
  ]),
}).strict();

function hmacDuplicateKey(parts, secret) {
  return createHmac('sha256', secret).update(parts.map((part) => String(part ?? '').trim().toLowerCase()).join('|')).digest('hex');
}

export function catchmentFilter(user) {
  if (!user.district) throw new ApiError(403, 'CATCHMENT_NOT_ASSIGNED', 'Your account has no assigned district catchment.');
  if (!Array.isArray(user.assignedVillages) || user.assignedVillages.length === 0) {
    throw new ApiError(403, 'VILLAGES_NOT_ASSIGNED', 'Your account has no assigned villages. Contact an administrator.');
  }
  const filter = { district: user.district };
  if (user.mandal) filter.mandal = user.mandal;
  if (user.phc) filter.phc = user.phc;
  filter.village = { $in: user.assignedVillages };
  return filter;
}

function csvCell(value) {
  const textValue = value == null ? '' : String(value);
  const safeValue = /^[=+\-@\t\r]/.test(textValue) ? `'${textValue}` : textValue;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

function safeCount(value) {
  return value < 5 ? null : value;
}

function parseGroupBy(value) {
  const parsed = z.enum(['village', 'phc', 'mandal']).safeParse(value ?? 'village');
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Choose village, PHC, or mandal grouping.');
  return parsed.data;
}

export function formatDistrictRows(rows) {
  const visible = [];
  let hasSuppressed = false;
  for (const row of rows) {
    if (row.registered < 5) {
      hasSuppressed = true;
      continue;
    }
    visible.push({
      area: typeof row._id === 'string' ? row._id : null,
      suppressed: false,
      registered: safeCount(row.registered),
      screened: safeCount(row.screened),
      referred: safeCount(row.referred),
      investigation: safeCount(row.investigation),
    });
  }
  if (hasSuppressed) {
    visible.push({
      area: null,
      suppressed: true,
      registered: null,
      screened: null,
      referred: null,
      investigation: null,
    });
  }
  return visible;
}

function districtAggregatePipeline(district, groupBy) {
  const stages = ['screening_sessions', 'referrals', 'investigations'].map((collection, index) => {
    const alias = ['screenings', 'referrals', 'investigations'][index];
    return {
      $lookup: {
        from: collection,
        let: { patient: '$patientId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$patientId', '$$patient'] } } },
          { $project: { _id: 1 } },
          { $limit: 1 },
        ],
        as: alias,
      },
    };
  });
  return [
    { $match: { district } },
    ...stages,
    {
      $group: {
        _id: `$${groupBy}`,
        registered: { $sum: 1 },
        screened: { $sum: { $cond: [{ $gt: [{ $size: '$screenings' }, 0] }, 1, 0] } },
        referred: { $sum: { $cond: [{ $gt: [{ $size: '$referrals' }, 0] }, 1, 0] } },
        investigation: { $sum: { $cond: [{ $gt: [{ $size: '$investigations' }, 0] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 100 },
  ];
}

async function createRegistration(req, environment) {
  const input = registrationSchema.parse(req.body);
  if (!req.user.district ||
      input.district !== req.user.district ||
      (req.user.mandal && input.mandal !== req.user.mandal) ||
      (req.user.phc && input.phc !== req.user.phc) ||
      !req.user.assignedVillages?.includes(input.village)) {
    throw new ApiError(403, 'CATCHMENT_SCOPE_FORBIDDEN', 'Registration location must match your assigned catchment.');
  }
  const secret = environment.DATA_ENCRYPTION_KEY || environment.JWT_ACCESS_SECRET;
  const duplicateHash = hmacDuplicateKey(
    [input.fullName, input.dateOfBirth, input.phone, input.village, input.mandal],
    secret,
  );
  if (input.clientOpId) {
    const priorOperation = await FieldRegistration.findOne({ clientOpId: input.clientOpId })
      .select('registeredBy _id patientId')
      .lean();
    if (priorOperation) {
      if (priorOperation.registeredBy.toString() !== req.user.id.toString()) {
        throw new ApiError(409, 'SYNC_OPERATION_CONFLICT', 'That offline operation ID has already been used.');
      }
      return {
        registrationId: priorOperation._id,
        patientId: priorOperation.patientId,
        idempotent: true,
      };
    }
  }
  const existing = await FieldRegistration.findOne({ duplicateHash }).select('_id').lean();
  if (existing) throw new ApiError(409, 'POSSIBLE_DUPLICATE_PATIENT', 'A similar registration already exists. Review it before registering again.');

  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const patientUser = await User.create([{
        fullName: input.fullName,
        phone: input.phone || undefined,
        role: 'patient',
        status: 'active',
      }], { session });
      const patient = await Patient.create([{
        userId: patientUser[0]._id,
        dateOfBirth: input.dateOfBirth ? encryptField(input.dateOfBirth, secret) : undefined,
        sexAtBirth: encryptField(input.sexAtBirth, secret),
        district: encryptField(input.district, secret),
        village: encryptField(input.village, secret),
        mandal: encryptField(input.mandal, secret),
        phc: encryptField(input.phc, secret),
        preferredLanguage: input.language,
      }], { session });

      const consentTypes = ['screening', 'imaging', 'data_sharing'];
      const consents = await Consent.create(consentTypes.map((consentType) => ({
        patientId: patient[0]._id,
        consentType,
        consentVersion: 'phase14-v1',
        textVersion: `phase14.${consentType}.v1`,
        language: input.language,
        granted: input.consents[consentType],
        recordedAt: new Date(),
        recordedBy: req.user.id,
      })), { session });

      const registration = await FieldRegistration.create([{
        patientId: patient[0]._id,
        registeredBy: req.user.id,
        duplicateHash,
        clientOpId: input.clientOpId,
        village: input.village,
        mandal: input.mandal,
        phc: input.phc,
        district: input.district,
        encryptedHealthData: encryptField(JSON.stringify({
          tobacco: input.tobacco,
          arecaNut: input.arecaNut,
          symptoms: input.symptoms,
        }), secret),
        consentIds: consents.map((consent) => consent._id),
      }], { session });
      response = {
        registrationId: registration[0]._id,
        patientId: patient[0]._id,
        consentsRecorded: consentTypes.length,
      };
    });

    await writeAuditLog({
      actorId: req.user.id,
      action: 'create',
      resourceType: 'field_registration',
      resourceId: response.registrationId.toString(),
      requestId: req.id,
      metadata: { consentTypes: ['screening', 'imaging', 'data_sharing'] },
    });
    return response;
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(409, 'POSSIBLE_DUPLICATE_PATIENT', 'A similar registration already exists. Review it before registering again.');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function registerFieldPatient({ payload, user, requestId, environment }) {
  return createRegistration({ body: payload, user, id: requestId }, environment);
}

export function createFieldWorkRoutes(environment) {
  const router = Router();
  const storage = createPrivateStorageService(environment);
  router.use(authenticate(environment));

  router.post(
    '/registrations',
    authorize('health_worker'),
    asyncHandler(async (req, res) => {
      const result = await createRegistration(req, environment);
      res.status(201).json({ success: true, code: 'FIELD_REGISTRATION_CREATED', details: result });
    }),
  );

  router.post(
    '/registrations/:registrationId/patient-password-activation',
    authorize('health_worker'),
    asyncHandler(async (req, res) => {
      const registrationId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.registrationId);
      if (!registrationId.success) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a valid patient registration.');
      }
      const registration = await FieldRegistration.findOne({
        _id: registrationId.data,
        registeredBy: req.user.id,
      }).select('patientId').lean();
      const patient = registration
        ? await Patient.findById(registration.patientId).select('userId').lean()
        : null;
      const patientUser = patient
        ? await User.findOne({ _id: patient.userId, role: 'patient', status: 'active' })
            .select('phone email')
            .lean()
        : null;
      if (!patientUser) {
        throw new ApiError(404, 'REGISTRATION_NOT_FOUND', 'Patient registration was not found.');
      }
      if (!patientUser.phone && !patientUser.email) {
        throw new ApiError(
          409,
          'PATIENT_LOGIN_IDENTIFIER_REQUIRED',
          'Add a patient phone number or email before issuing an activation code.',
        );
      }

      const now = new Date();
      const activationCode = randomBytes(16).toString('base64url');
      await PatientPasswordActivation.updateMany(
        { userId: patientUser._id, consumedAt: null },
        { $set: { consumedAt: now } },
      );
      const activation = await PatientPasswordActivation.create({
        userId: patientUser._id,
        issuedBy: req.user.id,
        tokenHash: hashToken(activationCode),
        expiresAt: new Date(now.getTime() + PATIENT_ACTIVATION_TTL_MS),
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'patient_password_activation',
        resourceId: activation._id.toString(),
        requestId: req.id,
        metadata: { patientId: registration.patientId.toString() },
      });
      res.status(201).json({
        success: true,
        code: 'PATIENT_PASSWORD_ACTIVATION_CREATED',
        details: {
          activationCode,
          expiresAt: activation.expiresAt,
        },
      });
    }),
  );

  router.get(
    '/registrations',
    authorize('health_worker'),
    asyncHandler(async (req, res) => {
      const records = await FieldRegistration.find({ registeredBy: req.user.id })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('+encryptedHealthData')
        .lean();
      const secret = environment.DATA_ENCRYPTION_KEY || environment.JWT_ACCESS_SECRET;
      res.json({
        success: true,
        details: records.map((record) => ({
          id: record._id,
          village: record.village,
          mandal: record.mandal,
          phc: record.phc,
          createdAt: record.createdAt,
          healthData: JSON.parse(decryptField(record.encryptedHealthData, secret)),
          photoViews: record.photos.map((photo) => photo.view),
        })),
      });
    }),
  );

  router.post(
    '/registrations/:registrationId/photos/:view',
    authorize('health_worker'),
    (req, res, next) => imageUpload(req, res, (error) => {
      if (error) return next(error);
      return next();
    }),
    asyncHandler(async (req, res) => {
      const view = z.enum(['front', 'left_cheek', 'right_cheek', 'upper_gums', 'lower_gums']).safeParse(req.params.view);
      if (!view.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Choose one of the five guided photo views.');
      if (!mongoose.isValidObjectId(req.params.registrationId)) {
        throw new ApiError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found.');
      }
      const registration = await FieldRegistration.findOne({
        _id: req.params.registrationId,
        registeredBy: req.user.id,
      }).select('patientId consentIds photos');
      if (!registration) throw new ApiError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found.');
      if (registration.photos.some((photo) => photo.view === view.data)) {
        throw new ApiError(409, 'PHOTO_VIEW_ALREADY_CAPTURED', 'That guided photo view is already saved.');
      }
      const imagingConsent = await Consent.exists({
        _id: { $in: registration.consentIds },
        consentType: 'imaging',
        granted: true,
        withdrawnAt: null,
      });
      if (!imagingConsent) throw new ApiError(403, 'IMAGING_CONSENT_REQUIRED', 'Active photo consent is required.');
      const file = await storage.storeFieldPhoto({
        patientId: registration.patientId,
        registrationId: registration._id,
        view: view.data,
        file: req.file,
      });
      registration.photos = registration.photos.filter((photo) => photo.view !== view.data);
      registration.photos.push({ view: view.data, ...file });
      await registration.save();
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'field_registration_photo',
        resourceId: registration._id.toString(),
        requestId: req.id,
        metadata: { view: view.data },
      });
      res.status(201).json({ success: true, details: { view: view.data, uploaded: true } });
    }),
  );

  router.get(
    '/navigator/queue',
    authorize('navigator'),
    asyncHandler(async (req, res) => {
      const filter = catchmentFilter(req.user);
      const scopeTerms = Object.entries(filter).map(([field, value]) => ({ [`registration.${field}`]: value }));
      const [referrals, investigations] = await Promise.all([
        Referral.aggregate([
          { $match: { status: 'open' } },
          { $lookup: {
            from: 'field_registrations',
            localField: 'patientId',
            foreignField: 'patientId',
            as: 'registration',
          } },
          { $match: { $and: scopeTerms } },
          { $lookup: {
            from: 'patients',
            localField: 'patientId',
            foreignField: '_id',
            as: 'patient',
          } },
          { $lookup: {
            from: 'users',
            localField: 'patient.userId',
            foreignField: '_id',
            as: 'patientUser',
          } },
          { $project: {
            _id: 1,
            hospitalId: 1,
            urgency: 1,
            status: 1,
            createdAt: 1,
            patientName: { $arrayElemAt: ['$patientUser.fullName', 0] },
            patientPhone: { $arrayElemAt: ['$patientUser.phone', 0] },
          } },
          { $sort: { createdAt: 1 } },
          { $limit: 50 },
        ]),
        Investigation.find({
          ...filter,
          state: { $nin: ['clinician_reviewed', 'next_action'] },
        })
          .sort({ dueAt: 1, createdAt: 1 }).limit(50)
          .select('_id referralId state dueAt createdAt').lean(),
      ]);
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'navigator_queue',
        requestId: req.id,
        metadata: { referralCount: referrals.length, investigationCount: investigations.length },
      });
      res.json({ success: true, details: { referrals, investigations } });
    }),
  );

  router.post(
    '/navigator/referrals/:referralId/activities',
    authorize('navigator'),
    validateBody(activitySchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.referralId)) throw new ApiError(404, 'REFERRAL_NOT_FOUND', 'Referral not found.');
      const referral = await Referral.findOne({ _id: req.params.referralId }).select('_id patientId');
      if (!referral || !(await FieldRegistration.exists({
        patientId: referral.patientId,
        ...catchmentFilter(req.user),
      }))) {
        throw new ApiError(404, 'REFERRAL_NOT_FOUND', 'Referral not found in your catchment.');
      }
      const activity = await NavigatorActivity.create({
        patientId: referral.patientId,
        referralId: referral._id,
        navigatorId: req.user.id,
        type: req.body.type,
        outcome: req.body.outcome,
        encryptedDetails: encryptField(req.body.details, environment.DATA_ENCRYPTION_KEY || environment.JWT_ACCESS_SECRET),
      });
      await writeAuditLog({
        actorId: req.user.id,
        action: 'create',
        resourceType: 'navigator_activity',
        resourceId: activity._id.toString(),
        requestId: req.id,
        metadata: { type: activity.type },
      });
      res.status(201).json({ success: true, details: { id: activity._id, type: activity.type, outcome: activity.outcome } });
    }),
  );

  router.post(
    '/investigations',
    authorize('doctor', 'specialist'),
    validateBody(investigationCreateSchema),
    asyncHandler(async (req, res) => {
      const patient = await Patient.findOne({ _id: req.body.patientId, active: true }).select('_id');
      if (!patient) throw new ApiError(404, 'PATIENT_NOT_FOUND', 'Patient not found.');
      const assignment = await CareAssignment.exists({
        patientId: patient._id,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment) throw new ApiError(403, 'CARE_RELATIONSHIP_REQUIRED', 'You are not assigned to this patient.');
      if (req.body.referralId && !(await Referral.exists({ _id: req.body.referralId, patientId: patient._id }))) {
        throw new ApiError(404, 'REFERRAL_NOT_FOUND', 'The referral does not belong to this patient.');
      }
      const location = await FieldRegistration.findOne({ patientId: patient._id })
        .sort({ createdAt: -1 })
        .select('district village mandal phc');
      const investigation = await Investigation.create({
        patientId: patient._id,
        referralId: req.body.referralId,
        district: location?.district,
        village: location?.village,
        mandal: location?.mandal,
        phc: location?.phc,
        state: 'advised',
        dueAt: req.body.dueAt,
        createdBy: req.user.id,
      });
      res.status(201).json({ success: true, details: { id: investigation._id, state: investigation.state } });
    }),
  );

  router.patch(
    '/investigations/:investigationId/state',
    authorize('navigator', 'doctor'),
    validateBody(investigationStateSchema),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.investigationId)) throw new ApiError(404, 'INVESTIGATION_NOT_FOUND', 'Investigation not found.');
      if (
        ['clinician_reviewed', 'next_action'].includes(req.body.state) &&
        !['doctor', 'specialist'].includes(req.user.role)
      ) {
        throw new ApiError(403, 'CLINICIAN_REQUIRED', 'Only a clinician can set that investigation state.');
      }
      const query = { _id: req.params.investigationId };
      if (req.user.role === 'navigator') Object.assign(query, catchmentFilter(req.user));
      const investigation = await Investigation.findOne(query);
      if (!investigation) throw new ApiError(404, 'INVESTIGATION_NOT_FOUND', 'Investigation not found in your scope.');
      if (['doctor', 'specialist'].includes(req.user.role) && !(await CareAssignment.exists({
        patientId: investigation.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      }))) {
        throw new ApiError(403, 'CARE_RELATIONSHIP_REQUIRED', 'You are not assigned to this patient.');
      }
      const transitions = {
        advised: ['scheduled'],
        scheduled: ['sample_collected'],
        sample_collected: ['report_pending'],
        report_pending: ['report_received'],
        report_received: ['clinician_reviewed'],
        clinician_reviewed: ['next_action'],
        next_action: [],
      };
      if (!transitions[investigation.state].includes(req.body.state)) {
        throw new ApiError(409, 'INVESTIGATION_STATE_CONFLICT', 'That investigation status transition is not allowed.');
      }
      investigation.state = req.body.state;
      await investigation.save();
      res.json({ success: true, details: { id: investigation._id, state: investigation.state } });
    }),
  );

  router.patch(
    '/investigations/:investigationId/classification',
    authorize('doctor', 'specialist'),
    validateBody(z.object({ classification: text(120) }).strict()),
    asyncHandler(async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.investigationId)) {
        throw new ApiError(404, 'INVESTIGATION_NOT_FOUND', 'Investigation not found.');
      }
      const investigation = await Investigation.findById(req.params.investigationId);
      if (!investigation) throw new ApiError(404, 'INVESTIGATION_NOT_FOUND', 'Investigation not found.');
      const assignment = await CareAssignment.exists({
        patientId: investigation.patientId,
        assignedTo: req.user.id,
        hospitalId: req.user.hospitalId,
        status: 'active',
      });
      if (!assignment) throw new ApiError(403, 'CARE_RELATIONSHIP_REQUIRED', 'You are not assigned to this patient.');
      if (investigation.state !== 'report_received') {
        throw new ApiError(409, 'INVESTIGATION_STATE_CONFLICT', 'Classification can be recorded after a report is received.');
      }
      investigation.classification = req.body.classification;
      investigation.classificationSetBy = req.user.id;
      investigation.classificationSetAt = new Date();
      investigation.state = 'clinician_reviewed';
      await investigation.save();
      await writeAuditLog({
        actorId: req.user.id,
        action: 'edit',
        resourceType: 'investigation_classification',
        resourceId: investigation._id.toString(),
        requestId: req.id,
      });
      res.json({ success: true, details: { id: investigation._id, state: investigation.state } });
    }),
  );

  router.get(
    '/district/dashboard',
    authorize('district_officer'),
    asyncHandler(async (req, res) => {
      if (!req.user.district) throw new ApiError(403, 'CATCHMENT_NOT_ASSIGNED', 'Your account has no assigned district.');
      const groupBy = parseGroupBy(req.query.groupBy);
      const rows = await FieldRegistration.aggregate(districtAggregatePipeline(req.user.district, groupBy));
      await writeAuditLog({
        actorId: req.user.id,
        action: 'read',
        resourceType: 'district_aggregate_dashboard',
        requestId: req.id,
        metadata: { groupBy },
      });
      const safeRows = formatDistrictRows(rows);
      res.json({ success: true, details: { groupBy, rows: safeRows } });
    }),
  );

  router.get(
    '/district/dashboard/export',
    authorize('district_officer'),
    asyncHandler(async (req, res) => {
      if (!req.user.district) throw new ApiError(403, 'CATCHMENT_NOT_ASSIGNED', 'Your account has no assigned district.');
      const groupBy = parseGroupBy(req.query.groupBy);
      const rows = await FieldRegistration.aggregate(districtAggregatePipeline(req.user.district, groupBy));
      await writeAuditLog({
        actorId: req.user.id,
        action: 'export',
        resourceType: 'district_aggregate_csv',
        requestId: req.id,
        metadata: { groupBy, rowCount: rows.length },
      });
      const csvRows = [['area', 'registered', 'screened', 'referred', 'investigation', 'suppressed']];
      for (const row of formatDistrictRows(rows)) {
        csvRows.push(row.suppressed
          ? ['', '', '', '', '', 'true']
          : [row.area, row.registered, row.screened ?? '', row.referred ?? '', row.investigation ?? '', 'false']);
      }
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="district-aggregates.csv"');
      res.send(csvRows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
    }),
  );

  return router;
}

export async function escalateOverdueInvestigations({
  investigationModel = Investigation,
  notificationModel = Notification,
  now = new Date(),
  limit = 50,
} = {}) {
  const escalated = [];
  for (let count = 0; count < limit; count += 1) {
    const investigation = await investigationModel.findOne({
        dueAt: { $lte: now },
        escalatedAt: null,
        state: { $nin: ['clinician_reviewed', 'next_action'] },
      }).sort({ dueAt: 1 }).lean();
    if (!investigation) break;
    try {
      await notificationModel.create({
        userId: investigation.createdBy,
        type: 'investigation_escalation',
        titleKey: 'notification.investigationEscalation.title',
        bodyKey: 'notification.investigationEscalation.body',
        channel: 'in_app',
        templateKey: 'investigation_escalation',
        resourceType: 'investigation',
        resourceId: investigation._id,
        metadata: { investigationId: investigation._id.toString() },
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const claim = await investigationModel.updateOne(
      { _id: investigation._id, escalatedAt: null },
      { $set: { escalatedAt: now } },
    );
    if (claim.modifiedCount > 0) escalated.push(investigation._id);
  }
  return escalated;
}
