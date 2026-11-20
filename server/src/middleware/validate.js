import { ApiError } from '../utils/apiError.js';

export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        new ApiError(
          400,
          'VALIDATION_ERROR',
          'Some information is missing or invalid. Check the highlighted fields and try again.',
          parsed.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
    }

    req.body = parsed.data;
    return next();
  };
}
