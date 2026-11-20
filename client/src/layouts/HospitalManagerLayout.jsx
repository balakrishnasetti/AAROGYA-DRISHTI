import HospitalManagerConsole from '../pages/management/HospitalManagerConsole.jsx';
import RoleDashboardShell from './RoleDashboardShell.jsx';

export default function HospitalManagerLayout() {
  return (
    <RoleDashboardShell role="hospital_manager">
      <HospitalManagerConsole />
    </RoleDashboardShell>
  );
}
