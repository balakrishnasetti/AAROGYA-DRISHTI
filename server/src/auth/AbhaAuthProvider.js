import { constants, createPublicKey, randomUUID, publicEncrypt } from 'node:crypto';
import { ApiError } from '../utils/apiError.js';
import { AbhaLoginChallenge } from '../models/index.js';
import { decryptSecret, encryptSecret } from '../services/authCrypto.js';
import { AuthProvider, validateNormalizedProfile } from './AuthProvider.js';

const ABHA_V3_PATH = '/abha/api/v3';
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const TOKEN_RETRY_LIMIT = 1;
const PASSWORD_SCOPE = ['abha-address-login', 'password-verify'];
const OTP_SCOPES = {
  mobile: ['abha-login', 'mobile-verify'],
  abhaNumberMobile: ['abha-login', 'mobile-verify'],
  abhaNumberAadhaar: ['abha-login', 'aadhaar-verify'],
  abhaAddress: ['abha-address-login', 'mobile-verify'],
};

function providerError(status, code, message) {
  return new ApiError(status, code, message);
}

function upstreamError(response, payload, operation) {
  const errorCode = String(payload?.error?.code ?? payload?.code ?? '');
  const errorText = `${errorCode} ${payload?.error?.message ?? payload?.message ?? ''}`.toLowerCase();

  if (
    errorCode.includes('1017') ||
    (operation === 'verify' && /txn|transaction/.test(errorText) && /invalid|expired/.test(errorText))
  ) {
    return providerError(410, 'ABHA_CHALLENGE_EXPIRED', 'This ABHA sign-in attempt expired. Start again.');
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
  }
  if (operation === 'verify' && [400, 401, 422].includes(response.status)) {
    if (errorCode === '900901' || errorCode === '900902') {
      return providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
    }
    return providerError(401, 'ABHA_CREDENTIALS_INVALID', 'The ABHA sign-in details could not be verified.');
  }
  if (response.status === 401 || response.status === 403) {
    return providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
  }
  return providerError(400, 'ABHA_REQUEST_INVALID', 'The ABHA sign-in request could not be completed.');
}

function getAbhaAddress(account) {
  return account?.abhaAddress ?? account?.preferredAbhaAddress ?? '';
}

function getAbhaNumber(account) {
  const value = account?.abhaNumber ?? account?.ABHANumber ?? '';
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

export function maskAbhaNumber(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length === 14 ? `XX-XXXX-XXXX-${digits.slice(-4)}` : '';
}

function maskAccount(account, index) {
  return {
    id: String(index),
    name: String(account?.fullName ?? account?.name ?? '').slice(0, 120),
    abhaAddress: getAbhaAddress(account),
    abhaNumberMasked: maskAbhaNumber(getAbhaNumber(account)),
  };
}

function normalizeMobile(value, trusted) {
  if (!trusted || typeof value !== 'string') return undefined;
  const digits = value.replace(/\D/g, '');
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(mobile)) return undefined;
  return `+91${mobile}`;
}

function profileFrom(payload, state, selectedAccount = null) {
  const profile = payload ?? {};
  const abhaNumber = getAbhaNumber(profile) || getAbhaNumber(selectedAccount);
  const abhaAddress =
    profile.preferredAbhaAddress ??
    profile.abhaAddress ??
    getAbhaAddress(selectedAccount) ??
    (state.identifierType === 'abha-address' ? state.identifier : '');
  const providerUserId = abhaNumber
    ? `abha-number:${abhaNumber}`
    : abhaAddress
      ? `abha-address:${abhaAddress.toLowerCase()}`
      : '';
  const yearOfBirth = String(
    profile.yearOfBirth ??
      (typeof profile.dateOfBirth === 'string' ? profile.dateOfBirth.match(/\d{4}/)?.[0] : '') ??
      '',
  );
  const methodVerifiedMobile = state.authMethod !== 'password';
  const verifiedMobile =
    normalizeMobile(
      profile.mobile,
      methodVerifiedMobile || profile.mobileVerified === true || profile.mobileVerified === 'true',
    ) ??
    (state.identifierType === 'mobile' && methodVerifiedMobile
      ? normalizeMobile(state.identifier, true)
      : undefined);

  return validateNormalizedProfile({
    providerUserId,
    displayName: profile.name ?? profile.fullName ?? selectedAccount?.fullName ?? selectedAccount?.name,
    ...(verifiedMobile ? { verifiedMobile } : {}),
    ...( /^\d{4}$/.test(yearOfBirth) ? { yearOfBirth } : {}),
    ...(typeof profile.gender === 'string' ? { gender: profile.gender.toUpperCase() } : {}),
    ...(abhaNumber ? { abhaNumber } : {}),
    ...(abhaAddress ? { abhaAddress } : {}),
  });
}

