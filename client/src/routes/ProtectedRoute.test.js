import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dashboardPathForRole,
  getLoginPathAfterPasswordChange,
  getLoginPathForRoles,
  hasPermission,
} from './routeAccess.js';

test('patient routes send unauthenticated users to patient sign-in', () => {
  assert.equal(getLoginPathForRoles(['patient']), '/login');
});

test('staff role routes send unauthenticated users to role-specific sign-in', () => {
  for (const role of [
    'hospital_manager',
    'doctor',
    'health_worker',
    'navigator',
    'district_officer',
  ]) {
    assert.equal(getLoginPathForRoles([role]), `/login/staff?role=${role}`);
  }
  assert.equal(getLoginPathForRoles(['admin']), '/super-admin/login');
});

test('mixed or unknown role sets use generic staff sign-in', () => {
  assert.equal(getLoginPathForRoles(['doctor', 'admin']), '/login/staff');
  assert.equal(getLoginPathForRoles(['unknown']), '/login/staff');
});

test('first password change returns to the matching role sign-in page', () => {
  for (const role of [
    'hospital_manager',
    'doctor',
    'health_worker',
    'navigator',
    'district_officer',
  ]) {
    assert.equal(getLoginPathAfterPasswordChange(role), `/login/staff?role=${role}`);
  }
  assert.equal(getLoginPathAfterPasswordChange('admin'), '/super-admin/login');
  assert.equal(getLoginPathAfterPasswordChange('patient'), '/login?role=patient');
  assert.equal(getLoginPathAfterPasswordChange(null), '/login/staff');
});

test('authenticated roles resolve to their own dashboard routes', () => {
  const paths = {
    patient: '/patient',
    doctor: '/doctor',
    health_worker: '/health-worker',
    navigator: '/health-assistant',
    hospital_manager: '/hospital-administrator',
    district_officer: '/district-administrator',
    admin: '/super-admin',
  };
  for (const [role, path] of Object.entries(paths)) {
    assert.equal(dashboardPathForRole(role), path);
    assert.equal(hasPermission({ role, permissions: ['dashboard.read'] }, 'dashboard.read'), true);
  }
  assert.equal(dashboardPathForRole('unknown'), '/login');
});

test('frontend permission checks deny permissions absent from the server grant', () => {
  const worker = {
    role: 'health_worker',
    permissions: ['dashboard.read', 'field.patients.register'],
  };
  assert.equal(hasPermission(worker, 'field.patients.register'), true);
  assert.equal(hasPermission(worker, 'screenings.review.write'), false);
  assert.equal(hasPermission(null, 'dashboard.read'), false);
});
