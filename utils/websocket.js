const { WebSocketServer } = require('ws');

let wss = null;

// Map: restaurantId → Set of WebSocket clients
const clients = new Map();

const initWebSocket = (server) => {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const restaurantId = params.get('restaurant_id');
    const role         = params.get('role') || 'unknown';

    if (!restaurantId) {
      ws.close(1008, 'restaurant_id required');
      return;
    }

    // Register client
    if (!clients.has(restaurantId)) clients.set(restaurantId, new Set());
    clients.get(restaurantId).add(ws);

    ws.restaurantId = restaurantId;
    ws.role         = role;

    console.log(`🔌 WS connected: restaurant=${restaurantId} role=${role} (total=${clients.get(restaurantId).size})`);

    // Send welcome
    ws.send(JSON.stringify({ type: 'connected', message: `Connected as ${role}` }));

    ws.on('close', () => {
      const set = clients.get(restaurantId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) clients.delete(restaurantId);
      }
      console.log(`🔌 WS disconnected: restaurant=${restaurantId} role=${role}`);
    });

    ws.on('error', (err) => console.error('WS error:', err));
  });

  console.log('🔌 WebSocket server initialised');
  return wss;
};

// Broadcast a message to all clients of a restaurant
const broadcast = (restaurantId, payload) => {
  const set = clients.get(restaurantId);
  if (!set || !set.size) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(msg);
  }
};

module.exports = { initWebSocket, broadcast };