export class AbhaAuthProvider extends AuthProvider {
  #environment;
  #fetch;
  #challengeStore;
  #accessToken = null;
  #accessTokenExpiresAt = 0;
  #certificate = null;
  #certificateExpiresAt = 0;

  constructor({
    environment,
    fetchImpl = globalThis.fetch,
    challengeStore = AbhaLoginChallenge,
  }) {
    super('abha');
    this.#environment = environment;
    this.#fetch = fetchImpl;
    this.#challengeStore = challengeStore;
  }

  get enabled() {
    return this.#environment.ABDM_ENABLED === true;
  }

  async #request(url, { method = 'GET', headers = {}, body, retryTransient = false, operation }) {
    const maxAttempts = retryTransient ? TOKEN_RETRY_LIMIT + 1 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      try {
        response = await this.#fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt + 1 < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        throw providerError(
          503,
          'ABHA_UNAVAILABLE',
          'ABHA sign-in is temporarily unavailable. Try again later.',
        );
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        if (response.ok) {
          throw providerError(
            503,
            'ABHA_UNAVAILABLE',
            'ABHA sign-in is temporarily unavailable. Try again later.',
          );
        }
      }

      if (response.ok) return payload;
      if (retryTransient && (response.status === 429 || response.status >= 500) && attempt + 1 < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        continue;
      }
      throw upstreamError(response, payload, operation);
    }
    throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
  }

  #baseUrls() {
    const production = this.#environment.ABDM_ENVIRONMENT === 'production';
    const gateway = production
      ? this.#environment.ABDM_PRODUCTION_GATEWAY_URL
      : this.#environment.ABDM_SANDBOX_GATEWAY_URL;
    const api = production
      ? this.#environment.ABDM_PRODUCTION_API_URL
      : this.#environment.ABDM_SANDBOX_API_URL;
    if (!gateway || !api) {
      throw providerError(
        503,
        'ABHA_NOT_CONFIGURED',
        'ABHA sign-in is not configured for this environment.',
      );
    }
    return { gateway: gateway.replace(/\/+$/, ''), api: api.replace(/\/+$/, '') };
  }

  async #gatewayToken() {
    if (this.#accessToken && Date.now() < this.#accessTokenExpiresAt) return this.#accessToken;
    const { gateway } = this.#baseUrls();
    const payload = await this.#request(`${gateway}/api/hiecm/gateway/v3/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'REQUEST-ID': randomUUID(),
        TIMESTAMP: new Date().toISOString(),
        'X-CM-ID': this.#environment.ABDM_CM_ID,
      },
      body: {
        clientId: this.#environment.ABDM_CLIENT_ID,
        clientSecret: this.#environment.ABDM_CLIENT_SECRET,
        grantType: 'client_credentials',
      },
      retryTransient: true,
      operation: 'session',
    });
    if (typeof payload?.accessToken !== 'string' || !Number.isFinite(Number(payload.expiresIn))) {
      throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
    }
    this.#accessToken = payload.accessToken;
    this.#accessTokenExpiresAt = Date.now() + Math.max(0, Number(payload.expiresIn) - 60) * 1000;
    return this.#accessToken;
  }

  async #publicCertificate() {
    if (this.#certificate && Date.now() < this.#certificateExpiresAt) return this.#certificate;
    const { api } = this.#baseUrls();
    const token = await this.#gatewayToken();
    const certificate = await this.#request(`${api}${ABHA_V3_PATH}/phr/app/login/public/certificate`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'REQUEST-ID': randomUUID(),
        TIMESTAMP: new Date().toISOString(),
      },
      retryTransient: true,
      operation: 'certificate',
    });
    if (
      typeof certificate?.publicKey !== 'string' ||
      certificate.encryptionAlgorithm !== 'RSA/ECB/OAEPWithSHA-1AndMGF1Padding'
    ) {
      throw providerError(
        503,
        'ABHA_UNAVAILABLE',
        'ABHA sign-in is temporarily unavailable. Try again later.',
      );
    }
    this.#certificate = certificate;
    this.#certificateExpiresAt = Date.now() + 10 * 60 * 1000;
    return certificate;
  }

  async #encrypt(value) {
    const certificate = await this.#publicCertificate();
    try {
      const key = certificate.publicKey.includes('BEGIN PUBLIC KEY')
        ? createPublicKey(certificate.publicKey)
        : createPublicKey({
            key: Buffer.from(certificate.publicKey, 'base64'),
            format: 'der',
            type: 'spki',
          });
      return publicEncrypt(
        {
          key,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha1',
        },
        Buffer.from(value, 'utf8'),
      ).toString('base64');
    } catch {
      throw providerError(
        503,
        'ABHA_UNAVAILABLE',
        'ABHA sign-in is temporarily unavailable. Try again later.',
      );
    }
  }

  async #abhaRequest(path, token, options = {}) {
    const { api } = this.#baseUrls();
    return this.#request(`${api}${ABHA_V3_PATH}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'REQUEST-ID': randomUUID(),
        TIMESTAMP: new Date().toISOString(),
        ...(options.headers ?? {}),
      },
    });
  }

  async #loadChallenge(challengeId) {
    if (!/^[a-f\d]{24}$/i.test(challengeId ?? '')) {
      throw providerError(400, 'ABHA_CHALLENGE_EXPIRED', 'This ABHA sign-in attempt expired. Start again.');
    }
    const challenge = await this.#challengeStore
      .findOne({
        _id: challengeId,
        expiresAt: { $gt: new Date() },
        consumedAt: null,
      })
      .select('+stateEncrypted');
    if (!challenge) {
      throw providerError(410, 'ABHA_CHALLENGE_EXPIRED', 'This ABHA sign-in attempt expired. Start again.');
    }
    try {
      return {
        challenge,
        state: JSON.parse(
          decryptSecret(
            challenge.stateEncrypted,
            this.#environment.DATA_ENCRYPTION_KEY || this.#environment.JWT_REFRESH_SECRET,
          ),
        ),
      };
    } catch {
      throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
    }
  }

  async #saveState(challenge, state) {
    await this.#challengeStore.updateOne(
      { _id: challenge._id },
      {
        $set: {
          stateEncrypted: encryptSecret(
            JSON.stringify(state),
            this.#environment.DATA_ENCRYPTION_KEY || this.#environment.JWT_REFRESH_SECRET,
          ),
        },
      },
    );
  }

  async initiate({ loginType, identifier, authMethod }) {
    if (!this.enabled) {
      throw providerError(503, 'ABHA_NOT_CONFIGURED', 'ABHA sign-in is not enabled.');
    }
    const token = await this.#gatewayToken();
    const state = {
      loginType,
      identifierType: loginType,
      identifier,
      authMethod,
      stage: authMethod === 'password' ? 'password' : 'otp',
    };

    if (authMethod === 'password') {
      const search = await this.#abhaRequest('/phr/app/login/search', token, {
        method: 'POST',
        headers: { abhaAddress: identifier },
        operation: 'initiate',
      });
      if (!Array.isArray(search?.authMethods) || !search.authMethods.includes('PASSWORD')) {
        throw providerError(
          403,
          'ABHA_PASSWORD_UNAVAILABLE',
          'Password sign-in is not available for this ABHA address.',
        );
      }
    } else {
      const encryptedIdentifier = await this.#encrypt(identifier);
      let loginHint;
      let scope;
      let otpSystem;
      if (loginType === 'mobile') {
        loginHint = 'mobile-number';
        scope = OTP_SCOPES.mobile;
        otpSystem = 'abdm';
      } else if (loginType === 'abha-number') {
        loginHint = 'abha-number';
        scope =
          authMethod === 'aadhaar-otp'
            ? OTP_SCOPES.abhaNumberAadhaar
            : OTP_SCOPES.abhaNumberMobile;
        otpSystem = authMethod === 'aadhaar-otp' ? 'aadhaar' : 'abdm';
      } else {
        loginHint = 'abha-address';
        scope = OTP_SCOPES.abhaAddress;
        otpSystem = 'abdm';
      }
      const response = await this.#abhaRequest('/phr/app/login/request/otp', token, {
        method: 'POST',
        body: { scope, loginHint, loginId: encryptedIdentifier, otpSystem },
        operation: 'initiate',
      });
      if (typeof response?.txnId !== 'string' || !response.txnId) {
        throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
      }
      state.txnId = response.txnId;
      state.scope = scope;
    }

    const challenge = await this.#challengeStore.create({
      stateEncrypted: encryptSecret(
        JSON.stringify(state),
        this.#environment.DATA_ENCRYPTION_KEY || this.#environment.JWT_REFRESH_SECRET,
      ),
      expiresAt: new Date(Date.now() + CHALLENGE_LIFETIME_MS),
    });
    return {
      challengeId: challenge._id.toString(),
      expiresInSeconds: CHALLENGE_LIFETIME_MS / 1000,
      requiresOtp: authMethod !== 'password',
    };
  }

  async verify({ challengeId, code, password }) {
    const { challenge, state } = await this.#loadChallenge(challengeId);
    const token = await this.#gatewayToken();
    let response;
    if (state.authMethod === 'password') {
      const encryptedPassword = await this.#encrypt(password);
      response = await this.#abhaRequest('/phr/app/login/verify', token, {
        method: 'POST',
        body: {
          scope: PASSWORD_SCOPE,
          authData: {
            authMethods: ['password'],
            password: {
              abhaAddress: state.identifier,
              password: encryptedPassword,
            },
          },
        },
        operation: 'verify',
      });
    } else {
      const encryptedOtp = await this.#encrypt(code);
      response = await this.#abhaRequest('/phr/app/login/verify', token, {
        method: 'POST',
        body: {
          scope: state.scope,
          authData: {
            authMethods: ['otp'],
            otp: {
              txnId: state.txnId,
              otpValue: encryptedOtp,
            },
          },
        },
        operation: 'verify',
      });
    }

    const users = Array.isArray(response?.users) ? response.users : [];
    const intermediateToken = response?.tokens?.token ?? response?.token;
    if (state.authMethod !== 'password' && users.length > 1) {
      state.stage = 'account_selection';
      state.intermediateToken = intermediateToken;
      state.accounts = users;
      await this.#saveState(challenge, state);
      return {
        accountSelectionRequired: true,
        challengeId,
        accounts: users.map(maskAccount),
      };
    }

    if (state.authMethod !== 'password' && users.length === 1 && getAbhaAddress(users[0])) {
      state.intermediateToken = intermediateToken;
      return this.#selectAccount(challenge, state, users[0], token);
    }
    if (typeof intermediateToken !== 'string' || !intermediateToken) {
      throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
    }
    const result = await this.#fetchProfile(intermediateToken, token, state, users[0]);
    await this.#challengeStore.updateOne({ _id: challenge._id }, { $set: { consumedAt: new Date() } });
    return result;
  }

  async selectAccount({ challengeId, accountId }) {
    const { challenge, state } = await this.#loadChallenge(challengeId);
    if (state.stage !== 'account_selection' || !Array.isArray(state.accounts)) {
      throw providerError(400, 'ABHA_CHALLENGE_INVALID', 'Choose an account from the current ABHA sign-in.');
    }
    const index = Number(accountId);
    if (!Number.isInteger(index) || index < 0 || index >= state.accounts.length) {
      throw providerError(400, 'ABHA_CHALLENGE_INVALID', 'Choose an account from the current ABHA sign-in.');
    }
    return this.#selectAccount(challenge, state, state.accounts[index], await this.#gatewayToken());
  }

  async #selectAccount(challenge, state, account, gatewayToken) {
    const abhaAddress = getAbhaAddress(account);
    const intermediateToken = state.intermediateToken ?? account?.tokens?.token;
    if (!abhaAddress || typeof intermediateToken !== 'string' || !intermediateToken) {
      throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
    }
    const selected = await this.#abhaRequest('/phr/app/login/verify/user', gatewayToken, {
      method: 'POST',
      headers: { 'T-token': intermediateToken },
      body: { abhaAddress, txnId: state.txnId },
      operation: 'select',
    });
    const userToken = selected?.token ?? selected?.tokens?.token;
    if (typeof userToken !== 'string' || !userToken) {
      throw providerError(503, 'ABHA_UNAVAILABLE', 'ABHA sign-in is temporarily unavailable. Try again later.');
    }
    const profile = await this.#fetchProfile(userToken, gatewayToken, state, account);
    await this.#challengeStore.updateOne({ _id: challenge._id }, { $set: { consumedAt: new Date() } });
    return profile;
  }

  async #fetchProfile(userToken, gatewayToken, state, selectedAccount) {
    const profile = await this.#abhaRequest('/profile/account', gatewayToken, {
      headers: { 'X-token': userToken },
      operation: 'profile',
      retryTransient: true,
    });
    if (profile?.status && profile.status !== 'ACTIVE') {
      throw providerError(403, 'ABHA_ACCOUNT_UNAVAILABLE', 'This ABHA account cannot sign in.');
    }
    return profileFrom(profile, state, selectedAccount);
  }
}
