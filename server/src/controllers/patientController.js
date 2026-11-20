import { z } from 'zod';
import {
  Consent,
  Patient,
  Questionnaire,
  QuestionnaireResponse,
  ScreeningSession,
  User,
} from '../models/index.js';
import { writeAuditLog } from '../services/auditService.js';
import { ApiError } from '../utils/apiError.js';
import { decryptField, encryptField } from '../services/fieldEncryption.js';

const patientProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  dateOfBirth: z.coerce.date().optional(),
  sexAtBirth: z.enum(['female', 'male', 'intersex', 'undisclosed']).optional(),
  district: z.string().trim().max(100).optional(),
  preferredLanguage: z.enum(['en', 'te']).optional(),
});

const consentSchema = z.object({
  consentType: z.enum([
    'screening',
    'imaging',
    'ai_processing',
    'teleconsultation',
    'data_sharing',
  ]),
  textVersion: z.string().trim().min(1).max(80),
  language: z.enum(['en', 'te']),
  granted: z.boolean().default(true),
  recordedAt: z.coerce.date().optional(),
  screeningSessionId: z.string().trim().optional(),
});

const questionnaireResponseSchema = z.object({
  questionnaireVersion: z.string().trim().min(1).max(40).optional(),
  screeningSessionId: z.string().trim().optional(),
  answers: z
    .array(
      z.object({
        questionKey: z.string().trim().min(1).max(100),
        answer: z.any(),
        skipped: z.boolean().default(false),
      }),
    )
    .default([]),
});

const defaultQuestionnaire = {
  key: 'oral-screening',
  activeVersion: 'v1',
  versions: [
    {
      version: 'v1',
      createdAt: new Date(),
      questions: [
        {
          key: 'age',
          section: 'demographics',
          input: 'number',
          labelKey: 'question.age',
          sensitive: true,
          reasonKey: 'question.reason.age',
          allowsSkip: true,
          min: 0,
          max: 120,
        },
        {
          key: 'gender',
          section: 'demographics',
          input: 'select',
          labelKey: 'question.gender',
          sensitive: true,
          reasonKey: 'question.reason.gender',
          allowsSkip: true,
          options: [
            { value: 'female', labelKey: 'option.gender.female' },
            { value: 'male', labelKey: 'option.gender.male' },
            { value: 'intersex', labelKey: 'option.gender.intersex' },
            { value: 'undisclosed', labelKey: 'option.gender.undisclosed' },
          ],
        },
        {
          key: 'location',
          section: 'demographics',
          input: 'text',
          labelKey: 'question.location',
          sensitive: true,
          reasonKey: 'question.reason.location',
          allowsSkip: true,
        },
        {
          key: 'history',
          section: 'history',
          input: 'textarea',
          labelKey: 'question.history',
          sensitive: true,
          reasonKey: 'question.reason.history',
          allowsSkip: true,
        },
        {
          key: 'family_history',
          section: 'history',
          input: 'boolean',
          labelKey: 'question.family_history',
          sensitive: true,
          reasonKey: 'question.reason.family_history',
          allowsSkip: true,
        },
        {
          key: 'tobacco_type',
          section: 'habits',
          input: 'select',
          labelKey: 'question.tobacco.type',
          sensitive: true,
          reasonKey: 'question.reason.tobacco',
          allowsSkip: true,
          options: [
            { value: 'none', labelKey: 'option.tobacco.none' },
            { value: 'smoked', labelKey: 'option.tobacco.smoked' },
            { value: 'chewed', labelKey: 'option.tobacco.chewed' },
            { value: 'both', labelKey: 'option.tobacco.both' },
          ],
        },
        {
          key: 'tobacco_frequency',
          section: 'habits',
          input: 'select',
          labelKey: 'question.tobacco.frequency',
          sensitive: true,
          reasonKey: 'question.reason.tobacco',
          allowsSkip: true,
          options: [
            { value: 'daily', labelKey: 'option.frequency.daily' },
            { value: 'weekly', labelKey: 'option.frequency.weekly' },
            { value: 'monthly', labelKey: 'option.frequency.monthly' },
            { value: 'rarely', labelKey: 'option.frequency.rarely' },
          ],
        },
        {
          key: 'tobacco_duration',
          section: 'habits',
          input: 'select',
          labelKey: 'question.tobacco.duration',
          sensitive: true,
          reasonKey: 'question.reason.tobacco',
          allowsSkip: true,
          options: [
            { value: 'less_than_1_year', labelKey: 'option.duration.less_than_1_year' },
            { value: '1_3_years', labelKey: 'option.duration.1_3_years' },
            { value: '3_5_years', labelKey: 'option.duration.3_5_years' },
            { value: 'more_than_5_years', labelKey: 'option.duration.more_than_5_years' },
          ],
        },
        {
          key: 'alcohol',
          section: 'habits',
          input: 'boolean',
          labelKey: 'question.alcohol',
          sensitive: true,
          reasonKey: 'question.reason.alcohol',
          allowsSkip: true,
        },
        {
          key: 'betel_nut',
          section: 'habits',
          input: 'boolean',
          labelKey: 'question.betel_nut',
          sensitive: true,
          reasonKey: 'question.reason.betel_nut',
          allowsSkip: true,
        },
        {
          key: 'symptoms',
          section: 'symptoms',
          input: 'multi_select',
          labelKey: 'question.symptoms',
          sensitive: true,
          reasonKey: 'question.reason.symptoms',
          allowsSkip: true,
          options: [
            { value: 'white_patch', labelKey: 'option.symptom.white_patch' },
            { value: 'red_patch', labelKey: 'option.symptom.red_patch' },
            { value: 'non_healing_ulcer', labelKey: 'option.symptom.non_healing_ulcer' },
            { value: 'growth_or_lump', labelKey: 'option.symptom.growth_or_lump' },
            {
              value: 'difficulty_opening_mouth',
              labelKey: 'option.symptom.difficulty_opening_mouth',
            },
            {
              value: 'difficulty_breathing',
              labelKey: 'option.symptom.difficulty_breathing',
            },
            { value: 'difficulty_swallowing', labelKey: 'option.symptom.difficulty_swallowing' },
            { value: 'pain_chewing', labelKey: 'option.symptom.pain_chewing' },
            { value: 'bleeding', labelKey: 'option.symptom.bleeding' },
            {
              value: 'persistent_pain_or_numbness',
              labelKey: 'option.symptom.persistent_pain_or_numbness',
            },
            {
              value: 'voice_change_or_neck_lump',
              labelKey: 'option.symptom.voice_change_or_neck_lump',
            },
          ],
        },
        {
          key: 'symptom_duration',
          section: 'symptoms',
          input: 'select',
          labelKey: 'question.symptom_duration',
          sensitive: true,
          reasonKey: 'question.reason.symptoms',
          allowsSkip: true,
          options: [
            { value: 'lt_1_week', labelKey: 'option.duration.lt_1_week' },
            { value: '1_2_weeks', labelKey: 'option.duration.1_2_weeks' },
            { value: '2_4_weeks', labelKey: 'option.duration.2_4_weeks' },
            { value: '1_3_months', labelKey: 'option.duration.1_3_months' },
            { value: 'gt_3_months', labelKey: 'option.duration.gt_3_months' },
          ],
        },
        {
          key: 'free_text',
          section: 'notes',
          input: 'textarea',
          labelKey: 'question.free_text',
          sensitive: true,
          reasonKey: 'question.reason.history',
          allowsSkip: true,
        },
      ],
    },
  ],
};

