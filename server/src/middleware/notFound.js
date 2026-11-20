import { ApiError } from '../utils/apiError.js';

export function notFoundHandler(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}
