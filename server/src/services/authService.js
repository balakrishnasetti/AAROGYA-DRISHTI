import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ApiError } from '../utils/apiError.js';
import {
  DoctorProfile,
  AuthIdentity,
  Hospital,
  HospitalManager,
  AuthAuditLog,
  OtpLoginState,
  OtpRequest,
  PatientPasswordActivation,
  PatientRegistrationChallenge,
  PasswordResetToken,
  Patient,
  Session,
  User,
} from '../models/index.js';
import { hashOtp, hashToken } from './authCrypto.js';
import { createSession, rotateSession, signFlowToken } from './tokenService.js';
import { writeAuditLog } from './auditService.js';
import { consumeResetToken, isSyntheticDemoPatientPhone } from './authPolicy.js';
import { permissionsForRole } from '../security/rolePermissions.js';
import { doctorCanAccessWorkspace } from '../utils/providerEligibility.js';
import { identityProviderUserId, linkAuthIdentity } from './authIdentityService.js';
import {
  getOtpSendLimit,
  isOtpUsable,
  OTP_CAPTCHA_THRESHOLD,
  OTP_FAILURE_LIMIT,
  OTP_FAILURE_LOCKOUT_MS,
  OTP_LIFETIME_MS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_SEND_LIMIT,
  OTP_SEND_WINDOW_MS,
  otpLockIsActive,
} from './otpLoginPolicy.js';

const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password-for-timing-only', 12);

