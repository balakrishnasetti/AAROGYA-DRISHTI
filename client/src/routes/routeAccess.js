const staffRoles = new Set([
  'hospital_manager',
  'doctor',
  'specialist',
  'health_worker',
  'navigator',
  'district_officer',
]);

const roleDashboardPaths = {
  admin: '/super-admin',
  hospital_manager: '/hospital-administrator',
  doctor: '/doctor',
  specialist: '/specialist',
  patient: '/patient',
  health_worker: '/health-worker',
  navigator: '/health-assistant',
  district_officer: '/district-administrator',
};

const dashboardRoles = new Set(Object.keys(roleDashboardPaths));

export function dashboardPathForRole(role) {
  return roleDashboardPaths[role] ?? '/login';
}

export function hasPermission(user, permission) {
  if (!user || typeof permission !== 'string') return false;
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  return permission === 'dashboard.read' && dashboardRoles.has(user.role);
}

export function getLoginPathForRoles(roles) {
  if (roles?.length === 1 && roles[0] === 'patient') return '/login';
  if (roles?.length === 1 && roles[0] === 'admin') return '/super-admin/login';
  if (roles?.length === 1 && staffRoles.has(roles[0])) {
    return `/login/staff?role=${roles[0]}`;
  }
  return '/login/staff';
}

export function getLoginPathAfterPasswordChange(role) {
  if (role === 'admin') return '/super-admin/login';
  if (role === 'patient') return '/login?role=patient';
  return getLoginPathForRoles([role]);
}