async function ensureQuestionnaire() {
  const existing = await Questionnaire.findOne({ key: defaultQuestionnaire.key });
  if (existing) {
    const active = existing.versions.find((item) => item.version === existing.activeVersion);
    const familyHistoryQuestion = defaultQuestionnaire.versions[0].questions.find(
      (question) => question.key === 'family_history',
    );
    if (active && !active.questions.some((question) => question.key === 'family_history')) {
      const version = `${active.version}-risk-v2`.slice(0, 40);
      await Questionnaire.updateOne(
        {
          _id: existing._id,
          activeVersion: active.version,
          'versions.version': { $ne: version },
        },
        {
          $push: {
            versions: {
              version,
              questions: [...active.questions, familyHistoryQuestion],
              createdAt: new Date(),
            },
          },
          $set: { activeVersion: version },
        },
      );
    }
    return (await Questionnaire.findById(existing._id).lean()) || existing.toObject();
  }

  const created = await Questionnaire.create({
    key: defaultQuestionnaire.key,
    activeVersion: defaultQuestionnaire.activeVersion,
    versions: defaultQuestionnaire.versions,
  });
  return created.toObject();
}

function serializePatient(patient, account) {
  const dateOfBirth = decryptField(patient.dateOfBirth);
  const sexAtBirth = decryptField(patient.sexAtBirth);
  const district = decryptField(patient.district);
  return {
    id: patient._id,
    fullName: account?.fullName ?? null,
    phone: account?.phone ?? null,
    email: account?.email ?? null,
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth).toISOString() : null,
    sexAtBirth: sexAtBirth ?? null,
    district: district ?? null,
    preferredLanguage: patient.preferredLanguage,
    active: patient.active,
  };
}

