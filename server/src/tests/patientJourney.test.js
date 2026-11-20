import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { CARE_JOURNEY_STAGES, Patient } from '../models/index.js';
import { ROLE_PERMISSIONS } from '../security/rolePermissions.js';
import {
  createPatientJourneyService,
  formatCareJourneyStageCounts,
  inferLegacyCareJourneyStage,
  isValidCareJourneyTransition,
  nextCareJourneyStages,
} from '../services/patientJourneyService.js';

function queryFor(value) {
  return {
    select() {
      return this;
    },
    async lean() {
      return value ? structuredClone(value) : null;
    },
  };
}

function patientModel(initialPatient) {
  let patient = structuredClone(initialPatient);
  return {
    findOne: () => queryFor(patient),
    findOneAndUpdate(filter, update) {
      const storedStage = patient.careJourney?.stage;
      const stageFilter = filter['careJourney.stage'];
      const matches =
        stageFilter?.$exists === false
          ? storedStage === undefined
          : stageFilter?.$in
            ? stageFilter.$in.includes(storedStage ?? null)
            : stageFilter === storedStage;
      if (!matches) return queryFor(null);

      patient.careJourney ??= { history: [] };
      patient.careJourney.stage = update.$set['careJourney.stage'];
      patient.careJourney.history ??= [];
      patient.careJourney.history.push(...update.$push['careJourney.history'].$each);
      patient.careJourney.history = patient.careJourney.history.slice(-50);
      return queryFor(patient);
    },
    read() {
      return patient;
    },
  };
}

test('new patient records begin at Registered without altering existing relationships', () => {
  const patient = new Patient({ userId: new mongoose.Types.ObjectId() });
  assert.equal(patient.validateSync(), undefined);
  assert.equal(patient.careJourney.stage, 'registered');
  assert.deepEqual(patient.careJourney.history, []);
  assert.equal(patient.userId.toString(), patient.get('userId').toString());
});

test('journey transition graph permits only the next supported stage', () => {
  assert.deepEqual(CARE_JOURNEY_STAGES, [
    'registered',
    'screening_completed',
    'doctor_review',
    'treatment_started',
    'follow_up_pending',
    'case_closed',
  ]);
  assert.deepEqual(nextCareJourneyStages('doctor_review'), [
    'treatment_started',
    'follow_up_pending',
  ]);
  assert.equal(isValidCareJourneyTransition('follow_up_pending', 'case_closed'), true);
  assert.equal(isValidCareJourneyTransition('registered', 'treatment_started'), false);
  assert.deepEqual(nextCareJourneyStages('case_closed'), []);
});

test('legacy patient stage is inferred only from recorded workflow evidence', () => {
  assert.equal(inferLegacyCareJourneyStage({}), 'registered');
  assert.equal(inferLegacyCareJourneyStage({ screeningCompleted: true }), 'screening_completed');
  assert.equal(inferLegacyCareJourneyStage({ reviewStatuses: ['in_review'] }), 'doctor_review');
  assert.equal(inferLegacyCareJourneyStage({ followUpStatuses: ['pending'] }), 'follow_up_pending');
  assert.equal(inferLegacyCareJourneyStage({ followUpStatuses: ['completed'] }), 'case_closed');
  assert.equal(
    inferLegacyCareJourneyStage({
      followUpStatuses: ['completed', 'pending'],
      reviewStatuses: ['completed'],
      screeningCompleted: true,
    }),
    'follow_up_pending',
  );
});

test('stage counts return zeroes for missing stages and aggregate only supported values', () => {
  assert.deepEqual(
    formatCareJourneyStageCounts([
      { _id: 'registered', count: 2 },
      { _id: 'case_closed', count: 1 },
      { _id: 'unsupported', count: 5 },
    ]),
    {
      registered: 2,
      screening_completed: 0,
      doctor_review: 0,
      treatment_started: 0,
      follow_up_pending: 0,
      case_closed: 1,
    },
  );
});

test('journey transitions are atomic, audited, reasoned, and reject skipped stages', async () => {
  const model = patientModel({ _id: 'patient-1', active: true });
  const auditEvents = [];
  const journey = createPatientJourneyService({
    PatientModel: model,
    auditWriter: async (event) => auditEvents.push(event),
  });

  const first = await journey.transitionPatientJourney({
    patientId: 'patient-1',
    toStage: 'screening_completed',
    actorId: 'user-1',
    reason: 'Screening questionnaire completed.',
  });
  assert.equal(first.stage, 'screening_completed');
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].fromStage, 'registered');
  assert.equal(first.history[0].reason, 'Screening questionnaire completed.');
  assert.deepEqual(first.allowedNextStages, ['doctor_review']);
  assert.equal(auditEvents[0].resourceType, 'patient_care_journey');
  assert.deepEqual(auditEvents[0].metadata, {
    fromStage: 'registered',
    toStage: 'screening_completed',
  });

  await assert.rejects(
    journey.transitionPatientJourney({
      patientId: 'patient-1',
      toStage: 'treatment_started',
      actorId: 'user-1',
      reason: 'Attempt to skip review.',
    }),
    (error) => error.code === 'CARE_JOURNEY_TRANSITION_INVALID',
  );
  assert.equal(model.read().careJourney.stage, 'screening_completed');
  assert.equal(model.read().careJourney.history.length, 1);
});

test('later screening events are idempotent and cannot regress a journey', async () => {
  const model = patientModel({
    _id: 'patient-1',
    active: true,
    careJourney: { stage: 'doctor_review', history: [] },
  });
  const journey = createPatientJourneyService({ PatientModel: model, auditWriter: async () => {} });
  const result = await journey.transitionPatientJourney({
    patientId: 'patient-1',
    toStage: 'screening_completed',
    actorId: 'user-1',
    reason: 'A later screening session completed.',
    ignoreAlreadyAdvanced: true,
  });
  assert.equal(result.changed, false);
  assert.equal(result.stage, 'doctor_review');
  assert.equal(model.read().careJourney.history.length, 0);
});

test('a patient can complete every care journey stage in order', async () => {
  const model = patientModel({ _id: 'patient-1', active: true });
  const journey = createPatientJourneyService({ PatientModel: model, auditWriter: async () => {} });
  let result;

  for (const toStage of [
    'screening_completed',
    'doctor_review',
    'treatment_started',
    'follow_up_pending',
    'case_closed',
  ]) {
    result = await journey.transitionPatientJourney({
      patientId: 'patient-1',
      toStage,
      actorId: 'clinician-1',
      reason: `Documented transition to ${toStage}.`,
    });
  }

  assert.equal(result.stage, 'case_closed');
  assert.deepEqual(result.allowedNextStages, []);
  assert.equal(model.read().careJourney.history.length, CARE_JOURNEY_STAGES.length - 1);
});

test('Specialist has assigned-clinician permissions but no platform administration', () => {
  assert.ok(ROLE_PERMISSIONS.specialist.includes('patients.assigned.read'));
  assert.ok(ROLE_PERMISSIONS.specialist.includes('screenings.review.write'));
  assert.equal(ROLE_PERMISSIONS.specialist.includes('platform.users.manage'), false);
  assert.ok(ROLE_PERMISSIONS.admin.includes('platform.users.manage'));
  assert.equal(ROLE_PERMISSIONS.patient.includes('screenings.review.write'), false);
});
