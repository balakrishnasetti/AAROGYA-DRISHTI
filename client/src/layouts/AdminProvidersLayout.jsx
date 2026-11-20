import AdminDemoProvidersPage from '../pages/management/AdminDemoProvidersPage.jsx';
import RoleDashboardShell from './RoleDashboardShell.jsx';

export default function AdminProvidersLayout() {
  return (
    <RoleDashboardShell role="admin">
      <AdminDemoProvidersPage />
    </RoleDashboardShell>
  );
}
