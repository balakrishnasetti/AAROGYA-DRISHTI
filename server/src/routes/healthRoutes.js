import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';

export function createHealthRoutes(environment) {
  const router = Router();
  router.get('/health', healthController(environment));
  return router;
}
