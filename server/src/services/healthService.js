import { getDatabaseStatus } from '../config/database.js';
import { createPrivateStorageService, getPrivateStorageBackend } from './privateStorageService.js';

export async function getHealthStatus(
  environment,
  storageService = createPrivateStorageService(environment),
  fetchImplementation = fetch,
) {
  const database = getDatabaseStatus();
  const [storage, model] = await Promise.all([
    storageService.checkAvailability(),
    getModelStatus(environment, fetchImplementation),
  ]);
  const healthy = database === 'connected' && storage === 'available';
  const storageStatus =
    storage === 'available'
      ? 'ok'
      : storage === 'not_configured'
        ? 'not_configured'
        : 'unavailable';

  return {
    status: healthy ? 'ok' : 'degraded',
    api: 'ok',
    db: database === 'connected' ? 'ok' : 'unavailable',
    database,
    storage: storageStatus,
    storageBackend: getPrivateStorageBackend(environment),
    model: model.status,
    modelLoaded: model.status === 'ready',
    modelVersion: model.modelVersion,
    checkedAt: new Date().toISOString(),
  };
}

async function getModelStatus(environment, fetchImplementation) {
  if (!environment.ORAL_MODEL_API_URL || !environment.ORAL_MODEL_API_TOKEN) {
    return { status: 'not_configured', modelVersion: null };
  }

  try {
    const endpoint = new URL('/health', environment.ORAL_MODEL_API_URL);
    const response = await fetchImplementation(endpoint, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { status: 'unavailable', modelVersion: null };
    const result = await response.json();
    const modelStatus = result.classifierModel?.status || result.status;
    const modelVersion = result.classifierModel?.version || result.modelVersion || null;
    if (modelStatus === 'ready') {
      return { status: 'ready', modelVersion };
    }
    if (modelStatus === 'not_ready') {
      return { status: 'not_ready', modelVersion };
    }
  } catch {
    return { status: 'unavailable', modelVersion: null };
  }
  return { status: 'unavailable', modelVersion: null };
}
