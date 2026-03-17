const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }
    : {
        host:     process.env.PG_HOST     || 'localhost',
        port:     process.env.PG_PORT     || 5432,
        database: process.env.PG_DATABASE || 'restaurant_saas',
        user:     process.env.PG_USER     || 'postgres',
        password: process.env.PG_PASSWORD || 'password',
      }
);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Helper: run a query with auto-release
const query = (text, params) => pool.query(text, params);

// Helper: get a client for transactions
const getClient = () => pool.connect();

module.exports = { pool, query, getClient };
