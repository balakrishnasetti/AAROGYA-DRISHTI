import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/useAuth.js';
import { getLoginPathForRoles, hasPermission } from './routeAccess.js';

export default function ProtectedRoute({ roles, permission }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="rounded-xl bg-surface p-6 text-muted" role="status">
        {t('auth.loading')}
      </p>
    );
  }
  if (!user) return <Navigate replace to={getLoginPathForRoles(roles)} />;
  if (roles && !roles.includes(user.role)) return <Navigate replace to="/forbidden" />;
  if (permission && !hasPermission(user, permission)) return <Navigate replace to="/forbidden" />;
  return <Outlet />;
}
