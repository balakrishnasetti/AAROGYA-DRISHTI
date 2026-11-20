import DoctorWorkflowPage from '../pages/doctor/DoctorWorkflowPage.jsx';
import RoleDashboardShell from './RoleDashboardShell.jsx';
import { useAuth } from '../store/useAuth.js';

export default function DoctorLayout() {
  const { user } = useAuth();
  return (
    <RoleDashboardShell role={user?.role === 'specialist' ? 'specialist' : 'doctor'}>
      <DoctorWorkflowPage />
    </RoleDashboardShell>
  );
}
