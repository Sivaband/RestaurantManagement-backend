const { query, getClient } = require('../db/pool');
const { success, error } = require('../utils/response');

// ── Helper: fetch item with tags & customizations ──────────────────────────────
const getItemById = async (itemId, restaurantId) => {
  const { rows } = await query(`
    SELECT m.*,
      COALESCE(
        JSON_AGG(DISTINCT t.tag) FILTER (WHERE t.tag IS NOT NULL), '[]'
      ) AS tags,
      COALESCE(
        JSON_AGG(DISTINCT jsonb_build_object(
          'id', c.id, 'name', c.name, 'is_required', c.is_required,
          'options', (
            SELECT COALESCE(JSON_AGG(o.option_value ORDER BY o.sort_order),'[]')
            FROM customization_options o WHERE o.customization_id = c.id
          )
        )) FILTER (WHERE c.id IS NOT NULL), '[]'
      ) AS customizations
    FROM menu_items m
    LEFT JOIN menu_item_tags t ON t.menu_item_id = m.id
    LEFT JOIN menu_item_customizations c ON c.menu_item_id = m.id
    WHERE m.id = $1 AND m.restaurant_id = $2
    GROUP BY m.id`,
    [itemId, restaurantId]
  );
  return rows[0] || null;
};

// ── GET /menu/public ───────────────────────────────────────────────────────────
exports.getPublicMenu = async (req, res, next) => {
  try {
    const { restaurant_id } = req.query;
    if (!restaurant_id) return error(res, 'restaurant_id is required', 400);

    const [catResult, itemResult] = await Promise.all([
      query(`
        SELECT id, name, description, image_url, sort_order
        FROM categories
        WHERE restaurant_id = $1 AND is_active = TRUE
        ORDER BY sort_order`, [restaurant_id]
      ),
      query(`
        SELECT m.id, m.category_id, m.name, m.description, m.price,
               m.image_url, m.is_veg, m.is_available, m.preparation_time,
               COALESCE(JSON_AGG(DISTINCT t.tag) FILTER (WHERE t.tag IS NOT NULL),'[]') AS tags,
               COALESCE(JSON_AGG(DISTINCT jsonb_build_object(
                 'id', c.id, 'name', c.name, 'is_required', c.is_required,
                 'options', (
                   SELECT COALESCE(JSON_AGG(o.option_value ORDER BY o.sort_order),'[]')
                   FROM customization_options o WHERE o.customization_id = c.id
                 )
               )) FILTER (WHERE c.id IS NOT NULL),'[]') AS customizations
        FROM menu_items m
        LEFT JOIN menu_item_tags t ON t.menu_item_id = m.id
        LEFT JOIN menu_item_customizations c ON c.menu_item_id = m.id
        WHERE m.restaurant_id = $1 AND m.is_available = TRUE
        GROUP BY m.id ORDER BY m.sort_order`, [restaurant_id]
      ),
    ]);

    return success(res, { categories: catResult.rows, items: itemResult.rows });
  } catch (err) { next(err); }
};

// ── GET /menu/categories ───────────────────────────────────────────────────────
exports.getCategories = async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM categories WHERE restaurant_id = $1 ORDER BY sort_order`,
      [req.user.restaurant_id]
    );
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── POST /menu/categories ──────────────────────────────────────────────────────
exports.createCategory = async (req, res, next) => {
  try {
    const { name, description, image_url, sort_order } = req.body;
    if (!name) return error(res, 'Category name is required', 400);
    const { rows } = await query(
      `INSERT INTO categories (restaurant_id, name, description, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.restaurant_id, name, description || null, image_url || null, sort_order ?? 0]
    );
    return success(res, rows[0], 'Category created', 201);
  } catch (err) { next(err); }
};

// ── PUT /menu/categories/:id ───────────────────────────────────────────────────
exports.updateCategory = async (req, res, next) => {
  try {
    const { name, description, image_url, sort_order, is_active } = req.body;
    const { rows } = await query(`
      UPDATE categories SET
        name        = COALESCE($3, name),
        description = COALESCE($4, description),
        image_url   = COALESCE($5, image_url),
        sort_order  = COALESCE($6, sort_order),
        is_active   = COALESCE($7, is_active)
      WHERE id = $2 AND restaurant_id = $1 RETURNING *`,
      [req.user.restaurant_id, req.params.id, name, description, image_url, sort_order, is_active]
    );
    if (!rows[0]) return error(res, 'Category not found', 404);
    return success(res, rows[0], 'Category updated');
  } catch (err) { next(err); }
};

// ── DELETE /menu/categories/:id ────────────────────────────────────────────────
exports.deleteCategory = async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM categories WHERE id = $1 AND restaurant_id = $2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rowCount) return error(res, 'Category not found', 404);
    return success(res, {}, 'Category deleted');
  } catch (err) { next(err); }
};

// ── GET /menu/items ────────────────────────────────────────────────────────────
exports.getItems = async (req, res, next) => {
  try {
    const { category_id, available_only } = req.query;
    let sql = `
      SELECT m.id, m.category_id, m.name, m.description, m.price,
             m.image_url, m.is_veg, m.is_available, m.preparation_time, m.sort_order,
             COALESCE(JSON_AGG(DISTINCT t.tag) FILTER (WHERE t.tag IS NOT NULL),'[]') AS tags
      FROM menu_items m
      LEFT JOIN menu_item_tags t ON t.menu_item_id = m.id
      WHERE m.restaurant_id = $1`;
    const params = [req.user.restaurant_id];

    if (category_id) { params.push(category_id); sql += ` AND m.category_id = $${params.length}`; }
    if (available_only === 'true') sql += ` AND m.is_available = TRUE`;

    sql += ` GROUP BY m.id ORDER BY m.sort_order`;
    const { rows } = await query(sql, params);
    return success(res, rows);
  } catch (err) { next(err); }
};

