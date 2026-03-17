require('dotenv').config();
const { query } = require('./pool');

const migrate = async () => {
  console.log('🚀 Running PostgreSQL migrations...');

  await query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

  // ── ENUMS ──────────────────────────────────────────────────────────────────
  await query(`DO $$ BEGIN
    CREATE TYPE subscription_plan_enum AS ENUM ('free','basic','premium');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await query(`DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('owner','waiter','kitchen');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await query(`DO $$ BEGIN
    CREATE TYPE table_status_enum AS ENUM ('available','occupied','bill_requested','reserved');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await query(`DO $$ BEGIN
    CREATE TYPE order_status_enum AS ENUM ('pending','preparing','ready','delivered','cancelled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await query(`DO $$ BEGIN
    CREATE TYPE payment_status_enum AS ENUM ('pending','paid','cancelled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  await query(`DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('cash','card','upi','online');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // ── RESTAURANTS ───────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name                    VARCHAR(255) NOT NULL,
      logo_url                TEXT DEFAULT NULL,
      address                 TEXT DEFAULT NULL,
      phone                   VARCHAR(50) DEFAULT NULL,
      email                   VARCHAR(255) DEFAULT NULL,
      subscription_plan       subscription_plan_enum NOT NULL DEFAULT 'free',
      is_active               BOOLEAN NOT NULL DEFAULT TRUE,
      settings_currency       VARCHAR(10)  NOT NULL DEFAULT '₹',
      settings_timezone       VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
      settings_tax_percentage NUMERIC(5,2) NOT NULL DEFAULT 5,
      settings_service_charge NUMERIC(5,2) NOT NULL DEFAULT 0,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── USERS ─────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      name          VARCHAR(255) NOT NULL,
      email         VARCHAR(255) NOT NULL,
      password      VARCHAR(255) NOT NULL,
      role          user_role_enum NOT NULL DEFAULT 'waiter',
      avatar_url    TEXT DEFAULT NULL,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      last_login    TIMESTAMPTZ DEFAULT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(restaurant_id, email)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_restaurant_id ON users(restaurant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email)`);

  // ── CATEGORIES ────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      name          VARCHAR(255) NOT NULL,
      description   TEXT DEFAULT NULL,
      image_url     TEXT DEFAULT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_categories_restaurant_id ON categories(restaurant_id)`);

  // ── MENU ITEMS ────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      name             VARCHAR(255) NOT NULL,
      description      TEXT DEFAULT NULL,
      price            NUMERIC(10,2) NOT NULL CHECK (price >= 0),
      image_url        TEXT DEFAULT NULL,
      is_veg           BOOLEAN NOT NULL DEFAULT TRUE,
      is_available     BOOLEAN NOT NULL DEFAULT TRUE,
      preparation_time INTEGER NOT NULL DEFAULT 15,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_id ON menu_items(restaurant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_menu_items_category_id   ON menu_items(category_id)`);

  // ── MENU ITEM TAGS ────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS menu_item_tags (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      tag          VARCHAR(100) NOT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_menu_item_tags_item ON menu_item_tags(menu_item_id)`);

  // ── MENU ITEM CUSTOMIZATIONS ──────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS menu_item_customizations (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      name         VARCHAR(255) NOT NULL,
      is_required  BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order   INTEGER NOT NULL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS customization_options (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      customization_id UUID NOT NULL REFERENCES menu_item_customizations(id) ON DELETE CASCADE,
      option_value     VARCHAR(255) NOT NULL,
      sort_order       INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── RESTAURANT TABLES ─────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      table_number     VARCHAR(20) NOT NULL,
      capacity         INTEGER NOT NULL DEFAULT 4,
      status           table_status_enum NOT NULL DEFAULT 'available',
      qr_code_url      TEXT DEFAULT NULL,
      qr_data          TEXT DEFAULT NULL,
      current_order_id UUID DEFAULT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(restaurant_id, table_number)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_tables_restaurant_id ON restaurant_tables(restaurant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tables_status        ON restaurant_tables(status)`);

  // ── ORDERS ────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id         UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      table_id              UUID NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
      table_number          VARCHAR(20) NOT NULL,
      status                order_status_enum NOT NULL DEFAULT 'pending',
      total_amount          NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
      tax_amount            NUMERIC(10,2) NOT NULL DEFAULT 0,
      service_charge        NUMERIC(10,2) NOT NULL DEFAULT 0,
      grand_total           NUMERIC(10,2) NOT NULL DEFAULT 0,
      special_instructions  TEXT DEFAULT NULL,
      payment_status        payment_status_enum NOT NULL DEFAULT 'pending',
      payment_method        payment_method_enum DEFAULT NULL,
      order_number          VARCHAR(50) NOT NULL UNIQUE,
      customer_name         VARCHAR(255) DEFAULT NULL,
      customer_phone        VARCHAR(50) DEFAULT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id  ON orders(restaurant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_table_id       ON orders(table_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at)`);

  // ── ORDER ITEMS ───────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id   UUID NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
      name           VARCHAR(255) NOT NULL,
      price          NUMERIC(10,2) NOT NULL,
      quantity       INTEGER NOT NULL CHECK (quantity >= 1),
      customizations TEXT DEFAULT NULL,
      notes          TEXT DEFAULT NULL
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`);

  // Deferred FK: restaurant_tables.current_order_id → orders
  await query(`
    DO $$ BEGIN
      ALTER TABLE restaurant_tables
        ADD CONSTRAINT fk_tables_current_order
        FOREIGN KEY (current_order_id) REFERENCES orders(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$
  `);

  // ── INVENTORY ─────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      name          VARCHAR(255) NOT NULL,
      unit          VARCHAR(50) NOT NULL,
      current_stock NUMERIC(10,3) NOT NULL DEFAULT 0,
      minimum_stock NUMERIC(10,3) NOT NULL DEFAULT 0,
      cost_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
      is_low_stock  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_inventory_restaurant_id ON inventory(restaurant_id)`);

  // ── REFRESH TOKENS ────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── AUTO updated_at TRIGGER ───────────────────────────────────────────────
  await query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql
  `);

  for (const tbl of ['restaurants','users','categories','menu_items','restaurant_tables','orders','inventory']) {
    await query(`
      DROP TRIGGER IF EXISTS trg_${tbl}_updated_at ON ${tbl};
      CREATE TRIGGER trg_${tbl}_updated_at
        BEFORE UPDATE ON ${tbl}
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
  }

  console.log('✅ Migrations complete!');
  process.exit(0);
};

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
