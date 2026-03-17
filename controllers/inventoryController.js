const { query } = require('../db/pool');
const { success, error } = require('../utils/response');

// ── GET /inventory ─────────────────────────────────────────────────────────────
exports.getInventory = async (req, res, next) => {
  try {
    const { low_stock } = req.query;
    let sql = `SELECT * FROM inventory WHERE restaurant_id=$1`;
    if (low_stock === 'true') sql += ` AND is_low_stock=TRUE`;
    sql += ` ORDER BY name`;
    const { rows } = await query(sql, [req.user.restaurant_id]);
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /inventory/:id ─────────────────────────────────────────────────────────
exports.getById = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM inventory WHERE id=$1 AND restaurant_id=$2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rows[0]) return error(res, 'Item not found', 404);
    return success(res, rows[0]);
  } catch (err) { next(err); }
};

// ── POST /inventory ────────────────────────────────────────────────────────────
exports.createItem = async (req, res, next) => {
  try {
    const { name, unit, current_stock, minimum_stock, cost_per_unit } = req.body;
    if (!name || !unit) return error(res, 'name and unit are required', 400);
    const isLow = Number(current_stock || 0) <= Number(minimum_stock || 0);
    const { rows } = await query(`
      INSERT INTO inventory (restaurant_id, name, unit, current_stock, minimum_stock, cost_per_unit, is_low_stock)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.restaurant_id, name, unit,
       current_stock ?? 0, minimum_stock ?? 0, cost_per_unit ?? 0, isLow]
    );
    return success(res, rows[0], 'Inventory item created', 201);
  } catch (err) { next(err); }
};

// ── PUT /inventory/:id ─────────────────────────────────────────────────────────
exports.updateItem = async (req, res, next) => {
  try {
    const { name, unit, current_stock, minimum_stock, cost_per_unit } = req.body;

    // Recalculate is_low_stock if stock values change
    let isLow;
    if (current_stock !== undefined || minimum_stock !== undefined) {
      const { rows: [cur] } = await query(`SELECT current_stock, minimum_stock FROM inventory WHERE id=$1`, [req.params.id]);
      const cs = current_stock ?? cur.current_stock;
      const ms = minimum_stock ?? cur.minimum_stock;
      isLow = Number(cs) <= Number(ms);
    }

    const { rows } = await query(`
      UPDATE inventory SET
        name          = COALESCE($3, name),
        unit          = COALESCE($4, unit),
        current_stock = COALESCE($5, current_stock),
        minimum_stock = COALESCE($6, minimum_stock),
        cost_per_unit = COALESCE($7, cost_per_unit),
        is_low_stock  = COALESCE($8, is_low_stock)
      WHERE id=$2 AND restaurant_id=$1 RETURNING *`,
      [req.user.restaurant_id, req.params.id, name, unit,
       current_stock, minimum_stock, cost_per_unit, isLow ?? undefined]
    );
    if (!rows[0]) return error(res, 'Item not found', 404);
    return success(res, rows[0], 'Inventory updated');
  } catch (err) { next(err); }
};

// ── DELETE /inventory/:id ──────────────────────────────────────────────────────
exports.deleteItem = async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM inventory WHERE id=$1 AND restaurant_id=$2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rowCount) return error(res, 'Item not found', 404);
    return success(res, {}, 'Inventory item deleted');
  } catch (err) { next(err); }
};