// ── GET /menu/items/:id ────────────────────────────────────────────────────────
exports.getItemById = async (req, res, next) => {
  try {
    const item = await getItemById(req.params.id, req.user.restaurant_id);
    if (!item) return error(res, 'Item not found', 404);
    return success(res, item);
  } catch (err) { next(err); }
};

// ── POST /menu/items ───────────────────────────────────────────────────────────
exports.createItem = async (req, res, next) => {
  const client = await getClient();
  try {
    const { category_id, name, description, price, is_veg, image_url,
            tags, customizations, preparation_time, sort_order } = req.body;

    if (!category_id || !name || price === undefined) {
      return error(res, 'category_id, name, price are required', 400);
    }

    await client.query('BEGIN');

    const { rows: [item] } = await client.query(`
      INSERT INTO menu_items
        (restaurant_id, category_id, name, description, price, is_veg,
         image_url, preparation_time, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.restaurant_id, category_id, name, description || null,
       price, is_veg ?? true, image_url || null, preparation_time ?? 15, sort_order ?? 0]
    );

    if (tags?.length) {
      for (const tag of tags) {
        await client.query(`INSERT INTO menu_item_tags (menu_item_id, tag) VALUES ($1,$2)`, [item.id, tag]);
      }
    }

    if (customizations?.length) {
      for (let i = 0; i < customizations.length; i++) {
        const c = customizations[i];
        const { rows: [cr] } = await client.query(
          `INSERT INTO menu_item_customizations (menu_item_id, name, is_required, sort_order)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [item.id, c.name, c.required ?? false, i]
        );
        for (let j = 0; j < (c.options || []).length; j++) {
          await client.query(
            `INSERT INTO customization_options (customization_id, option_value, sort_order) VALUES ($1,$2,$3)`,
            [cr.id, c.options[j], j]
          );
        }
      }
    }

    await client.query('COMMIT');
    const full = await getItemById(item.id, req.user.restaurant_id);
    return success(res, full, 'Item created', 201);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ── PUT /menu/items/:id ────────────────────────────────────────────────────────
exports.updateItem = async (req, res, next) => {
  const client = await getClient();
  try {
    const { name, description, price, is_veg, image_url,
            tags, customizations, preparation_time, sort_order, is_available, category_id } = req.body;

    await client.query('BEGIN');

    const { rows } = await client.query(`
      UPDATE menu_items SET
        name             = COALESCE($3, name),
        description      = COALESCE($4, description),
        price            = COALESCE($5, price),
        is_veg           = COALESCE($6, is_veg),
        image_url        = COALESCE($7, image_url),
        preparation_time = COALESCE($8, preparation_time),
        sort_order       = COALESCE($9, sort_order),
        is_available     = COALESCE($10, is_available),
        category_id      = COALESCE($11, category_id)
      WHERE id = $2 AND restaurant_id = $1 RETURNING *`,
      [req.user.restaurant_id, req.params.id, name, description, price,
       is_veg, image_url, preparation_time, sort_order, is_available, category_id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return error(res, 'Item not found', 404); }

    // Replace tags if provided
    if (tags !== undefined) {
      await client.query(`DELETE FROM menu_item_tags WHERE menu_item_id = $1`, [req.params.id]);
      for (const tag of tags) {
        await client.query(`INSERT INTO menu_item_tags (menu_item_id, tag) VALUES ($1,$2)`, [req.params.id, tag]);
      }
    }

    // Replace customizations if provided
    if (customizations !== undefined) {
      await client.query(`DELETE FROM menu_item_customizations WHERE menu_item_id = $1`, [req.params.id]);
      for (let i = 0; i < customizations.length; i++) {
        const c = customizations[i];
        const { rows: [cr] } = await client.query(
          `INSERT INTO menu_item_customizations (menu_item_id, name, is_required, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.params.id, c.name, c.required ?? false, i]
        );
        for (let j = 0; j < (c.options || []).length; j++) {
          await client.query(
            `INSERT INTO customization_options (customization_id, option_value, sort_order) VALUES ($1,$2,$3)`,
            [cr.id, c.options[j], j]
          );
        }
      }
    }

    await client.query('COMMIT');
    const full = await getItemById(req.params.id, req.user.restaurant_id);
    return success(res, full, 'Item updated');
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ── DELETE /menu/items/:id ─────────────────────────────────────────────────────
exports.deleteItem = async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM menu_items WHERE id = $1 AND restaurant_id = $2`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rowCount) return error(res, 'Item not found', 404);
    return success(res, {}, 'Item deleted');
  } catch (err) { next(err); }
};

// ── PATCH /menu/items/:id/toggle ───────────────────────────────────────────────
exports.toggleAvailability = async (req, res, next) => {
  try {
    const { rows } = await query(`
      UPDATE menu_items SET is_available = NOT is_available
      WHERE id = $1 AND restaurant_id = $2
      RETURNING id, name, is_available`,
      [req.params.id, req.user.restaurant_id]
    );
    if (!rows[0]) return error(res, 'Item not found', 404);
    return success(res, rows[0], `Item ${rows[0].is_available ? 'enabled' : 'disabled'}`);
  } catch (err) { next(err); }
};
