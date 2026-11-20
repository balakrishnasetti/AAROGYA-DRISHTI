import test from 'node:test';
import assert from 'node:assert/strict';
import { isClinicianFeedbackConsistent, reportFeedbackSchema } from '../routes/doctorRoutes.js';

test('clinician feedback requires a non-empty reason', () => {
  const feedback = {
    agreesWithFinding: false,
    correctedFinding: 'uncertain',
  };
  assert.equal(reportFeedbackSchema.safeParse(feedback).success, false);
  assert.equal(reportFeedbackSchema.safeParse({ ...feedback, note: '   ' }).success, false);
  assert.equal(
    reportFeedbackSchema.safeParse({ ...feedback, note: 'Image is unclear.' }).success,
    true,
  );
});

test('clinician feedback cannot contradict its agree or override choice', () => {
  assert.equal(
    isClinicianFeedbackConsistent(
      { agreesWithFinding: true, correctedFinding: 'white_patch' },
      'white_patch',
    ),
    true,
  );
  assert.equal(
    isClinicianFeedbackConsistent(
      { agreesWithFinding: true, correctedFinding: 'red_patch' },
      'white_patch',
    ),
    false,
  );
  assert.equal(
    isClinicianFeedbackConsistent(
      { agreesWithFinding: false, correctedFinding: 'uncertain' },
      null,
    ),
    true,
  );
  assert.equal(
    isClinicianFeedbackConsistent(
      { agreesWithFinding: true, correctedFinding: 'white_patch' },
      null,
    ),
    false,
  );
});
