const { query } = require('../db/pool');
const QRCode = require('qrcode');
const { success, error } = require('../utils/response');

const CLIENT_URL = () => process.env.CLIENT_URL || 'http://localhost:3000';

// ── GET /tables ────────────────────────────────────────────────────────────────
exports.getTables = async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT * FROM restaurant_tables WHERE restaurant_id = $1`;
    const params = [req.user.restaurant_id];
    if (status) { params.push(status); sql += ` AND status = $2`; }
    sql += ` ORDER BY table_number`;
    const { rows } = await query(sql, params);
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /tables/:id ────────────────────────────────────────────────────────────
exports.getTableById = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rows[0]) return error(res, 'Table not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ── POST /tables ───────────────────────────────────────────────────────────────
exports.createTable = async (req, res, next) => {
  try {
    const { table_number, capacity } = req.body;
    if (!table_number) return error(res, 'table_number is required', 400);

    const { rows: [tbl] } = await query(
      `INSERT INTO restaurant_tables (restaurant_id, table_number, capacity)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.user.restaurant_id, table_number, capacity ?? 4]
    );

    const qrData = `${CLIENT_URL()}/menu/${req.user.restaurant_id}/${tbl.id}`;
    const qrUrl  = await QRCode.toDataURL(qrData, { errorCorrectionLevel: 'H', width: 300 });
    const { rows: [updated] } = await query(
      `UPDATE restaurant_tables SET qr_code_url=$2, qr_data=$3 WHERE id=$1 RETURNING *`,
      [tbl.id, qrUrl, qrData]
    );

    return success(res, updated, 'Table created', 201);
  } catch (err) { next(err); }
};

// ── PUT /tables/:id ────────────────────────────────────────────────────────────
exports.updateTable = async (req, res, next) => {
  try {
    const { table_number, capacity } = req.body;
    const { rows } = await query(`
      UPDATE restaurant_tables SET
        table_number = COALESCE($3, table_number),
        capacity     = COALESCE($4, capacity)
      WHERE id = $2 AND restaurant_id = $1 RETURNING *`,
      [req.user.restaurant_id, req.params.id, table_number, capacity]
    );
    if (!rows[0]) return error(res, 'Table not found', 404);
    return success(res, rows[0], 'Table updated');
  } catch (err) { next(err); }
};

// ── DELETE /tables/:id ─────────────────────────────────────────────────────────
exports.deleteTable = async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rowCount) return error(res, 'Table not found', 404);
    return success(res, {}, 'Table deleted');
  } catch (err) { next(err); }
};

// ── PATCH /tables/:id/status ───────────────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['available', 'occupied', 'bill_requested', 'reserved'];
    if (!allowed.includes(status)) return error(res, `Status must be one of: ${allowed.join(', ')}`, 400);

    const { rows } = await query(`
      UPDATE restaurant_tables SET status = $3
      WHERE id = $2 AND restaurant_id = $1 RETURNING *`,
      [req.user.restaurant_id, req.params.id, status]
    );
    if (!rows[0]) return error(res, 'Table not found', 404);
    return success(res, rows[0], 'Status updated');
  } catch (err) { next(err); }
};

// ── POST /tables/:id/qr ───────────────────────────────────────────────────────
exports.regenerateQR = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rows[0]) return error(res, 'Table not found', 404);

    const qrData = `${CLIENT_URL()}/menu/${req.user.restaurant_id}/${req.params.id}`;
    const qrUrl  = await QRCode.toDataURL(qrData, { errorCorrectionLevel: 'H', width: 300 });

    const { rows: [updated] } = await query(
      `UPDATE restaurant_tables SET qr_code_url=$2, qr_data=$3 WHERE id=$1 RETURNING *`,
      [req.params.id, qrUrl, qrData]
    );
    return success(res, updated, 'QR regenerated');
  } catch (err) { next(err); }
};