export async function getPatient(req, res) {
  const patient = await Patient.findOne({ _id: req.authorizedPatient._id, active: true }).lean();
  if (!patient) {
    throw new Error('patient not found');
  }
  const account = await User.findById(patient.userId).select('fullName phone email').lean();
  await writeAuditLog({
    actorId: req.user.id,
    action: 'read',
    resourceType: 'patient',
    resourceId: patient._id.toString(),
    hospitalId: req.user.hospitalId,
    requestId: req.id,
  });
  res.json({
    success: true,
    code: 'PATIENT_PROFILE',
    message: 'Patient profile is ready.',
    details: serializePatient(patient, account),
  });
}

export async function updatePatient(req, res) {
  const sanitized = patientProfileSchema.parse(req.body);
  const patient = await Patient.findOne({ _id: req.authorizedPatient._id, active: true });
  if (!patient) {
    return res.status(404).json({
      success: false,
      code: 'PATIENT_NOT_FOUND',
      message: 'That patient record was not found.',
      details: null,
    });
  }

  if (sanitized.fullName) {
    await User.findByIdAndUpdate(patient.userId, { fullName: sanitized.fullName }, { new: true });
    delete sanitized.fullName;
  }

  const updates = Object.fromEntries(
    Object.entries(sanitized).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(updates).length > 0) {
    if (updates.dateOfBirth) updates.dateOfBirth = encryptField(updates.dateOfBirth.toISOString());
    if (updates.sexAtBirth) updates.sexAtBirth = encryptField(updates.sexAtBirth);
    if (updates.district) updates.district = encryptField(updates.district);
    Object.assign(patient, updates);
    await patient.save();
  }

  const account = await User.findById(patient.userId).select('fullName phone email').lean();

  await writeAuditLog({
    actorId: req.user.id,
    action: 'update',
    resourceType: 'patient',
    resourceId: patient._id.toString(),
    hospitalId: req.user.hospitalId,
    requestId: req.id,
  });

  res.json({
    success: true,
    code: 'PATIENT_PROFILE_UPDATED',
    message: 'Patient profile was updated successfully.',
    details: serializePatient(patient, account),
  });
}

export async function listPatientConsents(req, res) {
  const consents = await Consent.find({ patientId: req.authorizedPatient._id })
    .sort({ recordedAt: -1 })
    .limit(50)
    .lean();
  res.json({
    success: true,
    code: 'PATIENT_CONSENTS',
    message: 'Patient consent records are ready.',
    details: consents,
  });
}

export async function createConsent(req, res) {
  const payload = consentSchema.parse(req.body);
  const consent = await Consent.create({
    patientId: req.authorizedPatient._id,
    screeningSessionId: payload.screeningSessionId || req.query.screeningSessionId || null,
    consentType: payload.consentType,
    consentVersion: payload.textVersion,
    textVersion: payload.textVersion,
    language: payload.language,
    granted: payload.granted,
    recordedAt: payload.recordedAt || new Date(),
    recordedBy: req.user.id,
    withdrawnAt: payload.granted ? null : new Date(),
  });

  await writeAuditLog({
    actorId: req.user.id,
    action: 'create',
    resourceType: 'consent',
    resourceId: consent._id.toString(),
    hospitalId: req.user.hospitalId,
    requestId: req.id,
    metadata: { consentType: payload.consentType },
  });

  res.status(201).json({
    success: true,
    code: 'CONSENT_CREATED',
    message: 'Consent was recorded successfully.',
    details: consent.toObject(),
  });
}

export async function updateConsent(req, res) {
  const payload = consentSchema.partial().parse(req.body);
  if (payload.granted === true) {
    throw new ApiError(
      409,
      'CONSENT_RE_RECORD_REQUIRED',
      'Consent history is preserved. Record a new consent instead of editing a previous record.',
    );
  }
  if (payload.granted !== false || Object.keys(payload).some((key) => key !== 'granted')) {
    throw new ApiError(
      409,
      'CONSENT_RECORD_IMMUTABLE',
      'Consent records cannot be edited. Withdraw consent or record a new consent.',
    );
  }
  const consent = await Consent.findOne({
    _id: req.params.consentId,
    patientId: req.authorizedPatient._id,
  });

  if (!consent) {
    return res.status(404).json({
      success: false,
      code: 'CONSENT_NOT_FOUND',
      message: 'That consent record was not found.',
      details: null,
    });
  }

  if (!consent.granted || consent.withdrawnAt) {
    return res.json({
      success: true,
      code: 'CONSENT_WITHDRAWN',
      message: 'Consent was already withdrawn.',
      details: consent.toObject(),
    });
  }
  consent.granted = false;
  consent.withdrawnAt = new Date();

  await consent.save();
  await writeAuditLog({
    actorId: req.user.id,
    action: 'edit',
    resourceType: 'consent',
    resourceId: consent._id.toString(),
    hospitalId: req.user.hospitalId,
    requestId: req.id,
    metadata: { consentType: consent.consentType, operation: 'withdraw' },
  });

  res.json({
    success: true,
    code: 'CONSENT_UPDATED',
    message: 'Consent was updated successfully.',
    details: consent.toObject(),
  });
}

