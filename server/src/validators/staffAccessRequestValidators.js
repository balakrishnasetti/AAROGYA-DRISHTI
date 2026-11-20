import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
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

export const staffAccessRequestSchema = z
  .object({
    fullName: text(120),
    email,
    phone,
    requestedRole: z.enum([
      'hospital_manager',
      'doctor',
      'specialist',
      'health_worker',
      'navigator',
      'district_officer',
    ]),
    district: text(120),
    mandal: text(120).optional(),
    phc: text(120).optional(),
    assignedVillages: z.array(text(120)).max(100).default([]),
    hospitalId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
    qualification: text(160).optional(),
    registrationNumber: text(100).optional(),
    specialty: text(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (['hospital_manager', 'doctor', 'specialist'].includes(value.requestedRole) && !value.hospitalId) {
      context.addIssue({
        code: 'custom',
        path: ['hospitalId'],
        message: 'Choose the hospital or clinic you are applying to join.',
      });
    }
    if (
      ['doctor', 'specialist'].includes(value.requestedRole) &&
      (!value.qualification || !value.registrationNumber || !value.specialty)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['qualification'],
        message: 'Doctor requests require qualification, registration number, and specialty.',
      });
    }
    if (
      ['health_worker', 'navigator'].includes(value.requestedRole) &&
      (!value.mandal || !value.phc)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['mandal'],
        message: 'Field staff requests require a mandal and PHC.',
      });
    }
  });

export const staffAccessReviewSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reviewNote: z.string().trim().max(1000).optional(),
  })
  .strict();
