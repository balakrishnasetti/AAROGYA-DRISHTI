import { ApiError } from '../utils/apiError.js';

export const AUTH_METHODS = Object.freeze(['manual', 'mobile_otp', 'abha', 'aadhaar_qr']);

export function validateNormalizedProfile(profile) {
  if (
    !profile ||
    typeof profile.providerUserId !== 'string' ||
    profile.providerUserId.length < 1 ||
    profile.providerUserId.length > 512
  ) {
    throw new ApiError(502, 'AUTH_PROVIDER_INVALID_PROFILE', 'The identity provider returned an invalid profile.');
  }

  if (
    profile.verifiedMobile !== undefined &&
    (typeof profile.verifiedMobile !== 'string' || !/^\+[1-9]\d{7,14}$/.test(profile.verifiedMobile))
  ) {
    throw new ApiError(502, 'AUTH_PROVIDER_INVALID_PROFILE', 'The identity provider returned an invalid profile.');
  }

  if (
    profile.yearOfBirth !== undefined &&
    (typeof profile.yearOfBirth !== 'string' || !/^\d{4}$/.test(profile.yearOfBirth))
  ) {
    throw new ApiError(502, 'AUTH_PROVIDER_INVALID_PROFILE', 'The identity provider returned an invalid profile.');
  }

  if (
    profile.gender !== undefined &&
    (typeof profile.gender !== 'string' || !['M', 'F', 'O', 'U'].includes(profile.gender))
  ) {
    throw new ApiError(502, 'AUTH_PROVIDER_INVALID_PROFILE', 'The identity provider returned an invalid profile.');
  }

  if (
    profile.abhaNumber !== undefined &&
    (typeof profile.abhaNumber !== 'string' || !/^\d{14}$/.test(profile.abhaNumber))
  ) {
    throw new ApiError(502, 'AUTH_PROVIDER_INVALID_PROFILE', 'The identity provider returned an invalid profile.');
  }

  if (
    profile.abhaAddress !== undefined &&
    (typeof profile.abhaAddress !== 'string' || profile.abhaAddress.length > 100)
  ) {
    throw new ApiError(502, 'AUTH_PROVIDER_INVALID_PROFILE', 'The identity provider returned an invalid profile.');
  }

  return {
    providerUserId: profile.providerUserId,
    ...(profile.verifiedMobile ? { verifiedMobile: profile.verifiedMobile } : {}),
    ...(typeof profile.displayName === 'string' ? { displayName: profile.displayName.slice(0, 120) } : {}),
    ...(profile.yearOfBirth ? { yearOfBirth: profile.yearOfBirth } : {}),
    ...(profile.gender ? { gender: profile.gender } : {}),
    ...(typeof profile.abhaNumber === 'string' ? { abhaNumber: profile.abhaNumber } : {}),
    ...(typeof profile.abhaAddress === 'string' ? { abhaAddress: profile.abhaAddress } : {}),
  };
}

export class AuthProvider {
  constructor(method) {
    if (!AUTH_METHODS.includes(method)) throw new TypeError('Unsupported authentication method.');
    this.method = method;
  }

  async initiate() {
    throw new Error(`${this.method} provider must implement initiate().`);
  }

  async verify() {
    throw new Error(`${this.method} provider must implement verify().`);
  }
}

export class AuthProviderRegistry {
  #providers = new Map();

  register(provider) {
    if (!provider || !AUTH_METHODS.includes(provider.method)) {
      throw new TypeError('Authentication provider has an unsupported method.');
    }
    if (typeof provider.initiate !== 'function' || typeof provider.verify !== 'function') {
      throw new TypeError('Authentication provider must implement initiate() and verify().');
    }
    if (this.#providers.has(provider.method)) {
      throw new Error(`Authentication provider "${provider.method}" is already registered.`);
    }
    this.#providers.set(provider.method, provider);
    return this;
  }

  get(method) {
    const provider = this.#providers.get(method);
    if (!provider) {
      throw new ApiError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'This sign-in method is not configured.');
    }
    return provider;
  }

  async initiate(method, input, context) {
    return this.get(method).initiate(input, context);
  }

  async verify(method, input, context) {
    return validateNormalizedProfile(await this.get(method).verify(input, context));
  }
}
