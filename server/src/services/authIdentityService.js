import { AuthIdentity, User } from '../models/index.js';
import { hashToken } from './authCrypto.js';
import { ApiError } from '../utils/apiError.js';

const MOBILE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function identityProviderUserId(provider, identityType, value, environment) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('Authentication identity value is required.');
  }
  const normalized = value.trim().toLowerCase();
  return hashToken(`${provider}:${identityType}:${normalized}:${environment.JWT_REFRESH_SECRET}`);
}

export async function linkAuthIdentity({
  user,
  provider,
  identityType,
  providerUserId,
  verifiedAt = null,
  environment,
}) {
  const key = identityProviderUserId(provider, identityType, providerUserId, environment);
  const existing = await AuthIdentity.findOne({ provider, providerUserId: key }).select('userId');
  if (existing && existing.userId.toString() !== user._id.toString()) {
    throw new ApiError(409, 'AUTH_IDENTITY_ALREADY_LINKED', 'This sign-in identity is linked to another account.');
  }

  await AuthIdentity.updateOne(
    { provider, providerUserId: key },
    {
      $setOnInsert: { userId: user._id, provider, identityType, providerUserId: key },
      ...(verifiedAt ? { $set: { verifiedAt } } : {}),
      $unset: { migrationId: 1 },
    },
    { upsert: true },
  );
}

export async function resolveVerifiedMobile(verifiedMobile) {
  if (typeof verifiedMobile !== 'string' || !MOBILE_PATTERN.test(verifiedMobile)) {
    throw new ApiError(400, 'VERIFIED_MOBILE_REQUIRED', 'A verified mobile number is required to link this account.');
  }
  return User.findOne({ phone: verifiedMobile });
}