export async function withdrawConsent(req, res) {
  const consent = await Consent.findOne({
    _id: req.params.consentId,
    patientId: req.authorizedPatient._id,
  });

  if (!consent) {
    return res.status(404).json({
      success: false,
      code: 'CONSENT_NOT_FOUND',
      message: 'That consent record was not found.',
      details: null,
    });
  }

  if (!consent.granted || consent.withdrawnAt) {
    return res.json({
      success: true,
      code: 'CONSENT_WITHDRAWN',
      message: 'Consent was already withdrawn.',
      details: consent.toObject(),
    });
  }
  consent.granted = false;
  consent.withdrawnAt = new Date();
  await consent.save();
  await writeAuditLog({
    actorId: req.user.id,
    action: 'edit',
    resourceType: 'consent',
    resourceId: consent._id.toString(),
    hospitalId: req.user.hospitalId,
    requestId: req.id,
    metadata: { consentType: consent.consentType, operation: 'withdraw' },
  });

  res.json({
    success: true,
    code: 'CONSENT_WITHDRAWN',
    message: 'Consent was withdrawn successfully.',
    details: consent.toObject(),
  });
}

export async function getQuestionnaire(req, res) {
  const questionnaire = await ensureQuestionnaire();
  res.json({
    success: true,
    code: 'QUESTIONNAIRE',
    message: 'Questionnaire definition is ready.',
    details: {
      id: questionnaire._id,
      key: questionnaire.key,
      activeVersion: questionnaire.activeVersion,
      version: questionnaire.versions.find((item) => item.version === questionnaire.activeVersion),
    },
  });
}

export async function createQuestionnaireResponse(req, res) {
  const questionnaire = await ensureQuestionnaire();
  const payload = questionnaireResponseSchema.parse(req.body);
  const screeningSessionId = payload.screeningSessionId || req.params.screeningSessionId;

  let session = screeningSessionId
    ? await ScreeningSession.findOne({
        _id: screeningSessionId,
        patientId: req.authorizedPatient._id,
      }).lean()
    : await ScreeningSession.findOne({
        patientId: req.authorizedPatient._id,
        status: { $in: ['started', 'in_progress'] },
      })
        .sort({ startedAt: -1 })
        .lean();

  if (!session) {
    const screeningConsent = await Consent.findOne({
      patientId: req.authorizedPatient._id,
      consentType: 'screening',
      granted: true,
      withdrawnAt: null,
    })
      .sort({ recordedAt: -1 })
      .lean();

    if (!screeningConsent) {
      return res.status(403).json({
        success: false,
        code: 'CONSENT_REQUIRED',
        message: 'This screening requires active consent before answers can be saved.',
        details: null,
      });
    }
    session = await ScreeningSession.create({
      patientId: req.authorizedPatient._id,
      hospitalId: req.user.hospitalId || req.body.hospitalId || null,
      createdBy: req.user.id,
      consentId: screeningConsent._id,
      status: 'started',
      startedAt: new Date(),
      questionnaireVersion: questionnaire.activeVersion,
    });
  }
  if (!['started', 'in_progress'].includes(session.status)) {
    throw new ApiError(
      409,
      'SCREENING_SESSION_NOT_ACTIVE',
      'Completed screening answers cannot be changed.',
    );
  }

  const sensitiveQuestionKeys = new Set(
    questionnaire.versions
      .find((item) => item.version === questionnaire.activeVersion)
      .questions.filter((question) => question.sensitive)
      .map((question) => question.key),
  );
  const encryptedAnswers = payload.answers.map((item) => {
    if (
      item.skipped ||
      item.answer === null ||
      item.answer === undefined ||
      !sensitiveQuestionKeys.has(item.questionKey)
    ) {
      return item;
    }
    return { ...item, answer: encryptField(JSON.stringify(item.answer)) };
  });

  const response = await QuestionnaireResponse.findOneAndUpdate(
    { screeningSessionId: session._id, patientId: req.authorizedPatient._id },
    {
      screeningSessionId: session._id,
      patientId: req.authorizedPatient._id,
      questionnaireVersion: payload.questionnaireVersion || questionnaire.activeVersion,
      answers: encryptedAnswers,
      completedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.status(201).json({
    success: true,
    code: 'QUESTIONNAIRE_RESPONSE_CREATED',
    message: 'Questionnaire response was saved successfully.',
    details: {
      ...response.toObject(),
      answers: response.answers.map((item) => ({
        ...item.toObject(),
        answer: item.answer?.startsWith?.('enc:v1:')
          ? JSON.parse(decryptField(item.answer))
          : item.answer,
      })),
    },
  });
}
