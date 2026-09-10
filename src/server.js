'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initWebSocket } = require('./services/push');

const app = express();

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
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

server.listen(PORT, () => {
  console.log(`\n🚀 GovProcure API running on http://localhost:${PORT}`);
  console.log(`   WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`   Health:     http://localhost:${PORT}/api/health\n`);
});
