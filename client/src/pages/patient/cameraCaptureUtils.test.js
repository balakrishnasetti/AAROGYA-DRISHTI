import test from 'node:test';
import assert from 'node:assert/strict';
import { getCameraErrorKey } from './cameraCaptureUtils.js';

test('camera failures map to actionable permission and device guidance', () => {
  assert.equal(getCameraErrorKey({ name: 'NotAllowedError' }), 'cameraPermissionDenied');
  assert.equal(getCameraErrorKey({ name: 'NotFoundError' }), 'cameraNotFound');
  assert.equal(getCameraErrorKey({ name: 'NotReadableError' }), 'cameraBusy');
  assert.equal(getCameraErrorKey({ name: 'SecurityError' }), 'cameraInsecureContext');
  assert.equal(getCameraErrorKey({ name: 'OtherError' }), 'cameraUnavailable');
});
