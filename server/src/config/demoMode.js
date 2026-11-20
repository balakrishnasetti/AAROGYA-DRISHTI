export function isDemoSeedEnabled(environment = {}) {
  const deploymentEnvironment =
    environment.DEPLOYMENT_ENV ??
    (environment.NODE_ENV === 'production' ? 'production' : 'development');
  return (
    environment.SEED_DEMO === true &&
    deploymentEnvironment !== 'production' &&
    (environment.NODE_ENV !== 'production' || deploymentEnvironment === 'staging')
  );
}

export function assertDemoSeedEnabled(environment = {}) {
  if (!isDemoSeedEnabled(environment)) {
    throw new Error('Set SEED_DEMO=true in a development or staging environment to seed demo data.');
  }
}

export function assertLocalDemoSeedEnvironment(environment = {}) {
  if (environment.NODE_ENV !== 'development') {
    throw new Error('Local demo account seeding is available only in development.');
  }
  assertDemoSeedEnabled(environment);
  const uri = new URL(environment.MONGO_URI);
  if (!['localhost', '127.0.0.1', '::1'].includes(uri.hostname)) {
    throw new Error('Local demo account seeding requires a localhost MongoDB database.');
  }
}
