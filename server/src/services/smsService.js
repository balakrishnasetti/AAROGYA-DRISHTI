import { isSyntheticDemoPatientPhone } from './authPolicy.js';

const MSG91_OTP_ENDPOINT = 'https://control.msg91.com/api/v5/otp';
const PROVIDER_TIMEOUT_MS = 10000;

function createDevelopmentProvider(logger, allowAnyPhone = false) {
  return {
    deliveryMode: 'development_console',
    async sendOtp(phone, code) {
      if (!allowAnyPhone && !isSyntheticDemoPatientPhone(phone)) {
        throw new Error('Development OTP delivery is limited to seeded synthetic demo accounts.');
      }
      if (!allowAnyPhone) {
        logger.info(`Development-only OTP for synthetic demo account: ${code}`);
      }
    },
  };
}

function createTestProvider() {
  return {
    deliveryMode: 'mock',
    async sendOtp() {},
  };
}

function createMsg91Provider({ apiKey, templateId, fetchImpl }) {
  return {
    deliveryMode: 'provider',
    async sendOtp(phone, code) {
      if (!apiKey || !templateId) {
        throw new Error('MSG91 requires SMS_API_KEY and SMS_TEMPLATE_ID.');
      }

      const url = new URL(MSG91_OTP_ENDPOINT);
      url.searchParams.set('template_id', templateId);

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authkey: apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            mobile: phone.replace(/^\+/, ''),
            otp: code,
          }),
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
      } catch {
        throw new Error('MSG91 request failed or timed out.');
      }

      if (!response.ok) {
        throw new Error(`MSG91 request failed with HTTP ${response.status}.`);
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error('MSG91 returned an invalid response.');
      }

      if (result?.type !== 'success') {
        throw new Error('MSG91 did not accept the OTP message.');
      }
    },
  };
}

export function createSmsProvider({
  environment = {},
  logger = console,
  provider,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (provider) return provider;
  if (environment.NODE_ENV === 'test') return createTestProvider();

  if (environment.SMS_PROVIDER === 'msg91') {
    return createMsg91Provider({
      apiKey: environment.SMS_API_KEY,
      templateId: environment.SMS_TEMPLATE_ID,
      fetchImpl,
    });
  }

  if (environment.SMS_PROVIDER) {
    return {
      deliveryMode: 'unavailable',
      async sendOtp() {
        throw new Error('The configured SMS provider is not supported.');
      },
    };
  }

  if (
    environment.NODE_ENV === 'development' &&
    environment.DEPLOYMENT_ENV !== 'staging' &&
    environment.DEPLOYMENT_ENV !== 'production' &&
    environment.DEV_PATIENT_REGISTRATION_OTP === true
  ) {
    return createDevelopmentProvider(logger, true);
  }

  if (environment.NODE_ENV === 'development' && environment.SEED_DEMO === true) {
    return createDevelopmentProvider(logger);
  }

  return {
    deliveryMode: 'unavailable',
    async sendOtp() {
      throw new Error('SMS provider is not configured. Please try again later.');
    },
  };
}
