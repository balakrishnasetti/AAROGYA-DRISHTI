import { getHealthStatus } from '../services/healthService.js';
import { createPrivateStorageService } from '../services/privateStorageService.js';

export function healthController(environment) {
  const storageService = createPrivateStorageService(environment);
  return async (_req, res, next) => {
    try {
      const health = await getHealthStatus(environment, storageService);
      const statusCode = health.status === 'ok' ? 200 : 503;

      res.status(statusCode).json({
        success: statusCode === 200,
        code: health.status === 'ok' ? 'HEALTHY' : 'SERVICE_DEGRADED',
        message:
          health.status === 'ok' ? 'Service is available.' : 'A required service is unavailable.',
        details: health,
      });
    } catch (error) {
      next(error);
    }
  };
}
