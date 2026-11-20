import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).optional();
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const phone = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/);
const day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const workingHours = z.array(
  z
    .object({
      day,
      opensAt: time.optional(),
      closesAt: time.optional(),
      closed: z.boolean().default(false),
    })
    .strict()
    .refine(
      (value) =>
        value.closed || (value.opensAt && value.closesAt && value.opensAt < value.closesAt),
      'Provide valid opening and closing times, or mark the day closed.',
    ),
);

const hospitalDetails = {
  name: text(160),
  centerType: z.enum(['hospital', 'phc', 'cancer_center', 'dental_center']).optional(),
  ownership: z.enum(['government', 'private', 'unknown']).optional(),
  specialties: z.array(text(120)).max(30).optional(),
  rating: z.number().min(0).max(5).optional(),
  registrationInfo: optionalText(300),
  address: text(300),
  city: text(100),
  state: text(100),
  postalCode: text(16),
  contactEmail: email.optional(),
  contactPhone: phone.optional(),
  coordinates: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .strict()
    .optional(),
  facilities: z.array(text(120)).max(50).default([]),
  services: z.array(text(120)).max(50).default([]),
  workingHours: workingHours.default([]),
};

export const createHospitalSchema = z
  .object({
    hospital: z.object(hospitalDetails).strict(),
    manager: z.object({ fullName: text(120), email, phone }).strict(),
  })
  .strict();

export const updateHospitalSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(hospitalDetails).map(([key, schema]) => [
        key,
        ['address', 'city', 'postalCode'].includes(key)
          ? z.union([schema, z.literal('')]).optional()
          : schema.optional(),
      ]),
    ),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
export const updateManagerHospitalSchema = z
  .object({
    name: hospitalDetails.name.optional(),
    centerType: hospitalDetails.centerType,
    ownership: hospitalDetails.ownership,
    specialties: hospitalDetails.specialties,
    rating: hospitalDetails.rating,
    address: hospitalDetails.address.optional(),
    city: hospitalDetails.city.optional(),
    state: hospitalDetails.state.optional(),
    postalCode: hospitalDetails.postalCode.optional(),
    contactEmail: hospitalDetails.contactEmail.optional(),
    contactPhone: hospitalDetails.contactPhone.optional(),
    coordinates: hospitalDetails.coordinates.optional(),
    facilities: hospitalDetails.facilities.optional(),
    services: hospitalDetails.services.optional(),
    workingHours: hospitalDetails.workingHours.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

const doctorFields = {
  fullName: text(120),
  email,
  phone,
  qualification: text(160),
  registrationNumber: text(100),
  specialty: optionalText(120),
  experienceYears: z.number().int().min(0).max(80).default(0),
  previousWork: z.array(text(200)).max(30).default([]),
  achievements: z.array(text(200)).max(30).default([]),
  expertise: z.array(text(120)).max(30).default([]),
  consultationFee: z.number().min(0).max(1000000).default(0),
  availability: z
    .array(
      z
        .object({ day, startsAt: time, endsAt: time })
        .strict()
        .refine(
          (value) => value.startsAt < value.endsAt,
          'Availability end must be after its start.',
        ),
    )
    .max(21)
    .default([]),
};

export const createDoctorSchema = z.object(doctorFields).strict();
export const updateDoctorSchema = z
  .object(
    Object.fromEntries(
      Object.entries(doctorFields).map(([key, schema]) => [key, schema.optional()]),
    ),
  )
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export const doctorStatusSchema = z.object({ status: z.enum(['disabled', 'suspended']) }).strict();
export const documentReviewSchema = z
  .object({ verificationStatus: z.enum(['verified', 'rejected']) })
  .strict();
export const doctorDocumentTypeSchema = z.enum([
  'qualification',
  'registration',
  'identity',
  'other',
]);
export const userUpdateSchema = z
  .object({
    role: z.enum([
      'admin',
      'hospital_manager',
      'doctor',
      'specialist',
      'patient',
      'health_worker',
      'navigator',
      'district_officer',
    ]).optional(),
    status: z.enum(['active', 'disabled', 'suspended']).optional(),
    district: optionalText(120),
    mandal: optionalText(120),
    phc: optionalText(120),
    assignedVillages: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .transform((villages) => [...new Set(villages)]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Choose a role or account status to update.');
export const auditFilterSchema = z
  .object({
    action: z
      .enum([
        'login',
        'login_failure',
        'logout',
        'password_change',
        'role_change',
        'read',
        'create',
        'edit',
        'export',
        'delete',
        'access_denied',
        'break_glass',
      ])
      .optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    resourceType: z.string().trim().max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(50),
  })
  .strict()
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    'The start date must be before the end date.',
  );
