const { verifyAccessToken } = require('../config/jwt');
const { query } = require('../db/pool');
const { error } = require('../utils/response');

// Verify JWT and attach user to request
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Access token required', 401);
    }
    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.restaurant_id, u.is_active,
              r.is_active AS restaurant_active,
              r.settings_tax_percentage, r.settings_service_charge,
              r.settings_currency, r.settings_timezone
       FROM users u
       JOIN restaurants r ON r.id = u.restaurant_id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (!rows[0] || !rows[0].is_active || !rows[0].restaurant_active) {
      return error(res, 'Account not found or inactive', 401);
    }

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return error(res, 'Token expired', 401);
    if (err.name === 'JsonWebTokenError') return error(res, 'Invalid token', 401);
    next(err);
  }
};

// Role-based access control
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return error(res, 'Access denied — insufficient permissions', 403);
  }
  next();
};

module.exports = { authenticate, authorize };
