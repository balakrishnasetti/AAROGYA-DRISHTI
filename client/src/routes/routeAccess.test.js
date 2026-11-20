import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPathForRole, getLoginPathForRoles } from './routeAccess.js';

test('specialists receive a dedicated staff login and dashboard path', () => {
  assert.equal(getLoginPathForRoles(['specialist']), '/login/staff?role=specialist');
  assert.equal(dashboardPathForRole('specialist'), '/specialist');
});
