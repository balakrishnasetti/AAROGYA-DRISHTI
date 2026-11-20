import { ApiError } from '../utils/apiError.js';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const isMalformedJson = error instanceof SyntaxError && Object.hasOwn(error, 'body');
  const isOversizedBody = error.type === 'entity.too.large';
  const isOversizedFile = error.code === 'LIMIT_FILE_SIZE';
  const isUploadError = error.name === 'MulterError';
  const isDuplicate = error.code === 11000;
  const isServiceError =
    error instanceof ApiError && Number.isInteger(error.status) && error.status >= 500 && error.status < 600;
  const isExpected =
    (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) ||
    isServiceError ||
    isMalformedJson ||
    isOversizedBody ||
    isOversizedFile ||
    isUploadError ||
    isDuplicate;
  const status = isMalformedJson
    ? 400
    : isOversizedBody || isOversizedFile
      ? 413
      : isDuplicate
        ? 409
        : isExpected
          ? (error.status ?? 400)
          : 500;
  const code = isMalformedJson
    ? 'INVALID_JSON'
    : isOversizedBody || isOversizedFile
      ? 'PAYLOAD_TOO_LARGE'
      : isDuplicate
        ? 'DUPLICATE_RESOURCE'
        : isUploadError
          ? 'FILE_UPLOAD_INVALID'
          : isExpected
            ? error.code
            : 'INTERNAL_SERVER_ERROR';
  const message = isMalformedJson
    ? 'The request format is invalid. Check the data and try again.'
    : isOversizedBody || isOversizedFile
      ? 'The file or request is too large. Choose a smaller file and try again.'
      : isDuplicate
        ? 'That identifier is already in use. Check the email, phone, or registration number and try again.'
        : isUploadError
          ? 'The upload is invalid. Choose one supported file and try again.'
          : isExpected
            ? error.message
            : 'Something went wrong. Please try again later or contact support.';

  if (status >= 500) {
    const log = isExpected ? 'warn' : 'error';
    const message = isExpected
      ? 'Request could not be completed because a required service is unavailable'
      : 'Unhandled request error';
    req.log?.[log]({ errorName: error.name, errorCode: code, requestId: req.id }, message);
  }

  return res.status(status).json({
    success: false,
    code,
    message,
    details: isDuplicate
      ? { fields: Object.keys(error.keyPattern ?? {}) }
      : isExpected
        ? (error.details ?? null)
        : null,
  });
}
