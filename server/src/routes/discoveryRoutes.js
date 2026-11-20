import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { listHospitalDoctors, listHospitals, getHospitalById } from '../services/discoveryService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateObjectIdParam } from '../controllers/userController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { getDrivingDirections } from '../services/directionsService.js';

const coordinate = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

export function createDiscoveryRoutes(environment) {
  const router = Router();

  router.post(
    '/hospitals/directions',
    authenticate(environment),
    authorize('patient'),
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        success: false,
        code: 'DIRECTIONS_RATE_LIMITED',
        message: 'Too many route requests. Wait a few minutes and try again.',
        details: null,
      },
    }),
    validateBody(z.object({
      origin: coordinate,
      destination: coordinate,
      language: z.enum(['en', 'te']).default('en'),
    }).strict()),
    asyncHandler(async (req, res) => {
      const details = await getDrivingDirections({
        ...req.body,
        apiKey: environment.MAPS_KEY,
      });
      res.json({
        success: true,
        code: 'HOSPITAL_DIRECTIONS',
        message: 'Route preview is ready.',
        details,
      });
    }),
  );

  router.get(
    '/hospitals',
    asyncHandler(async (req, res) => {
      const items = await listHospitals(req.query);
      res.json({
        success: true,
        code: 'HOSPITALS',
        message: 'Hospital records are ready.',
        details: items,
      });
    }),
  );

  router.get(
    '/hospitals/:hospitalId',
    validateObjectIdParam('hospitalId'),
    asyncHandler(async (req, res) => {
      const hospital = await getHospitalById(req.params.hospitalId);
      res.json({
        success: true,
        code: 'HOSPITAL_PROFILE',
        message: 'Hospital details are ready.',
        details: hospital,
      });
    }),
  );

  router.get(
    '/hospitals/:hospitalId/doctors',
    validateObjectIdParam('hospitalId'),
    asyncHandler(async (req, res) => {
      const doctors = await listHospitalDoctors(req.params.hospitalId, req.query);
      res.json({
        success: true,
        code: 'HOSPITAL_DOCTORS',
        message: 'Doctor records are ready.',
        details: doctors,
      });
    }),
  );

  return router;
}