function safeEqualHex(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function hashedIdentifier(identifier) {
  return hashToken(identifier.toLowerCase());
}

function patientLoginQuery(identifier) {
  const compact = identifier.trim().replace(/[\s()-]/g, '');
  const clauses = [{ email: identifier.trim().toLowerCase() }];
  const localPhone = compact.replace(/^(?:\+?91)/, '');
  const normalizedPhone = /^\+[1-9]\d{7,14}$/.test(compact)
    ? compact
    : /^[6-9]\d{9}$/.test(localPhone)
      ? `+91${localPhone}`
      : null;
  if (normalizedPhone) clauses.push({ phone: normalizedPhone });
  return { $or: clauses };
}

function reject(status, code, message, details = null) {
  throw new ApiError(status, code, message, details);
}

async function ensureOtpLoginState(destinationHash) {
  try {
    await OtpLoginState.updateOne(
      { destinationHash },
      { $setOnInsert: { destinationHash, sendTimestamps: [], failedAttempts: 0 } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

async function reserveOtpSend(destinationHash, now) {
  await ensureOtpLoginState(destinationHash);
  let state = await OtpLoginState.findOne({ destinationHash }).select('+destinationHash').lean();
  if (otpLockIsActive(state, now)) {
    return {
      allowed: false,
      code: 'OTP_LOCKED',
      retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000),
    };
  }

  const limit = getOtpSendLimit(state?.sendTimestamps, now);
  if (!limit.allowed) {
    return {
      allowed: false,
      code: limit.reason === 'resend_cooldown' ? 'OTP_RESEND_COOLDOWN' : 'OTP_SEND_LIMIT',
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  const cutoff = new Date(now.getTime() - OTP_SEND_WINDOW_MS);
  const timestamps = { $ifNull: ['$sendTimestamps', []] };
  const recent = {
    $filter: {
      input: timestamps,
      as: 'sentAt',
      cond: { $gt: ['$$sentAt', cutoff] },
    },
  };
  const cooldownElapsed = {
    $or: [
      { $eq: [{ $size: timestamps }, 0] },
      { $lte: [{ $arrayElemAt: [timestamps, -1] }, new Date(now.getTime() - 30_000)] },
    ],
  };
  const reserved = await OtpLoginState.findOneAndUpdate(
    {
      destinationHash,
      $expr: {
        $and: [
          { $lt: [{ $size: recent }, OTP_SEND_LIMIT] },
          cooldownElapsed,
          { $lte: [{ $ifNull: ['$lockedUntil', new Date(0)] }, now] },
        ],
      },
    },
    [{ $set: { sendTimestamps: { $concatArrays: [recent, [now]] } } }],
    { new: true },
  );
  if (reserved) return { allowed: true };

  const current = await OtpLoginState.findOne({ destinationHash })
    .select('+destinationHash')
    .lean();
  if (otpLockIsActive(current, now)) {
    return {
      allowed: false,
      code: 'OTP_LOCKED',
      retryAfterSeconds: Math.ceil((current.lockedUntil - now) / 1000),
    };
  }
  const currentLimit = getOtpSendLimit(current?.sendTimestamps, now);
  return {
    allowed: false,
    code: currentLimit.reason === 'resend_cooldown' ? 'OTP_RESEND_COOLDOWN' : 'OTP_SEND_LIMIT',
    retryAfterSeconds: currentLimit.retryAfterSeconds,
  };
}

async function releaseOtpSend(destinationHash, reservedAt) {
  await OtpLoginState.updateOne({ destinationHash }, { $pull: { sendTimestamps: reservedAt } });
}

async function recordOtpFailure(destinationHash, now) {
  await ensureOtpLoginState(destinationHash);
  const cutoff = new Date(now.getTime() - OTP_FAILURE_LOCKOUT_MS);
  const windowExpired = {
    $lte: [{ $ifNull: ['$failureWindowStartedAt', new Date(0)] }, cutoff],
  };
  const attempts = {
    $add: [{ $cond: [windowExpired, 0, { $ifNull: ['$failedAttempts', 0] }] }, 1],
  };
  const updated = await OtpLoginState.findOneAndUpdate(
    { destinationHash, $expr: { $lte: [{ $ifNull: ['$lockedUntil', new Date(0)] }, now] } },
    [
      {
        $set: {
          failedAttempts: attempts,
          failureWindowStartedAt: {
            $cond: [windowExpired, now, '$failureWindowStartedAt'],
          },
        },
      },
      {
        $set: {
          lockedUntil: {
            $cond: [
              { $gte: ['$failedAttempts', OTP_FAILURE_LIMIT] },
              new Date(now.getTime() + OTP_FAILURE_LOCKOUT_MS),
              '$lockedUntil',
            ],
          },
        },
      },
    ],
    { new: true },
  );
  const failedAttempts = updated?.failedAttempts ?? OTP_FAILURE_LIMIT;
  const locked = otpLockIsActive(updated, now) || failedAttempts >= OTP_FAILURE_LIMIT;
  return {
    failedAttempts,
    locked,
    captchaRequired: failedAttempts >= OTP_CAPTCHA_THRESHOLD && !locked,
  };
}

async function verifyOtpCaptcha(token, req, environment, fetchImpl = globalThis.fetch) {
  if (environment.NODE_ENV === 'test' && token === 'test-captcha-token') return;
  if (!environment.TURNSTILE_SECRET_KEY || !environment.TURNSTILE_SITE_KEY) {
    reject(503, 'OTP_CAPTCHA_NOT_CONFIGURED', 'CAPTCHA verification is not configured.');
  }
  let response;
  try {
    response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: environment.TURNSTILE_SECRET_KEY,
        response: token,
        ...(req.ip ? { remoteip: req.ip } : {}),
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    reject(503, 'OTP_CAPTCHA_UNAVAILABLE', 'CAPTCHA verification is temporarily unavailable.');
  }
  if (!response.ok) {
    reject(503, 'OTP_CAPTCHA_UNAVAILABLE', 'CAPTCHA verification is temporarily unavailable.');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    reject(503, 'OTP_CAPTCHA_UNAVAILABLE', 'CAPTCHA verification is temporarily unavailable.');
  }
  if (result?.success !== true) {
    reject(400, 'OTP_CAPTCHA_INVALID', 'Complete the CAPTCHA and try again.');
  }
}

async function audit(req, fields) {
  await writeAuditLog({ requestId: req.id, ...fields });
  if (req.authMethod && ['login', 'login_failure'].includes(fields.action)) {
    await AuthAuditLog.create({
      userId: fields.actorId ?? null,
      method: req.authMethod,
      ip: req.ip,
      device: req.get?.('user-agent')?.slice(0, 500),
      result:
        fields.action === 'login'
          ? fields.metadata?.result === 'challenge'
            ? 'challenge'
            : 'success'
          : 'failure',
      occurredAt: new Date(),
    });
  }
}

function publicUser(user, hospitalId = null) {
  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email ?? null,
    phone: user.phone ?? null,
    role: user.role,
    permissions: permissionsForRole(user.role),
    hospitalId,
    district: user.district ?? null,
    mandal: user.mandal ?? null,
    phc: user.phc ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

export function createAuthService({
  environment,
  smsProvider,
  emailProvider,
  abhaProvider = null,
}) {
  async function completeAbhaLogin(profile, req) {
    const identityId = identityProviderUserId(
      'abha',
      'provider_subject',
      profile.providerUserId,
      environment,
    );
    const identity = await AuthIdentity.findOne({
      provider: 'abha',
      providerUserId: identityId,
    }).select('userId');
    const mobileUser = profile.verifiedMobile
      ? await User.findOne({ phone: profile.verifiedMobile })
      : null;
    let user = identity ? await User.findById(identity.userId) : mobileUser;

    if (
      identity &&
      (!user ||
        (mobileUser && mobileUser._id.toString() !== identity.userId.toString()) ||
        (profile.verifiedMobile && user.phone && user.phone !== profile.verifiedMobile))
    ) {
      reject(
        409,
        'AUTH_IDENTITY_ALREADY_LINKED',
        'This ABHA identity is linked to a different account.',
      );
    }

    if (!user) {
      try {
        user = await User.create({
          fullName: profile.displayName?.trim() || 'ABHA Patient',
          ...(profile.verifiedMobile ? { phone: profile.verifiedMobile } : {}),
          role: 'patient',
          status: 'active',
        });
      } catch (error) {
        if (error.code !== 11000 || !profile.verifiedMobile) throw error;
        user = await User.findOne({ phone: profile.verifiedMobile });
        if (!user) throw error;
      }
    }

    if (user.role !== 'patient' || user.status !== 'active') {
      await audit(req, {
        actorId: user._id,
        action: 'login_failure',
        resourceType: 'user',
        resourceId: user._id.toString(),
        metadata: { reason: 'account_unavailable' },
      });
      reject(403, 'ACCOUNT_UNAVAILABLE', 'This account cannot sign in. Contact support for help.');
    }

    await Patient.updateOne(
      { userId: user._id },
      {
        $setOnInsert: { preferredLanguage: 'te', userId: user._id },
        ...(profile.yearOfBirth || profile.gender
          ? {
              $set: {
                ...(profile.yearOfBirth ? { yearOfBirth: profile.yearOfBirth } : {}),
                ...(profile.gender
                  ? {
                      sexAtBirth: { M: 'male', F: 'female', O: 'other', U: 'undisclosed' }[
                        profile.gender
                      ],
                    }
                  : {}),
              },
            }
          : {}),
      },
      { upsert: true },
    );
    await linkAuthIdentity({
      user,
      provider: 'abha',
      identityType: 'provider_subject',
      providerUserId: profile.providerUserId,
      verifiedAt: new Date(),
      environment,
    });

    const session = await createSession(user, req, environment);
    user.lastLoginAt = new Date();
    await user.save();
    await audit(req, {
      actorId: user._id,
      action: 'login',
      resourceType: 'user',
      resourceId: user._id.toString(),
    });
    return {
      ...session,
      user: {
        ...publicUser(user),
        ...(profile.abhaNumber
          ? { abhaNumberMasked: `XX-XXXX-XXXX-${profile.abhaNumber.slice(-4)}` }
          : {}),
        ...(profile.abhaAddress ? { abhaAddress: profile.abhaAddress } : {}),
      },
    };
  }

  return {
    async initiateAbha(input) {
      if (!abhaProvider) {
        reject(503, 'ABHA_NOT_CONFIGURED', 'ABHA sign-in is not enabled.');
      }
      return abhaProvider.initiate(input);
    },

    async verifyAbha(input, req) {
      if (!abhaProvider) {
        reject(503, 'ABHA_NOT_CONFIGURED', 'ABHA sign-in is not enabled.');
      }
      let result;
      try {
        result = await abhaProvider.verify(input);
      } catch (error) {
        await audit(req, {
          action: 'login_failure',
          resourceType: 'auth_provider',
          metadata: { reason: error.code ?? 'abha_auth_failed' },
        });
        throw error;
      }
      if (result.accountSelectionRequired) return result;
      return completeAbhaLogin(result, req);
    },

    async selectAbhaAccount(input, req) {
      if (!abhaProvider) {
        reject(503, 'ABHA_NOT_CONFIGURED', 'ABHA sign-in is not enabled.');
      }
      let profile;
      try {
        profile = await abhaProvider.selectAccount(input);
      } catch (error) {
        await audit(req, {
          action: 'login_failure',
          resourceType: 'auth_provider',
          metadata: { reason: error.code ?? 'abha_auth_failed' },
        });
        throw error;
      }
      return completeAbhaLogin(profile, req);
    },

    async requestOtp(phone, req) {
      const now = new Date();
      const destinationHash = hashToken(`${phone}:${environment.JWT_REFRESH_SECRET}`);
      const reservation = await reserveOtpSend(destinationHash, now);
      if (!reservation.allowed) {
        const status = reservation.code === 'OTP_LOCKED' ? 423 : 429;
        const message =
          reservation.code === 'OTP_LOCKED'
            ? 'Too many incorrect codes. Try again in 15 minutes.'
            : 'Please wait before requesting another code.';
        await audit(req, {
          action: 'login_failure',
          resourceType: 'otp',
          metadata: {
            identifierHash: hashedIdentifier(phone),
            reason: reservation.code.toLowerCase(),
          },
        });
        reject(status, reservation.code, message, {
          retryAfterSeconds: reservation.retryAfterSeconds,
        });
      }

      await OtpRequest.updateMany(
        { destinationHash, purpose: 'login', consumedAt: null },
        { $set: { consumedAt: now } },
      );
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const demoOtpEnabled =
        environment.NODE_ENV === 'development' &&
        smsProvider.deliveryMode === 'development_console';
      const syntheticAccount = demoOtpEnabled && isSyntheticDemoPatientPhone(phone);
      const otpRequest = await OtpRequest.create({
        destinationHash,
        codeHash: hashOtp(phone, code, environment.JWT_ACCESS_SECRET),
        purpose: 'login',
        expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
        attempts: 0,
        isSynthetic: syntheticAccount,
      });

      try {
        await smsProvider.sendOtp(phone, code);
      } catch {
        await OtpRequest.updateOne({ _id: otpRequest._id }, { $set: { consumedAt: new Date() } });
        reject(503, 'SMS_UNAVAILABLE', 'We could not send a code. Please try again later.');
      }

      return {
        otpRequestId: otpRequest._id,
        expiresInSeconds: OTP_LIFETIME_MS / 1000,
        deliveryMode: smsProvider.deliveryMode,
        ...(demoOtpEnabled && syntheticAccount ? { developmentCode: code } : {}),
      };
    },

    async verifyOtp({ phone, otpRequestId, code, captchaToken }, req) {
      const destinationHash = hashToken(`${phone}:${environment.JWT_REFRESH_SECRET}`);
      const now = new Date();
      let state = await OtpLoginState.findOne({ destinationHash })
        .select('+destinationHash')
        .lean();
      if (otpLockIsActive(state, now)) {
        reject(423, 'OTP_LOCKED', 'Too many incorrect codes. Try again in 15 minutes.', {
          retryAfterSeconds: Math.ceil(
            (new Date(state.lockedUntil).getTime() - now.getTime()) / 1000,
          ),
        });
      }
      if (
        state?.failureWindowStartedAt &&
        new Date(state.failureWindowStartedAt).getTime() <= now.getTime() - OTP_FAILURE_LOCKOUT_MS
      ) {
        await OtpLoginState.updateOne(
          { destinationHash },
          { $set: { failedAttempts: 0 }, $unset: { failureWindowStartedAt: 1, lockedUntil: 1 } },
        );
        state = { ...state, failedAttempts: 0, failureWindowStartedAt: null, lockedUntil: null };
      }

      if ((state?.failedAttempts ?? 0) >= OTP_CAPTCHA_THRESHOLD) {
        if (!captchaToken) {
          reject(
            428,
            'OTP_CAPTCHA_REQUIRED',
            'Complete the CAPTCHA before verifying another code.',
            { siteKey: environment.TURNSTILE_SITE_KEY ?? '' },
          );
        }
        await verifyOtpCaptcha(captchaToken, req, environment);
      }

      const otpRequest = await OtpRequest.findOne({
        _id: otpRequestId,
        destinationHash,
        purpose: 'login',
        consumedAt: null,
      }).select('+codeHash');

      if (!isOtpUsable(otpRequest, now)) {
        await audit(req, {
          action: 'login_failure',
          resourceType: 'otp',
          metadata: { identifierHash: hashedIdentifier(phone), reason: 'expired_or_unavailable' },
        });
        reject(
          401,
          'OTP_INVALID',
          'This code has expired or cannot be used. Request a new code and try again.',
        );
      }

      const candidate = hashOtp(phone, code, environment.JWT_ACCESS_SECRET);
      if (!safeEqualHex(otpRequest.codeHash, candidate)) {
        await OtpRequest.findOneAndUpdate(
          { _id: otpRequest._id, consumedAt: null, attempts: { $lt: OTP_FAILURE_LIMIT } },
          { $inc: { attempts: 1 } },
          { new: true },
        );
        const attempt = await recordOtpFailure(destinationHash, now);
        if (attempt.locked) {
          await OtpRequest.updateMany(
            { destinationHash, purpose: 'login', consumedAt: null },
            { $set: { consumedAt: now } },
          );
        }
        await audit(req, {
          action: 'login_failure',
          resourceType: 'otp',
          metadata: { identifierHash: hashedIdentifier(phone), reason: 'incorrect_code' },
        });
        if (attempt.locked) {
          reject(423, 'OTP_LOCKED', 'Too many incorrect codes. Try again in 15 minutes.', {
            retryAfterSeconds: Math.ceil(OTP_FAILURE_LOCKOUT_MS / 1000),
          });
        }
        if (attempt.captchaRequired) {
          reject(
            428,
            'OTP_CAPTCHA_REQUIRED',
            'Complete the CAPTCHA before verifying another code.',
            { siteKey: environment.TURNSTILE_SITE_KEY ?? '' },
          );
        }
        reject(401, 'OTP_INVALID', 'That code is not correct. Check it and try again.');
      }

      const consumed = await OtpRequest.findOneAndUpdate(
        {
          _id: otpRequest._id,
          consumedAt: null,
          expiresAt: { $gt: now },
          attempts: { $lt: OTP_FAILURE_LIMIT },
        },
        { $set: { consumedAt: now } },
        { new: true },
      );
      if (!consumed)
        reject(401, 'OTP_INVALID', 'This code was already used. Request a new code and try again.');
      await OtpLoginState.updateOne(
        { destinationHash },
        { $set: { failedAttempts: 0 }, $unset: { failureWindowStartedAt: 1, lockedUntil: 1 } },
      );

      let user = await User.findOne({ phone });
      if (!user) {
        const isSyntheticDemoAccount =
          environment.NODE_ENV === 'development' &&
          environment.SEED_DEMO === true &&
          smsProvider.deliveryMode === 'development_console' &&
          isSyntheticDemoPatientPhone(phone);
        try {
          user = await User.create({
            fullName: isSyntheticDemoAccount
              ? `Synthetic Demo Patient ${phone.slice(-2)}`
              : `Patient ${phone.slice(-4)}`,
            phone,
            role: 'patient',
            status: 'active',
            isSynthetic: isSyntheticDemoAccount,
          });
          await Patient.create({
            userId: user._id,
            preferredLanguage: 'te',
            isSynthetic: isSyntheticDemoAccount,
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
          user = await User.findOne({ phone });
        }
      }

      if (!user || user.role !== 'patient' || user.status !== 'active') {
        await audit(req, {
          actorId: user?._id,
          action: 'login_failure',
          resourceType: 'user',
          resourceId: user?._id?.toString(),
          metadata: { reason: 'account_unavailable' },
        });
        reject(
          403,
          'ACCOUNT_UNAVAILABLE',
          'This account cannot sign in. Contact support for help.',
        );
      }
      await Patient.updateOne(
        { userId: user._id },
        { $setOnInsert: { preferredLanguage: 'te', userId: user._id } },
        { upsert: true },
      );

      await linkAuthIdentity({
        user,
        provider: 'mobile_otp',
        identityType: 'phone',
        providerUserId: phone,
        verifiedAt: new Date(),
        environment,
      });
      const session = await createSession(user, req, environment);
      user.lastLoginAt = new Date();
      await user.save();
      await audit(req, {
        actorId: user._id,
        action: 'login',
        resourceType: 'user',
        resourceId: user._id.toString(),
      });
      return { ...session, user: publicUser(user) };
    },

    async patientLogin({ identifier, password }, req) {
      const user = await User.findOne({
        ...patientLoginQuery(identifier),
        role: 'patient',
      }).select('+passwordHash');

      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        await audit(req, {
          actorId: user._id,
          action: 'login_failure',
          resourceType: 'user',
          resourceId: user._id.toString(),
          metadata: { reason: 'account_locked' },
        });
        reject(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      }

      if (user?.lockedUntil && user.lockedUntil <= new Date()) {
        user.lockedUntil = undefined;
        user.failedLoginAttempts = 0;
        await user.save();
      }

      const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !matches || user.status !== 'active') {
        if (user) {
          const updated = await User.findOneAndUpdate(
            { _id: user._id, failedLoginAttempts: { $lt: 5 } },
            { $inc: { failedLoginAttempts: 1 } },
            { new: true },
          );
          if (updated?.failedLoginAttempts >= 5) {
            await User.updateOne(
              { _id: user._id },
              { $set: { lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_MS) } },
            );
          }
        }
        await audit(req, {
          actorId: user?._id,
          action: 'login_failure',
          resourceType: 'user',
          resourceId: user?._id?.toString(),
          metadata: { identifierHash: hashedIdentifier(identifier), reason: 'invalid_credentials' },
        });
        reject(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      }

      const normalizedIdentifier = identifier.trim().replace(/[\s()-]/g, '');
      const phone = normalizedIdentifier.replace(/^(?:\+?91)/, '');
      const identityType =
        /^\+[1-9]\d{7,14}$/.test(normalizedIdentifier) || /^[6-9]\d{9}$/.test(phone)
          ? 'phone'
          : 'email';
      const providerUserId =
        identityType === 'phone'
          ? /^\+[1-9]\d{7,14}$/.test(normalizedIdentifier)
            ? normalizedIdentifier
            : `+91${phone}`
          : identifier.trim().toLowerCase();
      await linkAuthIdentity({
        user,
        provider: 'manual',
        identityType,
        providerUserId,
        ...(identityType === 'phone' || user.emailVerified ? { verifiedAt: new Date() } : {}),
        environment,
      });
      user.failedLoginAttempts = 0;
      user.lastLoginAt = new Date();
      await user.save();
      const session = await createSession(user, req, environment);
      await audit(req, {
        actorId: user._id,
        action: 'login',
        resourceType: 'user',
        resourceId: user._id.toString(),
      });
      return { ...session, user: publicUser(user) };
    },

    async requestPatientRegistrationOtp({ fullName, phone, email, password }, req) {
      const now = new Date();
      const destinationHash = hashToken(`${phone}:${environment.JWT_REFRESH_SECRET}`);
      const reservation = await reserveOtpSend(destinationHash, now);
      if (!reservation.allowed) {
        const status = reservation.code === 'OTP_LOCKED' ? 423 : 429;
        await audit(req, {
          action: 'login_failure',
          resourceType: 'patient_registration',
          metadata: {
            identifierHash: hashedIdentifier(phone),
            reason: reservation.code.toLowerCase(),
          },
        });
        reject(status, reservation.code, 'Please wait before requesting another code.', {
          retryAfterSeconds: reservation.retryAfterSeconds,
        });
      }

      await PatientRegistrationChallenge.updateMany(
        { destinationHash, consumedAt: null },
        { $set: { consumedAt: now } },
      );
      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const demoOtpEnabled =
        environment.NODE_ENV === 'development' &&
        smsProvider.deliveryMode === 'development_console';
      const localRegistrationOtpEnabled =
        demoOtpEnabled && environment.DEV_PATIENT_REGISTRATION_OTP === true;
      const syntheticAccount = demoOtpEnabled && isSyntheticDemoPatientPhone(phone);
      const challenge = await PatientRegistrationChallenge.create({
        fullName,
        phone,
        ...(email ? { email } : {}),
        passwordHash: await bcrypt.hash(password, 12),
        destinationHash,
        codeHash: hashOtp(phone, code, environment.JWT_ACCESS_SECRET),
        attempts: 0,
        expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
        isSynthetic: syntheticAccount,
      });

      try {
        await smsProvider.sendOtp(phone, code);
      } catch {
        await releaseOtpSend(destinationHash, now);
        await PatientRegistrationChallenge.updateOne(
          { _id: challenge._id },
          { $set: { consumedAt: new Date() } },
        );
        reject(503, 'SMS_UNAVAILABLE', 'We could not send a code. Please try again later.');
      }

      return {
        challengeId: challenge._id,
        expiresInSeconds: OTP_LIFETIME_MS / 1000,
        deliveryMode: smsProvider.deliveryMode,
        ...(localRegistrationOtpEnabled || syntheticAccount ? { developmentCode: code } : {}),
      };
    },

    async verifyPatientRegistrationOtp({ phone, challengeId, code, captchaToken }, req) {
      const destinationHash = hashToken(`${phone}:${environment.JWT_REFRESH_SECRET}`);
      const now = new Date();
      let state = await OtpLoginState.findOne({ destinationHash })
        .select('+destinationHash')
        .lean();
      if (otpLockIsActive(state, now)) {
        reject(423, 'OTP_LOCKED', 'Too many incorrect codes. Try again in 15 minutes.', {
          retryAfterSeconds: Math.ceil(
            (new Date(state.lockedUntil).getTime() - now.getTime()) / 1000,
          ),
        });
      }
      if (
        state?.failureWindowStartedAt &&
        new Date(state.failureWindowStartedAt).getTime() <= now.getTime() - OTP_FAILURE_LOCKOUT_MS
      ) {
        await OtpLoginState.updateOne(
          { destinationHash },
          { $set: { failedAttempts: 0 }, $unset: { failureWindowStartedAt: 1, lockedUntil: 1 } },
        );
        state = { ...state, failedAttempts: 0, failureWindowStartedAt: null, lockedUntil: null };
      }
      if ((state?.failedAttempts ?? 0) >= OTP_CAPTCHA_THRESHOLD) {
        if (!captchaToken) {
          reject(
            428,
            'OTP_CAPTCHA_REQUIRED',
            'Complete the CAPTCHA before verifying another code.',
            { siteKey: environment.TURNSTILE_SITE_KEY ?? '' },
          );
        }
        await verifyOtpCaptcha(captchaToken, req, environment);
      }

      const challenge = await PatientRegistrationChallenge.findOne({
        _id: challengeId,
        destinationHash,
        consumedAt: null,
      }).select('+fullName +phone +email +passwordHash +destinationHash +codeHash');
      if (!isOtpUsable(challenge, now)) {
        reject(401, 'OTP_INVALID', 'This code has expired or cannot be used. Request a new code.');
      }

      const candidate = hashOtp(phone, code, environment.JWT_ACCESS_SECRET);
      if (!safeEqualHex(challenge.codeHash, candidate)) {
        await PatientRegistrationChallenge.findOneAndUpdate(
          { _id: challenge._id, consumedAt: null, attempts: { $lt: OTP_FAILURE_LIMIT } },
          { $inc: { attempts: 1 } },
          { new: true },
        );
        const attempt = await recordOtpFailure(destinationHash, now);
        await audit(req, {
          action: 'login_failure',
          resourceType: 'patient_registration',
          metadata: { identifierHash: hashedIdentifier(phone), reason: 'incorrect_code' },
        });
        if (attempt.locked) {
          await PatientRegistrationChallenge.updateMany(
            { destinationHash, consumedAt: null },
            { $set: { consumedAt: now } },
          );
          reject(423, 'OTP_LOCKED', 'Too many incorrect codes. Try again in 15 minutes.', {
            retryAfterSeconds: Math.ceil(OTP_FAILURE_LOCKOUT_MS / 1000),
          });
        }
        if (attempt.captchaRequired) {
          reject(
            428,
            'OTP_CAPTCHA_REQUIRED',
            'Complete the CAPTCHA before verifying another code.',
            { siteKey: environment.TURNSTILE_SITE_KEY ?? '' },
          );
        }
        reject(401, 'OTP_INVALID', 'That code is not correct. Check it and try again.');
      }

      const consumed = await PatientRegistrationChallenge.findOneAndUpdate(
        { _id: challenge._id, consumedAt: null, expiresAt: { $gt: now } },
        { $set: { consumedAt: now } },
        { new: true },
      );
      if (!consumed) reject(401, 'OTP_INVALID', 'This code was already used. Request a new code.');

      const emailOwner = challenge.email
        ? await User.findOne({ email: challenge.email }).select('_id').lean()
        : null;
      let user = await User.findOne({ phone }).select('+passwordHash');
      if (emailOwner && emailOwner._id.toString() !== user?._id.toString()) {
        reject(
          409,
          'PATIENT_REGISTRATION_UNAVAILABLE',
          'This patient account could not be created.',
        );
      }
      if (user && (user.role !== 'patient' || user.status !== 'active' || user.passwordHash)) {
        reject(
          409,
          'PATIENT_REGISTRATION_UNAVAILABLE',
          'This patient account could not be created.',
        );
      }

      try {
        if (user) {
          user.passwordHash = challenge.passwordHash;
          user.fullName = challenge.fullName;
          if (!user.email && challenge.email) user.email = challenge.email;
          user.failedLoginAttempts = 0;
          user.lockedUntil = undefined;
          await user.save();
        } else {
          [user] = await User.create([
            {
              fullName: challenge.fullName,
              phone,
              ...(challenge.email ? { email: challenge.email } : {}),
              emailVerified: false,
              role: 'patient',
              status: 'active',
              passwordHash: challenge.passwordHash,
              isSynthetic: challenge.isSynthetic === true,
            },
          ]);
        }
        await Patient.updateOne(
          { userId: user._id },
          { $setOnInsert: { preferredLanguage: 'te', userId: user._id } },
          { upsert: true },
        );
      } catch (error) {
        if (error.code === 11000) {
          reject(
            409,
            'PATIENT_REGISTRATION_UNAVAILABLE',
            'This patient account could not be created.',
          );
        }
        throw error;
      }

      await OtpLoginState.updateOne(
        { destinationHash },
        { $set: { failedAttempts: 0 }, $unset: { failureWindowStartedAt: 1, lockedUntil: 1 } },
      );
      await audit(req, {
        actorId: user._id,
        action: 'create',
        resourceType: 'patient_account',
        resourceId: user._id.toString(),
        metadata: { registration: 'verified_mobile' },
      });
      return { user: publicUser(user) };
    },

    async activatePatientPassword({ activationCode, newPassword }, req) {
      const now = new Date();
      const activation = await PatientPasswordActivation.findOneAndUpdate(
        {
          tokenHash: hashToken(activationCode),
          consumedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { consumedAt: now } },
        { new: true },
      ).select('userId');
      if (!activation) {
        reject(
          400,
          'PATIENT_PASSWORD_ACTIVATION_INVALID',
          'This patient setup code is invalid or expired. Ask your health worker for a new one.',
        );
      }

      const user = await User.findOne({
        _id: activation.userId,
        role: 'patient',
        status: 'active',
      }).select('+passwordHash');
      if (!user) {
        reject(
          400,
          'PATIENT_PASSWORD_ACTIVATION_INVALID',
          'This patient setup code is unavailable.',
        );
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.mustChangePassword = false;
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();
      await Session.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: now } });
      await PatientPasswordActivation.updateMany(
        { userId: user._id, consumedAt: null },
        { $set: { consumedAt: now } },
      );
      await audit(req, {
        actorId: user._id,
        action: 'password_change',
        resourceType: 'user',
        resourceId: user._id.toString(),
        metadata: { stage: 'patient_activation' },
      });
    },

    async staffLogin({ identifier, password, role }, req) {
      const normalizedIdentifier = identifier.toLowerCase();
      const query = /^[a-f\d]{24}$/i.test(identifier)
        ? { _id: identifier }
        : {
            $or: [
              { staffId: identifier.toUpperCase() },
              { email: normalizedIdentifier },
              { phone: identifier },
            ],
          };
      const user = await User.findOne({
        ...query,
        role: role ?? {
          $in: [
            'admin',
            'hospital_manager',
            'doctor',
            'health_worker',
            'navigator',
            'district_officer',
          ],
        },
      }).select('+passwordHash');

      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        await audit(req, {
          actorId: user._id,
          action: 'login_failure',
          resourceType: 'user',
          resourceId: user._id.toString(),
          metadata: { reason: 'account_locked' },
        });
        reject(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      }

      if (user?.lockedUntil && user.lockedUntil <= new Date()) {
        user.lockedUntil = undefined;
        user.failedLoginAttempts = 0;
        await user.save();
      }

      const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !matches || user.status !== 'active') {
        if (user) {
          const updated = await User.findOneAndUpdate(
            { _id: user._id, failedLoginAttempts: { $lt: 5 } },
            { $inc: { failedLoginAttempts: 1 } },
            { new: true },
          );
          if (updated?.failedLoginAttempts >= 5) {
            await User.updateOne(
              { _id: user._id },
              { $set: { lockedUntil: new Date(Date.now() + LOGIN_LOCKOUT_MS) } },
            );
          }
        }
        await audit(req, {
          actorId: user?._id,
          action: 'login_failure',
          resourceType: 'user',
          resourceId: user?._id?.toString(),
          metadata: { identifierHash: hashedIdentifier(identifier), reason: 'invalid_credentials' },
        });
        reject(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      }

      const identityType = identifier.includes('@')
        ? 'email'
        : /^\+[1-9]\d{7,14}$/.test(identifier)
          ? 'phone'
          : 'staff_id';
      await linkAuthIdentity({
        user,
        provider: 'manual',
        identityType,
        providerUserId: identifier,
        verifiedAt: new Date(),
        environment,
      });
      user.failedLoginAttempts = 0;

      if (user.mustChangePassword) {
        await user.save();
        await audit(req, {
          actorId: user._id,
          action: 'login',
          resourceType: 'user',
          resourceId: user._id.toString(),
          metadata: { result: 'challenge' },
        });
        return {
          flow: 'password_change',
          flowToken: signFlowToken(user._id, 'password_change', environment),
        };
      }

      const hospitalId = await this.getHospitalId(user);
      const session = await createSession(user, req, environment);
      user.lastLoginAt = new Date();
      await user.save();
      await audit(req, {
        actorId: user._id,
        action: 'login',
        resourceType: 'user',
        resourceId: user._id.toString(),
        metadata: { result: 'success' },
      });
      return { ...session, user: publicUser(user, hospitalId) };
    },

    async getHospitalId(user) {
      if (user.role === 'hospital_manager') {
        const managerLink = await HospitalManager.findOne({
          managerId: user._id,
          active: true,
        }).select('hospitalId');
        if (!managerLink)
          reject(
            403,
            'HOSPITAL_NOT_ASSIGNED',
            'Your account is not assigned to a hospital. Contact an administrator.',
          );
        const hospital = await Hospital.findOne({
          _id: managerLink.hospitalId,
          status: 'active',
        }).select('_id');
        if (!hospital)
          reject(
            403,
            'HOSPITAL_INACTIVE',
            'Your hospital is not active. Contact an administrator.',
          );
        return managerLink.hospitalId;
      }
      if (['doctor', 'specialist'].includes(user.role)) {
        const profile = await DoctorProfile.findOne({ userId: user._id }).select(
          'hospitalId verificationStatus isSynthetic demoLoginEnabled',
        );
        if (!profile)
          reject(
            403,
            'DOCTOR_NOT_VERIFIED',
            'Your profile is not verified yet. Contact your hospital manager.',
          );
        const hospital = await Hospital.findOne({
          _id: profile.hospitalId,
          status: 'active',
        }).select('_id status isSynthetic');
        if (!hospital)
          reject(
            403,
            'HOSPITAL_INACTIVE',
            'Your hospital is not active. Contact an administrator.',
          );
        if (!doctorCanAccessWorkspace({ user, profile, hospital, environment }))
          reject(
            403,
            'DOCTOR_NOT_VERIFIED',
            'Your profile is not verified yet. Contact your hospital manager.',
          );
        return profile.hospitalId;
      }
      return null;
    },

    async refresh(refreshToken, req) {
      const rotated = await rotateSession(refreshToken, req, environment);
      if (!rotated)
        reject(401, 'REFRESH_INVALID', 'Your session has expired. Sign in again to continue.');
      const hospitalId = await this.getHospitalId(rotated.user);
      return { ...rotated, user: publicUser(rotated.user, hospitalId) };
    },

    async logout(userId, sessionId, req) {
      await Session.updateOne(
        { _id: sessionId, userId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      await audit(req, {
        actorId: userId,
        action: 'logout',
        resourceType: 'session',
        resourceId: sessionId,
      });
    },

    async changePassword(userId, { currentPassword, newPassword }, isFlow, req) {
      const user = await User.findById(userId).select('+passwordHash');
      if (!user || user.status !== 'active')
        reject(404, 'USER_NOT_FOUND', 'Sign in again and retry.');
      if (
        !isFlow &&
        (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash ?? '')))
      ) {
        await audit(req, {
          actorId: user._id,
          action: 'login_failure',
          resourceType: 'password_change',
          resourceId: user._id.toString(),
          metadata: { reason: 'invalid_current_password' },
        });
        reject(
          401,
          'CURRENT_PASSWORD_INVALID',
          'The current password is not correct. Check it and try again.',
        );
      }

      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.mustChangePassword = false;
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();
      await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      await audit(req, {
        actorId: userId,
        action: 'password_change',
        resourceType: 'user',
        resourceId: userId,
      });
    },

    async forgotPassword(identifier, req) {
      const user = await User.findOne({
        $or: [
          { staffId: identifier.toUpperCase() },
          { email: identifier.toLowerCase() },
          { phone: identifier },
        ],
        role: {
          $in: [
            'admin',
            'hospital_manager',
            'doctor',
            'health_worker',
            'navigator',
            'district_officer',
          ],
        },
      }).select('email');
      if (!user?.email) {
        await audit(req, {
          action: 'login_failure',
          resourceType: 'password_reset',
          metadata: { identifierHash: hashedIdentifier(identifier), reason: 'account_unavailable' },
        });
        return;
      }

      const token = randomBytes(32).toString('base64url');
      await PasswordResetToken.updateMany(
        { userId: user._id, consumedAt: null },
        { $set: { consumedAt: new Date() } },
      );
      const resetToken = await PasswordResetToken.create({
        userId: user._id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        isSynthetic: user.isSynthetic === true,
      });
      const link = `${environment.CLIENT_URL}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await emailProvider.sendPasswordReset(user.email, link);
      } catch {
        await PasswordResetToken.updateOne(
          { _id: resetToken._id },
          { $set: { consumedAt: new Date() } },
        );
        reject(
          503,
          'RECOVERY_UNAVAILABLE',
          'We could not send a reset link. Please try again later.',
        );
      }
      await audit(req, {
        actorId: user._id,
        action: 'password_change',
        resourceType: 'password_reset',
        resourceId: user._id.toString(),
        metadata: { stage: 'requested' },
      });
    },

    async resetPassword(token, newPassword, req) {
      const tokenHash = hashToken(token);
      const reset = await consumeResetToken(PasswordResetToken, tokenHash);
      if (!reset) {
        await audit(req, {
          action: 'login_failure',
          resourceType: 'password_reset',
          metadata: { tokenHash: hashToken(token), reason: 'expired_or_used' },
        });
        reject(
          400,
          'RESET_TOKEN_INVALID',
          'This reset link has expired or was already used. Request a new link.',
        );
      }

      const user = await User.findById(reset.userId);
      if (
        !user ||
        ![
          'admin',
          'hospital_manager',
          'doctor',
          'health_worker',
          'navigator',
          'district_officer',
        ].includes(user.role)
      ) {
        reject(400, 'RESET_TOKEN_INVALID', 'This reset link is unavailable. Request a new link.');
      }
      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.mustChangePassword = false;
      user.failedLoginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();
      await Session.updateMany(
        { userId: user._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      await PasswordResetToken.updateMany(
        { userId: user._id, consumedAt: null },
        { $set: { consumedAt: new Date() } },
      );
      await audit(req, {
        actorId: user._id,
        action: 'password_change',
        resourceType: 'user',
        resourceId: user._id.toString(),
        metadata: { stage: 'reset' },
      });
    },

    async getMe(user, req) {
      await audit(req, {
        actorId: user._id,
        action: 'read',
        resourceType: 'user',
        resourceId: user._id.toString(),
        hospitalId: user.hospitalId,
      });
      return publicUser(user, user.hospitalId);
    },

    async updateMe(userId, updates, req) {
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true, runValidators: true },
      );
      if (!user) reject(404, 'USER_NOT_FOUND', 'Sign in again and retry.');
      await audit(req, {
        actorId: user._id,
        action: 'edit',
        resourceType: 'user',
        resourceId: user._id.toString(),
      });
      return publicUser(user, req.user.hospitalId);
    },

    async listSessions(userId, currentSessionId, req) {
      await audit(req, { actorId: userId, action: 'read', resourceType: 'sessions' });
      const sessions = await Session.find({
        userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
        .select('userAgent createdAt lastUsedAt expiresAt')
        .sort({ createdAt: -1 })
        .lean();
      return sessions.map((session) => ({
        id: session._id,
        userAgent: session.userAgent ?? '',
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        current: session._id.toString() === currentSessionId,
      }));
    },

    async revokeSession(userId, sessionId, req) {
      const session = await Session.findOneAndUpdate(
        { _id: sessionId, userId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      if (!session)
        reject(
          404,
          'SESSION_NOT_FOUND',
          'That active session was not found. Refresh the list and try again.',
        );
      await audit(req, {
        actorId: userId,
        action: 'logout',
        resourceType: 'session',
        resourceId: sessionId,
      });
    },

    async changeRole(actor, targetUserId, role, req) {
      const target = await User.findById(targetUserId);
      if (!target)
        reject(404, 'USER_NOT_FOUND', 'That user was not found. Check the ID and try again.');
      const oldRole = target.role;
      target.role = role;
      await target.save();
      await Session.updateMany(
        { userId: target._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      await audit(req, {
        actorId: actor._id,
        action: 'role_change',
        resourceType: 'user',
        resourceId: target._id.toString(),
        metadata: { previousRole: oldRole, newRole: role },
      });
      return publicUser(target);
    },
  };
}

export {
  OTP_LIFETIME_MS,
  OTP_FAILURE_LIMIT as OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  LOGIN_LOCKOUT_MS,
};
