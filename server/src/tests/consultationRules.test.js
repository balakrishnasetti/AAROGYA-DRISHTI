import test from 'node:test';
import assert from 'node:assert/strict';
import { detectUrgentCall } from '../services/consultationRules.js';
import { isAllowedPushEndpoint } from '../services/webPushService.js';

test('call requests flag reported bleeding and breathing or swallowing trouble', () => {
  assert.equal(detectUrgentCall('I have bleeding from my mouth.'), true);
  assert.equal(detectUrgentCall('I have difficulty breathing'), true);
  assert.equal(detectUrgentCall('I have trouble swallowing'), true);
  assert.equal(detectUrgentCall('నాకు శ్వాస తీసుకోవడంలో ఇబ్బంది ఉంది'), true);
  assert.equal(detectUrgentCall('I want to ask about my follow-up.'), false);
});

test('browser push subscriptions allow known HTTPS push providers only', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  assert.equal(
    isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'),
    true,
  );
  assert.equal(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
  assert.equal(isAllowedPushEndpoint('https://attacker.example/push'), false);
  assert.equal(isAllowedPushEndpoint('not-a-url'), false);
});
