'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/sih26032.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Load and execute schema on first run
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// ── Migrations (idempotent — safe to run on every startup) ──────────
// Add registered_via to existing databases that predate this column
const cols = db.pragma('table_info(crop_registrations)').map(c => c.name);
if (!cols.includes('registered_via')) {
  db.exec(`ALTER TABLE crop_registrations ADD COLUMN registered_via TEXT NOT NULL DEFAULT 'self'`);
  console.log('✅ Migration: added crop_registrations.registered_via');
}

// Convenience helpers
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

module.exports = db;
