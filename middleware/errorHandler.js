const { error } = require('../utils/response');

const errorHandler = (err, req, res, next) => {
  console.error('❌ Unhandled error:', err);

  // PostgreSQL unique violation
  if (err.code === '23505') {
    const detail = err.detail || '';
    const field  = detail.match(/\(([^)]+)\)/)?.[1] || 'field';
    return error(res, `${field} already exists`, 409);
  }
  // PostgreSQL FK violation
  if (err.code === '23503') return error(res, 'Referenced record does not exist', 400);
  // PostgreSQL check violation
  if (err.code === '23514') return error(res, 'Invalid value', 400);
  // PostgreSQL not-null violation
  if (err.code === '23502') return error(res, `${err.column} is required`, 400);

  if (err.status) return error(res, err.message, err.status);
  return error(res, 'Internal server error', 500);
};

module.exports = errorHandler;
