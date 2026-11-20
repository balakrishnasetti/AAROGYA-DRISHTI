import AdminConsole from '../pages/management/AdminConsole.jsx';
import RoleDashboardShell from './RoleDashboardShell.jsx';

export default function AdminLayout() {
  return (
    <RoleDashboardShell role="admin">
      <AdminConsole />
    </RoleDashboardShell>
  );
}
