import test from 'node:test';
import assert from 'node:assert/strict';
import { isDemoModeEnabled } from './demoMode.js';

test('demo UI requires explicit opt-in and does not enable on production builds', () => {
  assert.equal(isDemoModeEnabled({ PROD: false }), false);
  assert.equal(
    isDemoModeEnabled({ PROD: false, VITE_DEPLOYMENT_ENV: 'development', VITE_SEED_DEMO: 'true' }),
    true,
  );
  assert.equal(
    isDemoModeEnabled({ PROD: true, VITE_SEED_DEMO: 'true' }),
    false,
  );
  assert.equal(
    isDemoModeEnabled({
      PROD: true,
      VITE_DEPLOYMENT_ENV: 'development',
      VITE_SEED_DEMO: 'true',
    }),
    false,
  );
  assert.equal(
    isDemoModeEnabled({
      PROD: true,
      VITE_DEPLOYMENT_ENV: 'staging',
      VITE_SEED_DEMO: 'true',
    }),
    true,
  );
});
