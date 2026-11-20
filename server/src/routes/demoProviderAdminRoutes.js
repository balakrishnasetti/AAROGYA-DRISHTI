import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { Appointment, DoctorProfile, Hospital, TimeSlot, User } from '../models/index.js';
import { writeAuditLog } from '../services/auditService.js';
import { ApiError } from '../utils/apiError.js';
import { validateBody } from '../middleware/validate.js';
import { dentalSpecialties } from '../jobs/syntheticProviders.js';

const text = (max) => z.string().trim().min(1).max(max);
const email = z.string().email().max(254).endsWith('.invalid');
const day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const schedule = z.array(
  z.object({
    day,
    startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).strict(),
).max(21);

const facilitySchema = z.object({
  name: text(160),
  facilityType: z.enum(['hospital', 'phc']),
  address: text(300),
  city: text(100),
  state: text(100),
  postalCode: text(16),
  district: text(120),
  mandal: text(120).optional(),
  village: text(120).optional(),
  contactEmail: email,
  contactPhone: text(30),
  services: z.array(text(120)).max(50).default([]),
  facilities: z.array(text(120)).max(50).default([]),
  workingHours: z.array(z.object({
    day,
    opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    closed: z.boolean(),
  }).strict()).max(7).default([]),
}).strict();

const facilityUpdateSchema = facilitySchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update.',
);

const doctorSchema = z.object({
  fullName: text(120),
  facilityId: z.string().regex(/^[a-f\d]{24}$/i),
  qualification: text(160),
  specialty: z.enum(dentalSpecialties),
  experienceYears: z.number().int().min(0).max(80),
  languages: z.array(z.enum(['en', 'te'])).max(2).default(['en', 'te']),
  consultationFee: z.number().min(0).max(1000000).default(0),
  availability: schedule.default([]),
}).strict();

const doctorUpdateSchema = doctorSchema.partial().strict().omit({ facilityId: true }).refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one field to update.',
);

async function writeProviderAudit(req, action, resourceType, resourceId, hospitalId = null) {
  await writeAuditLog({
    actorId: req.user.id,
    action,
    resourceType,
    resourceId: resourceId.toString(),
    hospitalId,
    requestId: req.id,
    metadata: { scope: 'synthetic_demo_only' },
  });
}

