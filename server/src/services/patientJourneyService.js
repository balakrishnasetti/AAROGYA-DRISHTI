import { CARE_JOURNEY_STAGES, Patient } from '../models/index.js';
import { ApiError } from '../utils/apiError.js';
import { writeAuditLog } from './auditService.js';

const transitions = Object.freeze({
  registered: ['screening_completed'],
  screening_completed: ['doctor_review'],
  doctor_review: ['treatment_started', 'follow_up_pending'],
  treatment_started: ['follow_up_pending'],
  follow_up_pending: ['case_closed'],
  case_closed: [],
});

export function nextCareJourneyStages(stage) {
  return transitions[stage] ? [...transitions[stage]] : [];
}

export function isValidCareJourneyTransition(fromStage, toStage) {
  return transitions[fromStage]?.includes(toStage) ?? false;
}

export function inferLegacyCareJourneyStage({
  followUpStatuses = [],
  reviewStatuses = [],
  screeningCompleted = false,
}) {
  if (followUpStatuses.some((status) => ['pending', 'contacted'].includes(status))) {
    return 'follow_up_pending';
  }
  if (followUpStatuses.includes('completed')) return 'case_closed';
  if (reviewStatuses.some((status) => ['in_review', 'completed'].includes(status))) {
    return 'doctor_review';
  }
  if (screeningCompleted) return 'screening_completed';
  return 'registered';
}

export function formatCareJourneyStageCounts(rows = []) {
  const counts = Object.fromEntries(CARE_JOURNEY_STAGES.map((stage) => [stage, 0]));
  for (const row of rows) {
    if (Object.hasOwn(counts, row._id)) counts[row._id] = row.count;
  }
  return counts;
}

export function createPatientJourneyService({
  PatientModel = Patient,
  auditWriter = writeAuditLog,
} = {}) {
  async function getPatientJourney(patientId) {
    const patient = await PatientModel.findOne({ _id: patientId, active: true })
      .select('careJourney')
      .lean();
    if (!patient) {
      throw new ApiError(404, 'PATIENT_NOT_FOUND', 'That patient record was not found.');
    }
    return {
      patientId: patient._id,
      stage: patient.careJourney?.stage ?? 'registered',
      storedStage: patient.careJourney?.stage,
      history: patient.careJourney?.history ?? [],
      allowedNextStages: nextCareJourneyStages(patient.careJourney?.stage ?? 'registered'),
    };
  }

  async function transitionPatientJourney({
    patientId,
    toStage,
    actorId,
    reason,
    requestId,
    hospitalId,
    ignoreAlreadyAdvanced = false,
  }) {
    if (!CARE_JOURNEY_STAGES.includes(toStage)) {
      throw new ApiError(400, 'CARE_JOURNEY_STAGE_INVALID', 'Choose a valid care journey stage.');
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      throw new ApiError(400, 'CARE_JOURNEY_REASON_REQUIRED', 'Provide a reason for this stage change.');
    }

    const current = await getPatientJourney(patientId);
    if (!CARE_JOURNEY_STAGES.includes(current.stage)) {
      throw new ApiError(
        409,
        'CARE_JOURNEY_STAGE_INVALID',
        'The patient has an unsupported care journey stage.',
      );
    }
    if (ignoreAlreadyAdvanced && CARE_JOURNEY_STAGES.indexOf(current.stage) >= CARE_JOURNEY_STAGES.indexOf(toStage)) {
      return { ...current, changed: false };
    }
    if (!isValidCareJourneyTransition(current.stage, toStage)) {
      throw new ApiError(
        409,
        'CARE_JOURNEY_TRANSITION_INVALID',
        'That care journey stage cannot follow the current stage.',
        { currentStage: current.stage, requestedStage: toStage },
      );
    }

    const filter = { _id: patientId, active: true };
    if (current.storedStage) {
      filter['careJourney.stage'] = current.stage;
    } else {
      filter['careJourney.stage'] = { $exists: false };
    }

    const changedAt = new Date();
    const patient = await PatientModel.findOneAndUpdate(
      filter,
      {
        $set: { 'careJourney.stage': toStage },
        $push: {
          'careJourney.history': {
            $each: [
              {
                fromStage: current.stage,
                toStage,
                changedBy: actorId,
                reason: reason.trim(),
                changedAt,
              },
            ],
            $slice: -50,
          },
        },
      },
      { new: true, runValidators: true },
    )
      .select('careJourney')
      .lean();

    if (!patient) {
      throw new ApiError(
        409,
        'CARE_JOURNEY_TRANSITION_CONFLICT',
        'The patient journey changed. Refresh the case before trying again.',
      );
    }

    await auditWriter({
      actorId,
      action: 'edit',
      resourceType: 'patient_care_journey',
      resourceId: patientId.toString(),
      hospitalId,
      requestId,
      metadata: { fromStage: current.stage, toStage },
    });

    return {
      patientId: patient._id,
      stage: patient.careJourney.stage,
      history: patient.careJourney.history,
      allowedNextStages: nextCareJourneyStages(patient.careJourney.stage),
      changed: true,
    };
  }

  return { getPatientJourney, transitionPatientJourney };
}
