'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initWebSocket } = require('./services/push');
const db = require('./db/db');
const { seed } = require('./db/seed');

// Auto-seed database if empty (ensures demo APMC centers & officers exist on first cloud deploy)
try {
  const count = db.prepare('SELECT COUNT(*) as count FROM officers').get().count;
  if (count === 0) {
    console.log('🌱 Database is empty — running seed...');
    seed();
  }
} catch (e) {
  console.warn('Auto-seed check error:', e.message);
}

const app = express();

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio webhooks POST form-encoded data

// ── Routes ────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/centers', require('./routes/centers'));
app.use('/api/farmers', require('./routes/farmers'));
app.use('/api/officer', require('./routes/officer'));
app.use('/api/ivr',    require('./routes/ivr'));

// ── Health check ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 GovProcure API running on http://0.0.0.0:${PORT}`);
  console.log(`   WebSocket:  ws://0.0.0.0:${PORT}/ws`);
  console.log(`   Health:     http://0.0.0.0:${PORT}/api/health\n`);
});

