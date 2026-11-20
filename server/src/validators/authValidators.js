import { z } from 'zod';

export const mobileSchema = z
  .string()
  .trim()
  .transform((value) => {
    const digits = value.replace(/[\s()-]/g, '');
    return /^\d{10}$/.test(digits) ? `+91${digits}` : digits;
  })
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number with country code.'));

export const indianMobileSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .transform((value) => value.replace(/^(?:\+?91)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.'))
  .transform((value) => `+91${value}`);

const syntheticDemoMobileSchema = z
  .string()
  .regex(/^\+9100000(?:0000[1-9]|0001\d|00020)$/);

export const otpRequestSchema = z.object({ phone: indianMobileSchema }).strict();
export const otpDemoRequestSchema = z
  .object({ phone: z.union([indianMobileSchema, syntheticDemoMobileSchema]) })
  .strict();
export const otpVerifySchema = z
  .object({
    phone: indianMobileSchema,
    otpRequestId: z.string().regex(/^[a-f\d]{24}$/i),
    code: z.string().regex(/^\d{6}$/),
    captchaToken: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const otpDemoVerifySchema = z
  .object({
    phone: z.union([indianMobileSchema, syntheticDemoMobileSchema]),
    otpRequestId: z.string().regex(/^[a-f\d]{24}$/i),
    code: z.string().regex(/^\d{6}$/),
    captchaToken: z.string().min(1).max(2048).optional(),
  })
  .strict();
const abhaMobileIdentifier = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^(?:\+?91)?[6-9]\d{9}$/.test(value), 'Enter a valid 10-digit Indian mobile number.')
  .transform((value) => value.replace(/^(?:\+?91)/, ''));
const abhaNumberIdentifier = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{14}$/, 'Enter a valid 14-digit ABHA number.'));
const abhaAddressIdentifier = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/, 'Enter a valid ABHA address.');
export const abhaInitiateSchema = z
  .object({
    loginType: z.enum(['mobile', 'abha-number', 'abha-address']),
    identifier: z.string().trim().min(1).max(100),
    authMethod: z.enum(['mobile-otp', 'aadhaar-otp', 'password']),
  })
  .strict()
  .superRefine((value, context) => {
    const schema =
      value.loginType === 'mobile'
        ? abhaMobileIdentifier
        : value.loginType === 'abha-number'
          ? abhaNumberIdentifier
          : abhaAddressIdentifier;
    const parsed = schema.safeParse(value.identifier);
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        path: ['identifier'],
        message: parsed.error.issues[0]?.message ?? 'Enter a valid sign-in identifier.',
      });
    }

    if (value.loginType === 'mobile' && value.authMethod !== 'mobile-otp') {
      context.addIssue({
        code: 'custom',
        path: ['authMethod'],
        message: 'Mobile sign-in requires a mobile OTP.',
      });
    }
    if (value.loginType === 'abha-number' && value.authMethod === 'password') {
      context.addIssue({
        code: 'custom',
        path: ['authMethod'],
        message: 'Use an OTP to sign in with an ABHA number.',
      });
    }
    if (value.loginType === 'abha-address' && value.authMethod === 'aadhaar-otp') {
      context.addIssue({
        code: 'custom',
        path: ['authMethod'],
        message: 'Choose mobile OTP or password for ABHA address sign-in.',
      });
    }
  })
  .transform((value) => ({
    ...value,
    identifier:
      value.loginType === 'mobile'
        ? abhaMobileIdentifier.parse(value.identifier)
        : value.loginType === 'abha-number'
          ? abhaNumberIdentifier.parse(value.identifier)
          : abhaAddressIdentifier.parse(value.identifier),
  }));
export const abhaVerifySchema = z
  .object({
    challengeId: z.string().regex(/^[a-f\d]{24}$/i),
    code: z.string().regex(/^\d{6}$/).optional(),
    password: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.code) !== Boolean(value.password), {
    message: 'Enter either the OTP or the password.',
  });
export const abhaSelectSchema = z
  .object({
    challengeId: z.string().regex(/^[a-f\d]{24}$/i),
    accountId: z.string().regex(/^\d{1,2}$/),
  })
  .strict();
export const staffLoginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(128),
    role: z
      .enum([
        'admin',
        'hospital_manager',
        'doctor',
        'specialist',
        'health_worker',
        'navigator',
        'district_officer',
      ])
      .optional(),
  })
  .strict();
export const patientLoginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
export const patientPasswordActivationSchema = z
  .object({
    activationCode: z.string().trim().min(16).max(64),
    newPassword: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  })
  .strict();
export const patientRegistrationRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: indianMobileSchema,
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
    password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  })
  .strict();
export const patientRegistrationDemoRequestSchema = patientRegistrationRequestSchema.extend({
  phone: z.union([indianMobileSchema, syntheticDemoMobileSchema]),
});
export const patientRegistrationVerifySchema = z
  .object({
    phone: indianMobileSchema,
    challengeId: z.string().regex(/^[a-f\d]{24}$/i),
    code: z.string().regex(/^\d{6}$/),
    captchaToken: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const patientRegistrationDemoVerifySchema = patientRegistrationVerifySchema.extend({
  phone: z.union([indianMobileSchema, syntheticDemoMobileSchema]),
});
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128).optional(),
    newPassword: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  })
  .strict();
export const forgotPasswordSchema = z
  .object({ identifier: z.string().trim().min(3).max(254) })
  .strict();
export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(256),
    newPassword: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  })
  .strict();
export const updateMeSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Provide at least one profile field to update.',
  );
export const changeRoleSchema = z
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
    ]),
  })
  .strict();
