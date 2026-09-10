'use strict';
/**
 * WebSocket Push Service
 * ============================================================
 * Provides real-time status updates to connected farmers and officers.
 *
 * Connection model:
 *   - Farmers connect with their farmer_id: /ws?type=farmer&id={farmerId}&token={jwt}
 *   - Officers connect with their center_id: /ws?type=officer&id={centerId}&token={jwt}
 *
 * Events pushed as JSON:
 *   { type: 'STATUS_UPDATE', data: { registrationId, status, ... } }
 *   { type: 'QUEUE_UPDATE',  data: { centerId, date, summary: {...} } }
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');

let wss = null;

// Maps: farmerId → Set<WebSocket>,  centerId → Set<WebSocket>
const farmerConnections = new Map();
const officerConnections = new Map();

/**
 * Attach the WebSocket server to an existing HTTP server.
 * @param {import('http').Server} httpServer
 */
function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const params = new url.URL(req.url, 'http://localhost').searchParams;
    const type = params.get('type');
    const id = parseInt(params.get('id'), 10);
    const token = params.get('token');

    // Verify JWT
    try {
      jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (type === 'farmer' && id) {
      if (!farmerConnections.has(id)) farmerConnections.set(id, new Set());
      farmerConnections.get(id).add(ws);
      ws.on('close', () => farmerConnections.get(id)?.delete(ws));
    } else if (type === 'officer' && id) {
      if (!officerConnections.has(id)) officerConnections.set(id, new Set());
      officerConnections.get(id).add(ws);
      ws.on('close', () => officerConnections.get(id)?.delete(ws));
    } else {
      ws.close(4002, 'Invalid connection parameters');
    }
  });

  console.log('🔌 WebSocket server ready on /ws');
}

/**
 * Push a status update to a specific farmer.
 * @param {number} farmerId
 * @param {object} data
 */
function pushToFarmer(farmerId, data) {
  const connections = farmerConnections.get(farmerId);
  if (!connections || connections.size === 0) return;
  const message = JSON.stringify({ type: 'STATUS_UPDATE', data });
  for (const ws of connections) {
    if (ws.readyState === 1 /* OPEN */) ws.send(message);
  }
}

/**
 * Push a queue update to all officers at a center.
 * @param {number} centerId
 * @param {object} data
 */
function pushToCenter(centerId, data) {
  const connections = officerConnections.get(centerId);
  if (!connections || connections.size === 0) return;
  const message = JSON.stringify({ type: 'QUEUE_UPDATE', data });
  for (const ws of connections) {
    if (ws.readyState === 1 /* OPEN */) ws.send(message);
  }
}

module.exports = { initWebSocket, pushToFarmer, pushToCenter };
