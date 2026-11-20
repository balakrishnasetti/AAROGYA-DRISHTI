import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function PatientLayout() {
  const { t } = useTranslation();
  const linkClass = ({ isActive }) =>
    `inline-flex min-h-touch items-center rounded-xl px-4 font-semibold ${
      isActive ? 'bg-teal-800 text-white' : 'border border-teal-200 bg-white text-teal-900'
    }`;

  return (
    <div className="space-y-6">
      <nav aria-label={t('patientNav.label')} className="flex flex-wrap gap-3">
        <NavLink end className={linkClass} to="/patient">
          {t('patientNav.dashboard')}
        </NavLink>
        <NavLink className={linkClass} to="/patient/appointments">
          {t('patientNav.appointments')}
        </NavLink>
        <NavLink className={linkClass} to="/patient/hospitals">
          {t('patientNav.hospitals')}
        </NavLink>
        <NavLink className={linkClass} to="/patient/diet">
          {t('patientNav.dietLifestyle')}
        </NavLink>
        <NavLink className={linkClass} to="/patient/assistant">
          {t('patientNav.aiAssistant')}
        </NavLink>
        <NavLink className={linkClass} to="/patient/consent">
          {t('patientNav.consent')}
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