export function createDemoProviderAdminRoutes(environment) {
  const router = Router();
  router.use(authenticate(environment), authorize('admin'));

  router.get('/', asyncHandler(async (req, res) => {
    const [facilities, profiles] = await Promise.all([
      Hospital.find({ isSynthetic: true }).sort({ facilityType: 1, name: 1 }).limit(50).lean(),
      DoctorProfile.find({ isSynthetic: true })
        .populate({ path: 'userId', select: 'fullName staffId role status isSynthetic' })
        .populate({ path: 'hospitalId', select: 'name code facilityType district mandal village isSynthetic' })
        .sort({ specialty: 1, createdAt: 1 })
        .limit(50)
        .lean(),
    ]);
    const doctorIds = profiles.map((profile) => profile.userId?._id).filter(Boolean);
    const [slots, appointments] = await Promise.all([
      TimeSlot.find({ doctorId: { $in: doctorIds }, isSynthetic: true, startAt: { $gte: new Date() } })
        .sort({ startAt: 1 }).limit(500).select('doctorId hospitalId startAt endAt status').lean(),
      Appointment.find({ doctorId: { $in: doctorIds }, isSynthetic: true })
        .sort({ slotStart: -1 }).limit(100)
        .select('doctorId hospitalId slotStart status').lean(),
    ]);
    await writeProviderAudit(req, 'read', 'synthetic_providers', req.user.id);
    res.json({
      success: true,
      code: 'SYNTHETIC_PROVIDERS',
      message: 'Synthetic demo provider records are ready.',
      details: { facilities, doctors: profiles, slots, appointments },
    });
  }));

  router.post('/facilities', validateBody(facilitySchema), asyncHandler(async (req, res) => {
    const facility = await Hospital.create({
      ...req.body,
      code: `SYN-DEMO-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      status: 'active',
      isSynthetic: true,
    });
    await writeProviderAudit(req, 'create', 'synthetic_facility', facility._id, facility._id);
    res.status(201).json({
      success: true,
      code: 'SYNTHETIC_FACILITY_CREATED',
      message: 'Synthetic demo facility created. It is not a real healthcare provider.',
      details: facility,
    });
  }));

  router.patch('/facilities/:facilityId', asyncHandler(async (req, res, next) => {
    const parsedId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.facilityId);
    const parsedBody = facilityUpdateSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Check the demo facility details.'));
    }
    const facility = await Hospital.findOneAndUpdate(
      { _id: parsedId.data, isSynthetic: true },
      { $set: parsedBody.data },
      { new: true, runValidators: true },
    );
    if (!facility) throw new ApiError(404, 'DEMO_FACILITY_NOT_FOUND', 'Synthetic demo facility not found.');
    await writeProviderAudit(req, 'edit', 'synthetic_facility', facility._id, facility._id);
    res.json({ success: true, code: 'SYNTHETIC_FACILITY_UPDATED', message: 'Synthetic demo facility updated.', details: facility });
  }));

  router.post('/doctors', validateBody(doctorSchema), asyncHandler(async (req, res) => {
    const facility = await Hospital.findOne({ _id: req.body.facilityId, isSynthetic: true, status: 'active' }).lean();
    if (!facility) throw new ApiError(404, 'DEMO_FACILITY_NOT_FOUND', 'Select an active synthetic demo facility.');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const user = await User.create({
      fullName: req.body.fullName,
      email: `dentist-${suffix.toLowerCase()}@example.invalid`,
      staffId: `SYN-DEMO-DOC-${suffix}`,
      role: 'doctor',
      status: 'disabled',
      mustChangePassword: true,
      isSynthetic: true,
    });
    let profile;
    try {
      profile = await DoctorProfile.create({
        userId: user._id,
        hospitalId: facility._id,
        qualification: req.body.qualification,
        registrationNumber: `SYNTHETIC-DEMO-NOT-A-REGISTRATION-${suffix}`,
        specialty: req.body.specialty,
        experienceYears: req.body.experienceYears,
        consultationFee: req.body.consultationFee,
        languages: req.body.languages,
        availability: req.body.availability,
        verificationStatus: 'pending',
        isSynthetic: true,
      });
    } catch (error) {
      await User.deleteOne({ _id: user._id, isSynthetic: true });
      throw error;
    }
    await writeProviderAudit(req, 'create', 'synthetic_doctor', user._id, facility._id);
    res.status(201).json({
      success: true,
      code: 'SYNTHETIC_DOCTOR_CREATED',
      message: 'Synthetic demo doctor created. No login or real provider credentials were issued.',
      details: { ...profile.toObject(), userId: { _id: user._id, fullName: user.fullName, status: user.status, isSynthetic: true }, hospitalId: facility },
    });
  }));

  router.patch('/doctors/:doctorId', asyncHandler(async (req, res, next) => {
    const parsedId = z.string().regex(/^[a-f\d]{24}$/i).safeParse(req.params.doctorId);
    const parsedBody = doctorUpdateSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Check the demo doctor details.'));
    }
    const profile = await DoctorProfile.findOne({ userId: parsedId.data, isSynthetic: true });
    if (!profile) throw new ApiError(404, 'DEMO_DOCTOR_NOT_FOUND', 'Synthetic demo doctor not found.');
    const { fullName, ...updates } = parsedBody.data;
    if (fullName) await User.updateOne({ _id: profile.userId, isSynthetic: true, role: 'doctor' }, { $set: { fullName } });
    Object.assign(profile, updates);
    profile.verificationStatus = 'pending';
    profile.verifiedBy = undefined;
    profile.verifiedAt = undefined;
    await profile.save();
    await writeProviderAudit(req, 'edit', 'synthetic_doctor', profile.userId, profile.hospitalId);
    res.json({ success: true, code: 'SYNTHETIC_DOCTOR_UPDATED', message: 'Synthetic demo doctor updated; status remains unverified.', details: profile });
  }));

  return router;
}
