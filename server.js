require('dotenv').config();
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const { pool }   = require('./db/pool');
const { initWebSocket } = require('./utils/websocket');
const errorHandler = require('./middleware/errorHandler');

const app    = express();
const server = http.createServer(app);

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// Request logger (dev)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────────
const BASE = '/api/v1';
app.use(`${BASE}/auth`,        require('./routes/auth'));
app.use(`${BASE}/restaurant`,  require('./routes/restaurant'));
app.use(`${BASE}/menu`,        require('./routes/menu'));
app.use(`${BASE}/tables`,      require('./routes/tables'));
app.use(`${BASE}/orders`,      require('./routes/orders'));
app.use(`${BASE}/staff`,       require('./routes/staff'));
app.use(`${BASE}/analytics`,   require('./routes/analytics'));
app.use(`${BASE}/inventory`,   require('./routes/inventory'));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── Error handler ──────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── WebSocket ──────────────────────────────────────────────────────────────────
initWebSocket(server);

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', async () => {
  try {
    await pool.query('SELECT 1');
    console.log(`
╔══════════════════════════════════════════════════════╗
║   🍽️  Restaurant SaaS API — PostgreSQL Edition       ║
╠══════════════════════════════════════════════════════╣
║  🚀 Server  : http://localhost:${PORT}                  ║
║  🗄  Database: PostgreSQL ✅                          ║
║  🔌 WebSocket: ws://localhost:${PORT}/ws               ║
║  🏥 Health  : http://localhost:${PORT}/health           ║
╚══════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Make sure PostgreSQL is running and DATABASE_URL is correct in .env');
  }
});

module.exports = { app, server };
