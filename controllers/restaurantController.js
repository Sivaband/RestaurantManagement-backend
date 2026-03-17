const { query } = require('../db/pool');
const { success, error } = require('../utils/response');

// ── GET /restaurant/profile ────────────────────────────────────────────────────
exports.getProfile = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, logo_url, address, phone, email, subscription_plan, is_active,
              settings_currency, settings_timezone,
              settings_tax_percentage, settings_service_charge,
              created_at, updated_at
       FROM restaurants WHERE id = $1`,
      [req.user.restaurant_id]
    );
    if (!rows[0]) return error(res, 'Restaurant not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ── PUT /restaurant/profile ────────────────────────────────────────────────────
exports.updateProfile = async (req, res, next) => {
  try {
    const { name, address, phone, email, logo_url, settings } = req.body;
    const { rows } = await query(`
      UPDATE restaurants SET
        name                    = COALESCE($2, name),
        address                 = COALESCE($3, address),
        phone                   = COALESCE($4, phone),
        email                   = COALESCE($5, email),
        logo_url                = COALESCE($6, logo_url),
        settings_currency       = COALESCE($7, settings_currency),
        settings_timezone       = COALESCE($8, settings_timezone),
        settings_tax_percentage = COALESCE($9, settings_tax_percentage),
        settings_service_charge = COALESCE($10, settings_service_charge)
      WHERE id = $1 RETURNING *`,
      [
        req.user.restaurant_id, name, address, phone, email, logo_url,
        settings?.currency, settings?.timezone,
        settings?.tax_percentage, settings?.service_charge,
      ]
    );
    return success(res, rows[0], 'Profile updated');
  } catch (err) { next(err); }
};
