export function isDemoModeEnabled(environment = {}) {
  const deploymentEnvironment =
    environment.VITE_DEPLOYMENT_ENV ?? (environment.PROD ? 'production' : 'development');
  return (
    environment.VITE_SEED_DEMO === 'true' &&
    deploymentEnvironment !== 'production' &&
    (!environment.PROD || deploymentEnvironment === 'staging')
  );
}

export const demoModeEnabled = import.meta.env?.VITE_DEMO_MODE_ENABLED === 'true';
