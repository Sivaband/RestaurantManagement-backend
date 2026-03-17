const { query } = require('../db/pool');

const generateOrderNumber = async () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { rows } = await query(
    `SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE`
  );
  const seq = String(Number(rows[0].count) + 1).padStart(4, '0');
  return `ORD-${date}-${seq}`;
};

module.exports = { generateOrderNumber };
