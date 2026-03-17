const { query, getClient } = require('../db/pool');
const { success, error } = require('../utils/response');
const { generateOrderNumber } = require('../utils/orderNumber');
const { broadcast } = require('../utils/websocket');

// ── Helper: fetch full order ───────────────────────────────────────────────────
const getFullOrder = async (orderId) => {
  const { rows } = await query(`
    SELECT o.*,
      JSON_AGG(jsonb_build_object(
        'id', oi.id, 'menu_item_id', oi.menu_item_id,
        'name', oi.name, 'price', oi.price,
        'quantity', oi.quantity, 'notes', oi.notes,
        'customizations', oi.customizations
      ) ORDER BY oi.id) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id`,
    [orderId]
  );
  return rows[0] || null;
};

// ── POST /orders/customer  (public — QR) ──────────────────────────────────────
exports.placeCustomerOrder = async (req, res, next) => {
  const client = await getClient();
  try {
    const { restaurant_id, table_id, items, special_instructions, customer_name, customer_phone } = req.body;

    if (!restaurant_id || !table_id || !items?.length) {
      return error(res, 'restaurant_id, table_id, items are required', 400);
    }

    await client.query('BEGIN');

    // Verify table
    const { rows: tableRows } = await client.query(
      `SELECT id, table_number FROM restaurant_tables WHERE id = $1 AND restaurant_id = $2`,
      [table_id, restaurant_id]
    );
    if (!tableRows[0]) { await client.query('ROLLBACK'); return error(res, 'Table not found', 404); }
    const table = tableRows[0];

    // Fetch restaurant settings for tax/service
    const { rows: [restSettings] } = await client.query(
      `SELECT settings_tax_percentage, settings_service_charge FROM restaurants WHERE id = $1`,
      [restaurant_id]
    );

    // Validate & price items from DB (never trust client prices)
    const itemIds = items.map(i => i.menu_item_id);
    const { rows: menuItems } = await client.query(
      `SELECT id, name, price, is_available FROM menu_items WHERE id = ANY($1) AND restaurant_id = $2`,
      [itemIds, restaurant_id]
    );
    const itemMap = Object.fromEntries(menuItems.map(m => [m.id, m]));

    let total = 0;
    const enriched = [];
    for (const i of items) {
      const m = itemMap[i.menu_item_id];
      if (!m) { await client.query('ROLLBACK'); return error(res, `Item ${i.menu_item_id} not found`, 404); }
      if (!m.is_available) { await client.query('ROLLBACK'); return error(res, `${m.name} is not available`, 400); }
      total += m.price * i.quantity;
      enriched.push({ ...i, name: m.name, price: m.price });
    }

    const taxPct     = Number(restSettings.settings_tax_percentage) || 0;
    const svcPct     = Number(restSettings.settings_service_charge) || 0;
    const taxAmt     = parseFloat((total * taxPct / 100).toFixed(2));
    const svcAmt     = parseFloat((total * svcPct / 100).toFixed(2));
    const grandTotal = parseFloat((total + taxAmt + svcAmt).toFixed(2));
    const orderNumber = await generateOrderNumber();

    const { rows: [order] } = await client.query(`
      INSERT INTO orders
        (restaurant_id, table_id, table_number, total_amount, tax_amount,
         service_charge, grand_total, special_instructions,
         customer_name, customer_phone, order_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [restaurant_id, table_id, table.table_number, total, taxAmt,
       svcAmt, grandTotal, special_instructions || null,
       customer_name || null, customer_phone || null, orderNumber]
    );

    for (const item of enriched) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, customizations, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.id, item.menu_item_id, item.name, item.price,
         item.quantity, item.customizations || null, item.notes || null]
      );
    }

    await client.query(
      `UPDATE restaurant_tables SET status='occupied', current_order_id=$2 WHERE id=$1`,
      [table_id, order.id]
    );

    await client.query('COMMIT');

    const fullOrder = await getFullOrder(order.id);

    // Broadcast to kitchen/waiters via WebSocket
    broadcast(restaurant_id, { type: 'new_order', order: fullOrder });

    return success(res, {
      order_id: order.id,
      order_number: order.order_number,
      status: order.status,
      total_amount: order.total_amount,
      grand_total: order.grand_total,
      items: fullOrder.items,
    }, 'Order placed', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ── GET /orders ────────────────────────────────────────────────────────────────
exports.getOrders = async (req, res, next) => {
  try {
    const { status, table_id, date } = req.query;
    let sql = `
      SELECT o.*,
        JSON_AGG(jsonb_build_object(
          'id', oi.id, 'menu_item_id', oi.menu_item_id,
          'name', oi.name, 'price', oi.price,
          'quantity', oi.quantity, 'notes', oi.notes
        ) ORDER BY oi.id) AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.restaurant_id = $1`;
    const params = [req.user.restaurant_id];

    if (status === 'active') {
      sql += ` AND o.status NOT IN ('delivered','cancelled')`;
    } else if (status) {
      params.push(status); sql += ` AND o.status = $${params.length}`;
    }
    if (table_id) { params.push(table_id); sql += ` AND o.table_id = $${params.length}`; }
    if (date)     { params.push(date);     sql += ` AND o.created_at::date = $${params.length}`; }

    sql += ` GROUP BY o.id ORDER BY o.created_at DESC`;
    const { rows } = await query(sql, params);
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /orders/:id ────────────────────────────────────────────────────────────
exports.getOrderById = async (req, res, next) => {
  try {
    const order = await getFullOrder(req.params.id);
    if (!order || order.restaurant_id !== req.user.restaurant_id) {
      return error(res, 'Order not found', 404);
    }
    return success(res, order);
  } catch (err) { next(err); }
};

// ── POST /orders  (staff manual) ──────────────────────────────────────────────
exports.createOrder = async (req, res, next) => {
  req.body.restaurant_id = req.user.restaurant_id;
  return exports.placeCustomerOrder(req, res, next);
};

// ── PATCH /orders/:id/status ───────────────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['pending','preparing','ready','delivered','cancelled'];
    if (!allowed.includes(status)) return error(res, `Status must be one of: ${allowed.join(', ')}`, 400);

    const { rows } = await query(`
      UPDATE orders SET status = $3
      WHERE id = $2 AND restaurant_id = $1 RETURNING *`,
      [req.user.restaurant_id, req.params.id, status]
    );
    if (!rows[0]) return error(res, 'Order not found', 404);

    const fullOrder = await getFullOrder(rows[0].id);
    broadcast(req.user.restaurant_id, { type: 'order_update', order: fullOrder });

    // If all table orders delivered → notify
    if (status === 'delivered') {
      const { rows: pending } = await query(
        `SELECT id FROM orders WHERE table_id=$1 AND status NOT IN ('delivered','cancelled')`,
        [rows[0].table_id]
      );
      if (!pending.length) {
        broadcast(req.user.restaurant_id, {
          type: 'all_orders_delivered',
          table_id: rows[0].table_id,
          table_number: rows[0].table_number,
        });
      }
    }

    return success(res, rows[0], 'Order status updated');
  } catch (err) { next(err); }
};

// ── POST /orders/request-bill ──────────────────────────────────────────────────
exports.requestBill = async (req, res, next) => {
  try {
    const { table_id } = req.body;
    if (!table_id) return error(res, 'table_id required', 400);

    const { rows: [tbl] } = await query(
      `UPDATE restaurant_tables SET status='bill_requested'
       WHERE id=$1 AND restaurant_id=$2 RETURNING id, table_number`,
      [table_id, req.user.restaurant_id]
    );
    if (!tbl) return error(res, 'Table not found', 404);

    const { rows: [bill] } = await query(
      `SELECT SUM(grand_total) AS total_amount FROM orders
       WHERE table_id=$1 AND payment_status='pending'`,
      [table_id]
    );

    broadcast(req.user.restaurant_id, {
      type: 'bill_requested',
      table_id,
      table_number: tbl.table_number,
      total_amount: bill.total_amount,
    });

    return success(res, { table_id, total_amount: bill.total_amount }, 'Bill requested');
  } catch (err) { next(err); }
};

// ── POST /orders/mark-payment ──────────────────────────────────────────────────
exports.markPayment = async (req, res, next) => {
  const client = await getClient();
  try {
    const { table_id, payment_method } = req.body;
    if (!table_id || !payment_method) return error(res, 'table_id and payment_method are required', 400);

    const validMethods = ['cash', 'card', 'upi', 'online'];
    if (!validMethods.includes(payment_method)) {
      return error(res, `payment_method must be one of: ${validMethods.join(', ')}`, 400);
    }

    await client.query('BEGIN');
    await client.query(`
      UPDATE orders SET payment_status='paid', payment_method=$3, status='delivered'
      WHERE restaurant_id=$1 AND table_id=$2 AND payment_status='pending'`,
      [req.user.restaurant_id, table_id, payment_method]
    );
    await client.query(`
      UPDATE restaurant_tables SET status='available', current_order_id=NULL
      WHERE id=$1 AND restaurant_id=$2`,
      [table_id, req.user.restaurant_id]
    );
    await client.query('COMMIT');

    broadcast(req.user.restaurant_id, { type: 'table_cleared', table_id });
    return success(res, {}, 'Payment recorded, table cleared');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ── GET /orders/bill/:table_id ─────────────────────────────────────────────────
exports.getBill = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT o.id, o.order_number, o.table_number, o.status,
             o.total_amount, o.tax_amount, o.service_charge, o.grand_total,
             o.created_at,
             JSON_AGG(jsonb_build_object(
               'name', oi.name, 'price', oi.price, 'quantity', oi.quantity
             ) ORDER BY oi.id) AS items
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.restaurant_id=$1 AND o.table_id=$2 AND o.payment_status='pending'
      GROUP BY o.id ORDER BY o.created_at`,
      [req.user.restaurant_id, req.params.table_id]
    );

    const grandTotal = rows.reduce((s, o) => s + Number(o.grand_total), 0);
    return success(res, { orders: rows, grand_total: grandTotal.toFixed(2) });
  } catch (err) { next(err); }
};
