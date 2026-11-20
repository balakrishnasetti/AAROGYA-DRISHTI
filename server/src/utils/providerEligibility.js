export function getAppointableDoctorFilter() {
  return [
    { verificationStatus: 'verified', isSynthetic: { $ne: true } },
    { verificationStatus: 'pending', isSynthetic: true },
  ];
}

export function doctorCanAccessWorkspace({ user, profile, hospital, environment }) {
  if (!profile || hospital?.status !== 'active') return false;
  if (profile.verificationStatus === 'verified') return true;
  return (
    environment.NODE_ENV === 'development' &&
    environment.SEED_DEMO === true &&
    user.isSynthetic === true &&
    profile.isSynthetic === true &&
    profile.demoLoginEnabled === true &&
    hospital.isSynthetic === true
  );
}
