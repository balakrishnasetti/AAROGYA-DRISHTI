import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { dashboardPathForRole } from '../routes/routeAccess.js';
import { demoModeEnabled } from '../config/demoMode.js';

const navigation = {
  admin: [
    { key: 'overview', target: 'admin-overview' },
    { key: 'hospitals', target: 'admin-hospitals' },
    { key: 'users', target: 'admin-users' },
    { key: 'auditLogs', target: 'admin-audit' },
    { key: 'providers', to: '/admin/providers' },
  ],
  hospital_manager: [
    { key: 'overview', target: 'manager-overview' },
    { key: 'appointments', target: 'manager-appointments' },
    { key: 'hospitalProfile', target: 'manager-profile' },
    { key: 'staff', target: 'manager-staff' },
  ],
  doctor: [
    { key: 'qrScan', target: 'doctor-qr-title' },
    { key: 'callRequests', target: 'doctor-call-inbox' },
    { key: 'screeningReviews', target: 'doctor-review-queue' },
    { key: 'appointments', target: 'doctor-queue-title' },
  ],
  specialist: [
    { key: 'screeningReviews', target: 'doctor-review-queue' },
    { key: 'appointments', target: 'doctor-queue-title' },
  ],
  health_worker: [
    { key: 'registration', target: 'field-registration' },
    { key: 'photoCapture', target: 'field-photo-capture' },
  ],
  navigator: [
    { key: 'referrals', target: 'navigator-referrals' },
    { key: 'investigations', target: 'navigator-investigations' },
  ],
  district_officer: [{ key: 'analytics', target: 'district-analytics' }],
};

export default function RoleDashboardShell({ role, children }) {
  const { t } = useTranslation();
  const items = (navigation[role] ?? []).filter(
    (item) => item.key !== 'providers' || demoModeEnabled,
  );

  return (
    <div className="role-dashboard-shell grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="dashboard-rail self-start rounded-2xl border border-teal-100 bg-surface p-4 shadow-sm lg:sticky lg:top-4">
        <p className="px-2 text-xs font-bold uppercase tracking-wider text-teal-700">
          {t('roleDashboard.workspace')}
        </p>
        <h2 className="px-2 pb-3 pt-1 text-lg font-bold text-ink">
          {t(`roles.${role === 'hospital_manager' ? 'hospitalManager' : role}`)}
        </h2>
        <nav aria-label={t('roleDashboard.navigation')} className="flex gap-2 overflow-x-auto lg:flex-col">
          {items.map((item) =>
            item.to ? (
              <Link
                className="min-h-touch shrink-0 rounded-xl px-3 py-2 font-semibold text-teal-900 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                key={item.key}
                to={item.to}
              >
                {t(`roleDashboard.${item.key}`)}
              </Link>
            ) : (
              <a
                className="min-h-touch shrink-0 rounded-xl px-3 py-2 font-semibold text-teal-900 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                href={`#${item.target}`}
                key={item.key}
              >
                {t(`roleDashboard.${item.key}`)}
              </a>
            ),
          )}
        </nav>
        <Link
          className="mt-3 inline-flex min-h-touch items-center px-3 font-semibold text-teal-800 underline"
          to={dashboardPathForRole(role)}
        >
          {t('roleDashboard.dashboardHome')}
        </Link>
      </aside>
      <div className="dashboard-content min-w-0" id="dashboard">
        {children}
      </div>
    </div>
  );
}
