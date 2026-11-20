import { Consent } from '../models/index.js';
import { ApiError } from '../utils/apiError.js';

export function requireConsent(consentType) {
  return async function enforceConsent(req, res, next) {
    try {
      const patientId = req.authorizedPatient?._id ?? req.params.patientId;
      if (!patientId) {
        return next(
          new ApiError(
            400,
            'CONSENT_REQUIRED',
            'This feature requires a patient context before consent checks can run.',
          ),
        );
      }

      const latestConsent = await Consent.findOne({ patientId, consentType }).sort({ recordedAt: -1 });
      if (!latestConsent) {
        return next(
          new ApiError(
            403,
            'CONSENT_REQUIRED',
            `This feature requires ${consentType.replace('_', ' ')} consent before it can be used.`,
          ),
        );
      }

      if (!latestConsent.granted || latestConsent.withdrawnAt) {
        return next(
          new ApiError(
            403,
            'CONSENT_WITHDRAWN',
            `The patient withdrew ${consentType.replace('_', ' ')} consent and this feature is unavailable.`,
          ),
        );
      }

      req.consent = latestConsent;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
