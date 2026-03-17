const { query } = require('../db/pool');
const { success, error } = require('../utils/response');

// ── GET /analytics ─────────────────────────────────────────────────────────────
exports.getSummary = async (req, res, next) => {
  try {
    const { period = 'today' } = req.query;
    const intervals = { today: '1 day', week: '7 days', month: '30 days' };
    const interval = intervals[period] || '1 day';

    const { rows: [summary] } = await query(`
      SELECT
        COUNT(*)                                              AS total_orders,
        COALESCE(SUM(grand_total), 0)                       AS total_revenue,
        COALESCE(ROUND(AVG(grand_total)::NUMERIC,2), 0)     AS avg_order_value,
        COUNT(*) FILTER (WHERE payment_status='paid')       AS paid_orders,
        COUNT(*) FILTER (WHERE status='cancelled')          AS cancelled_orders
      FROM orders
      WHERE restaurant_id=$1
        AND created_at >= NOW() - $2::INTERVAL
        AND payment_status != 'cancelled'`,
      [req.user.restaurant_id, interval]
    );

    const { rows: [tables] } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status='available')      AS available,
        COUNT(*) FILTER (WHERE status='occupied')       AS occupied,
        COUNT(*) FILTER (WHERE status='bill_requested') AS bill_requested,
        COUNT(*)                                        AS total
      FROM restaurant_tables WHERE restaurant_id=$1`,
      [req.user.restaurant_id]
    );

    return success(res, { ...summary, tables });
  } catch (err) { next(err); }
};

// ── GET /analytics/sales ───────────────────────────────────────────────────────
exports.getDailySales = async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) return error(res, 'start_date and end_date are required', 400);

    const { rows } = await query(`
      SELECT
        created_at::date                    AS date,
        COUNT(*)                            AS orders,
        COALESCE(SUM(grand_total),0)        AS revenue,
        COALESCE(ROUND(AVG(grand_total)::NUMERIC,2),0) AS avg_order_value
      FROM orders
      WHERE restaurant_id=$1
        AND created_at::date BETWEEN $2::date AND $3::date
        AND payment_status != 'cancelled'
      GROUP BY created_at::date
      ORDER BY date`,
      [req.user.restaurant_id, start_date, end_date]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /analytics/top-items ───────────────────────────────────────────────────
exports.getTopItems = async (req, res, next) => {
  try {
    const { limit = 10, period = 30 } = req.query;
    const { rows } = await query(`
      SELECT
        oi.menu_item_id,
        oi.name,
        SUM(oi.quantity)                       AS total_quantity,
        COALESCE(SUM(oi.price*oi.quantity),0)  AS total_revenue,
        COUNT(DISTINCT oi.order_id)            AS order_count
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.restaurant_id=$1
        AND o.created_at >= NOW() - ($3 || ' days')::INTERVAL
        AND o.payment_status != 'cancelled'
      GROUP BY oi.menu_item_id, oi.name
      ORDER BY total_quantity DESC
      LIMIT $2`,
      [req.user.restaurant_id, Number(limit), Number(period)]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /analytics/peak-hours ──────────────────────────────────────────────────
exports.getPeakHours = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        EXTRACT(HOUR FROM created_at)::INT  AS hour,
        COUNT(*)                            AS orders,
        COALESCE(SUM(grand_total),0)        AS revenue
      FROM orders
      WHERE restaurant_id=$1
        AND created_at >= NOW() - INTERVAL '30 days'
        AND payment_status != 'cancelled'
      GROUP BY hour ORDER BY hour`,
      [req.user.restaurant_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /analytics/tables ──────────────────────────────────────────────────────
exports.getTablePerformance = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        t.id,
        t.table_number,
        t.capacity,
        COUNT(o.id)                           AS total_orders,
        COALESCE(SUM(o.grand_total),0)        AS total_revenue,
        COALESCE(ROUND(AVG(o.grand_total)::NUMERIC,2),0) AS avg_order_value
      FROM restaurant_tables t
      LEFT JOIN orders o
        ON o.table_id=t.id AND o.payment_status='paid'
      WHERE t.restaurant_id=$1
      GROUP BY t.id, t.table_number, t.capacity
      ORDER BY total_revenue DESC`,
      [req.user.restaurant_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};
