import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PatientLayout from '../layouts/PatientLayout.jsx';
import PublicLayout from '../layouts/PublicLayout.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';
import { demoModeEnabled } from '../config/demoMode.js';

const AdminLayout = lazy(() => import('../layouts/AdminLayout.jsx'));
const DoctorLayout = lazy(() => import('../layouts/DoctorLayout.jsx'));
const HospitalManagerLayout = lazy(() => import('../layouts/HospitalManagerLayout.jsx'));
const AdminProvidersLayout = demoModeEnabled
  ? lazy(() => import('../layouts/AdminProvidersLayout.jsx'))
  : null;
const HomePage = lazy(() => import('../pages/HomePage.jsx'));
const DashboardRedirect = lazy(() => import('../pages/DashboardRedirect.jsx'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.jsx'));
const ForbiddenPage = lazy(() => import('../pages/ForbiddenPage.jsx'));
const OfflinePwaPage = lazy(() => import('../pages/OfflinePwaPage.jsx'));
const FieldRoleDashboard = lazy(() => import('../pages/field/FieldRoleDashboard.jsx'));
const PatientWorkflowPage = lazy(() => import('../pages/patient/PatientWorkflowPage.jsx'));
const PatientAppointmentsPage = lazy(() => import('../pages/patient/PatientAppointmentsPage.jsx'));
const PatientDietPage = lazy(() => import('../pages/patient/PatientDietPage.jsx'));
const HospitalsPage = lazy(() => import('../pages/patient/HospitalsPage.jsx'));
const AiAssistantPage = lazy(() => import('../pages/patient/AiAssistantPage.jsx'));
const SyntheticPatientDemoPage = demoModeEnabled
  ? lazy(() => import('../pages/patient/SyntheticPatientDemoPage.jsx'))
  : null;
const ConsentCentrePage = lazy(() => import('../pages/patient/ConsentCentrePage.jsx'));
const StaffLoginPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({ default: module.StaffLoginPage })),
);
const StaffAccessRequestPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({
    default: module.StaffAccessRequestPage,
  })),
);
const SuperAdminLoginPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({
    default: module.SuperAdminLoginPage,
  })),
);
const PatientPasswordSetupPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({
    default: module.PatientPasswordSetupPage,
  })),
);
const PatientRegistrationPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({
    default: module.PatientRegistrationPage,
  })),
);
const FirstPasswordChangePage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({
    default: module.FirstPasswordChangePage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({ default: module.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('../pages/auth/AuthPages.jsx').then((module) => ({ default: module.ResetPasswordPage })),
);

export default function AppRoutes() {
  return (
    <Suspense
      fallback={
        <div aria-live="polite" className="p-6 text-center" role="status">
          Loading...
        </div>
      }
    >
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="evaluation-workflow" element={<Navigate replace to="/login" />} />
          <Route path="login" element={<StaffLoginPage />} />
          <Route path="login/staff" element={<StaffLoginPage />} />
          <Route path="staff-access-request" element={<StaffAccessRequestPage />} />
          <Route path="super-admin/login" element={<SuperAdminLoginPage />} />
          <Route path="patient-password-setup" element={<PatientRegistrationPage />} />
          <Route path="patient-password-setup/activation" element={<PatientPasswordSetupPage />} />
          {demoModeEnabled ? (
            <Route path="demo/patient-cases" element={<SyntheticPatientDemoPage />} />
          ) : null}
          <Route path="login/change-password" element={<FirstPasswordChangePage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="forbidden" element={<ForbiddenPage />} />
          <Route path="offline" element={<OfflinePwaPage />} />
          <Route element={<ProtectedRoute permission="dashboard.read" />}>
            <Route path="dashboard" element={<DashboardRedirect />} />
          </Route>
          <Route element={<ProtectedRoute roles={['admin']} permission="dashboard.read" />}>
            <Route path="admin" element={<AdminLayout />} />
            <Route path="super-admin" element={<AdminLayout />} />
          </Route>
          {demoModeEnabled ? (
            <Route
              element={<ProtectedRoute roles={['admin']} permission="platform.models.manage" />}
            >
              <Route path="admin/providers" element={<AdminProvidersLayout />} />
            </Route>
          ) : null}
          <Route
            element={<ProtectedRoute roles={['hospital_manager']} permission="dashboard.read" />}
          >
            <Route path="hospital-manager" element={<HospitalManagerLayout />} />
            <Route path="hospital-administrator" element={<HospitalManagerLayout />} />
          </Route>
          <Route
            element={
              <ProtectedRoute roles={['doctor', 'specialist']} permission="dashboard.read" />
            }
          >
            <Route path="doctor" element={<DoctorLayout />} />
            <Route path="specialist" element={<DoctorLayout />} />
          </Route>
          <Route element={<ProtectedRoute roles={['patient']} permission="dashboard.read" />}>
            <Route path="patient" element={<PatientLayout />}>
              <Route index element={<PatientWorkflowPage />} />
              <Route path="appointments" element={<PatientAppointmentsPage />} />
              <Route path="diet" element={<PatientDietPage />} />
              <Route path="hospitals" element={<HospitalsPage />} />
              <Route path="assistant" element={<AiAssistantPage />} />
              <Route path="consent" element={<ConsentCentrePage />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={['health_worker']} permission="dashboard.read" />}>
            <Route path="health-worker" element={<FieldRoleDashboard role="health_worker" />} />
          </Route>
          <Route element={<ProtectedRoute roles={['navigator']} permission="dashboard.read" />}>
            <Route path="navigator" element={<FieldRoleDashboard role="navigator" />} />
            <Route path="health-assistant" element={<FieldRoleDashboard role="navigator" />} />
          </Route>
          <Route
            element={<ProtectedRoute roles={['district_officer']} permission="dashboard.read" />}
          >
            <Route
              path="district-officer"
              element={<FieldRoleDashboard role="district_officer" />}
            />
            <Route
              path="district-administrator"
              element={<FieldRoleDashboard role="district_officer" />}
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
