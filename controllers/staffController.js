const bcrypt = require('bcryptjs');
const { query } = require('../db/pool');
const { success, error } = require('../utils/response');

// ── GET /staff ─────────────────────────────────────────────────────────────────
exports.getStaff = async (req, res, next) => {
  try {
    const { role } = req.query;
    let sql = `
      SELECT id, name, email, role, avatar_url, is_active, last_login, created_at
      FROM users
      WHERE restaurant_id = $1 AND role != 'owner'`;
    const params = [req.user.restaurant_id];
    if (role) { params.push(role); sql += ` AND role = $${params.length}`; }
    sql += ` ORDER BY created_at`;
    const { rows } = await query(sql, params);
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /staff/:id ─────────────────────────────────────────────────────────────
exports.getStaffById = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, role, avatar_url, is_active, last_login, created_at
       FROM users WHERE id=$1 AND restaurant_id=$2 AND role!='owner'`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rows[0]) return error(res, 'Staff not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ── POST /staff ────────────────────────────────────────────────────────────────
exports.createStaff = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return error(res, 'name, email, password, role are required', 400);
    }
    if (!['waiter','kitchen'].includes(role)) {
      return error(res, "role must be 'waiter' or 'kitchen'", 400);
    }

    const hashed = await bcrypt.hash(password, 12);
    const { rows } = await query(`
      INSERT INTO users (restaurant_id, name, email, password, role)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, name, email, role, created_at`,
      [req.user.restaurant_id, name, email.toLowerCase(), hashed, role]
    );
    return success(res, rows[0], 'Staff created', 201);
  } catch (err) { next(err); }
};

// ── PUT /staff/:id ─────────────────────────────────────────────────────────────
exports.updateStaff = async (req, res, next) => {
  try {
    const { name, role, is_active } = req.body;
    const { rows } = await query(`
      UPDATE users SET
        name      = COALESCE($3, name),
        role      = COALESCE($4::user_role_enum, role),
        is_active = COALESCE($5, is_active)
      WHERE id=$2 AND restaurant_id=$1 AND role!='owner'
      RETURNING id, name, email, role, is_active`,
      [req.user.restaurant_id, req.params.id, name, role, is_active]
    );
    if (!rows[0]) return error(res, 'Staff not found', 404);
    return success(res, rows[0], 'Staff updated');
  } catch (err) { next(err); }
};

// ── DELETE /staff/:id ──────────────────────────────────────────────────────────
exports.deleteStaff = async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM users WHERE id=$1 AND restaurant_id=$2 AND role!='owner'`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rowCount) return error(res, 'Staff not found', 404);
    return success(res, {}, 'Staff removed');
  } catch (err) { next(err); }
};

// ── PATCH /staff/:id/reset-password ───────────────────────────────────────────
exports.resetPassword = async (req, res, next) => {
  try {
    const { new_password } = req.body;
    if (!new_password) return error(res, 'new_password is required', 400);
    const hashed = await bcrypt.hash(new_password, 12);
    const { rowCount } = await query(
      `UPDATE users SET password=$3 WHERE id=$1 AND restaurant_id=$2 AND role!='owner'`,
      [req.params.id, req.user.restaurant_id, hashed]
    );
    if (!rowCount) return error(res, 'Staff not found', 404);
    return success(res, {}, 'Password reset');
  } catch (err) { next(err); }
};
