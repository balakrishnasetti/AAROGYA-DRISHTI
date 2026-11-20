import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoSessionService } from '../services/videoSessionService.js';

const jwtSecret = 'video-session-test-secret-at-least-32-characters';

function createVideoSessionModel() {
  let stored;
  return {
    async create(values) {
      stored = {
        ...values,
        _id: 'video-session-1',
        async save() {},
      };
      return stored;
    },
    findById(id) {
      return {
        select() {
          return {
            async lean() {
              return id === stored?._id ? stored : null;
            },
          };
        },
      };
    },
  };
}

test('video join tokens are bound to a participant and appointment window', async () => {
  const videoSessionModel = createVideoSessionModel();
  const service = createVideoSessionService({ videoSessionModel, jwtSecret });
  const patientUserId = 'patient-user-1';
  const doctorId = 'doctor-user-1';
  const { session, tokens } = await service.createSession({
    appointmentId: 'appointment-1',
    patientId: 'patient-1',
    patientUserId,
    doctorId,
    hospitalId: 'hospital-1',
    slotStart: new Date(Date.now() + 60_000),
  });

  assert.equal(
    await service.validateJoinToken({
      videoSessionId: session._id,
      userId: patientUserId,
      token: tokens[patientUserId],
    }),
    true,
  );
  assert.equal(
    await service.validateJoinToken({
      videoSessionId: session._id,
      userId: 'unassigned-doctor',
      token: tokens[patientUserId],
    }),
    false,
  );
  assert.equal(
    await service.validateJoinToken({
      videoSessionId: session._id,
      userId: doctorId,
      token: tokens[patientUserId],
    }),
    false,
  );
});

test('video join tokens expire outside the confirmed appointment window', async () => {
  const videoSessionModel = createVideoSessionModel();
  const service = createVideoSessionService({ videoSessionModel, jwtSecret });
  const patientUserId = 'patient-user-2';
  const { session, tokens } = await service.createSession({
    appointmentId: 'appointment-2',
    patientId: 'patient-2',
    patientUserId,
    doctorId: 'doctor-user-2',
    hospitalId: 'hospital-2',
    slotStart: new Date(Date.now() - 31 * 60_000),
  });

  assert.equal(
    await service.validateJoinToken({
      videoSessionId: session._id,
      userId: patientUserId,
      token: tokens[patientUserId],
    }),
    false,
  );
});
