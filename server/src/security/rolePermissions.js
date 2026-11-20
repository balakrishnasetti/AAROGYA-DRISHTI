export const ROLE_PERMISSIONS = Object.freeze({
  patient: [
    'dashboard.read',
    'profile.self.read',
    'profile.self.write',
    'screening.self.read',
    'screening.self.write',
    'appointments.self.read',
    'appointments.self.write',
    'calls.self.write',
    'diet.self.read',
    'hospitals.public.read',
    'consent.self.write',
    'qr.self.write',
  ],
  doctor: [
    'dashboard.read',
    'patients.assigned.read',
    'screenings.review.read',
    'screenings.review.write',
    'appointments.assigned.read',
    'appointments.assigned.write',
    'consultations.notes.write',
    'calls.assigned.read',
    'calls.assigned.write',
    'referrals.assigned.write',
    'qr.patient.scan',
  ],
  specialist: [
    'dashboard.read',
    'patients.assigned.read',
    'screenings.review.read',
    'screenings.review.write',
    'appointments.assigned.read',
    'appointments.assigned.write',
    'consultations.notes.write',
    'calls.assigned.read',
    'calls.assigned.write',
    'referrals.assigned.write',
    'qr.patient.scan',
  ],
  health_worker: [
    'dashboard.read',
    'field.patients.register',
    'field.patients.own.read',
    'field.photos.capture',
    'field.offline.sync',
  ],
  navigator: [
    'dashboard.read',
    'referrals.catchment.read',
    'referrals.coordination.write',
    'investigations.catchment.read',
  ],
  hospital_manager: [
    'dashboard.read',
    'hospital.operations.read',
    'hospital.operations.write',
    'hospital.staff.manage',
    'hospital.bookings.manage',
  ],
  district_officer: ['dashboard.read', 'district.analytics.read', 'district.analytics.export'],
  admin: [
    'dashboard.read',
    'platform.users.manage',
    'platform.roles.manage',
    'platform.audit.read',
    'platform.settings.manage',
    'platform.models.manage',
  ],
});

export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] ? [...ROLE_PERMISSIONS[role]] : [];
}

export function roleHasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
