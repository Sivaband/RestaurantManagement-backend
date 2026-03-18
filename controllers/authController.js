const bcrypt = require('bcryptjs');
const { query, getClient } = require('../db/pool');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../config/jwt');
const { success, error } = require('../utils/response');

// ── POST /auth/register ────────────────────────────────────────────────────────
exports.register = async (req, res, next) => {
  const client = await getClient();
  try {
    const { name, email, password, restaurant_name, phone, address } = req.body;
    if (!name || !email || !password || !restaurant_name) {
      return error(res, 'name, email, password, restaurant_name are required', 400);
    }

    // Check email not taken globally
    const { rows: existing } = await client.query(
      `SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]
    );
    if (existing.length) return error(res, 'Email already registered', 409);

    await client.query('BEGIN');

    // Create restaurant
    const { rows: [restaurant] } = await client.query(`
      INSERT INTO restaurants (name, email, phone, address)
      VALUES ($1,$2,$3,$4) RETURNING *`,
      [restaurant_name, email.toLowerCase(), phone || null, address || null]
    );

    // Create owner user
    const hashed = await bcrypt.hash(password, 12);
    const { rows: [user] } = await client.query(`
      INSERT INTO users (restaurant_id, name, email, password, role)
      VALUES ($1,$2,$3,$4,'owner')
      RETURNING id, name, email, role, restaurant_id, created_at`,
      [restaurant.id, name, email.toLowerCase(), hashed]
    );

    const tokenPayload = { userId: user.id, restaurantId: restaurant.id, role: user.role };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)`,
      [user.id, refreshToken, expiresAt]
    );

    await client.query('COMMIT');

    return success(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { ...user, password: undefined },
      restaurant,
    }, 'Registration successful', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── POST /auth/login ───────────────────────────────────────────────────────────
exports.login = async (req, res, next) => {
  try {
    console.log("🔥 Login HIT");

    const { email, password } = req.body;
    console.log("📩 Input:", email);

    const result = await query(`
      SELECT u.id, u.name, u.email, u.password, u.role,
             u.restaurant_id, u.is_active,
             r.is_active AS restaurant_active
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    console.log("📦 Query result:", result);

    const user = result.rows[0];
    if (!user || !user.is_active || !user.restaurant_active) {
      return error(res, 'Invalid credentials', 401);
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return error(res, 'Invalid credentials', 401);

    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

    const tokenPayload = { userId: user.id, restaurantId: user.restaurant_id, role: user.role };
    const accessToken  = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)`,
      [user.id, refreshToken, expiresAt]
    );

    const { password: _, ...safeUser } = user;
    return success(res, { access_token: accessToken, refresh_token: refreshToken, user: safeUser }, 'Login successful');
  } catch (err) { next(err); }
};

// ── POST /auth/refresh ─────────────────────────────────────────────────────────
exports.refresh = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return error(res, 'Refresh token required', 400);

    const decoded = verifyRefreshToken(refresh_token);

    const { rows } = await query(
      `SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()`,
      [refresh_token]
    );
    if (!rows.length) return error(res, 'Invalid or expired refresh token', 401);

    // Rotate tokens
    await query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);

    const tokenPayload = { userId: decoded.userId, restaurantId: decoded.restaurantId, role: decoded.role };
    const accessToken  = generateAccessToken(tokenPayload);
    const newRefresh   = generateRefreshToken(tokenPayload);

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await query(`INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)`,
      [decoded.userId, newRefresh, expiresAt]);

    return success(res, { access_token: accessToken, refresh_token: newRefresh });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return error(res, 'Invalid refresh token', 401);
    next(err);
  }
};

// ── GET /auth/me ───────────────────────────────────────────────────────────────
exports.me = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT u.id, u.name, u.email, u.role, u.avatar_url, u.last_login, u.created_at,
             r.id AS restaurant_id, r.name AS restaurant_name, r.logo_url, r.address, r.phone,
             r.subscription_plan, r.settings_currency, r.settings_timezone,
             r.settings_tax_percentage, r.settings_service_charge
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.id = $1`,
      [req.user.id]
    );
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ── POST /auth/logout ──────────────────────────────────────────────────────────
exports.logout = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await query(`DELETE FROM refresh_tokens WHERE token = $1`, [refresh_token]);
    }
    // Optionally revoke all sessions: await query(`DELETE FROM refresh_tokens WHERE user_id=$1`,[req.user.id]);
    return success(res, {}, 'Logged out successfully');
  } catch (err) { next(err); }
};

// ── PUT /auth/change-password ──────────────────────────────────────────────────
exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return error(res, 'Both passwords required', 400);

    const { rows } = await query(`SELECT password FROM users WHERE id = $1`, [req.user.id]);
    const valid = await bcrypt.compare(current_password, rows[0].password);
    if (!valid) return error(res, 'Current password is incorrect', 400);

    const hashed = await bcrypt.hash(new_password, 12);
    await query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, req.user.id]);
    await query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [req.user.id]);

    return success(res, {}, 'Password changed successfully');
  } catch (err) { next(err); }
};
