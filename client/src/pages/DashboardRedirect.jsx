import { Navigate } from 'react-router-dom';
import { useAuth } from '../store/useAuth.js';
import { dashboardPathForRole } from '../routes/routeAccess.js';

export default function DashboardRedirect() {
  const { user } = useAuth();
  return <Navigate replace to={dashboardPathForRole(user?.role)} />;
}
