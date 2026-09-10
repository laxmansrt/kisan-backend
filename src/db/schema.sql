-- ============================================================
-- SIH26032 Smart Farmer Procurement System
-- Database Schema (SQLite compatible)
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- Centers — Procurement centers (APMCs)
-- ============================================================
CREATE TABLE IF NOT EXISTS centers (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL,
  location                TEXT    NOT NULL,
  latitude                REAL,
  longitude               REAL,
  daily_capacity_quintals REAL    NOT NULL DEFAULT 500,
  daily_farmer_capacity   INTEGER NOT NULL DEFAULT 100,
  address                 TEXT,
  contact_number          TEXT,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Officers — Center staff with login credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS officers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  username     TEXT    NOT NULL UNIQUE,
  password_hash TEXT   NOT NULL,
  center_id    INTEGER NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Farmers — Registered farmers
-- ============================================================
CREATE TABLE IF NOT EXISTS farmers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  mobile_number       TEXT    NOT NULL UNIQUE,
  village             TEXT,
  location            TEXT,
  language_preference TEXT    NOT NULL DEFAULT 'en',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- OTPs — Temporary OTP store (in-memory alternative)
-- ============================================================
CREATE TABLE IF NOT EXISTS otps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mobile_number TEXT   NOT NULL,
  otp_code     TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Slots — Time slots at a center on a specific date
-- ============================================================
CREATE TABLE IF NOT EXISTS slots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id             INTEGER NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  date                  TEXT    NOT NULL,  -- YYYY-MM-DD
  start_time            TEXT    NOT NULL,  -- HH:MM
  end_time              TEXT    NOT NULL,  -- HH:MM
  max_farmers           INTEGER NOT NULL DEFAULT 25,
  farmers_assigned_count INTEGER NOT NULL DEFAULT 0,
  allocated_quintals    REAL    NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(center_id, date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_slots_center_date ON slots(center_id, date);

-- ============================================================
-- Crop Registrations — Farmer's crop procurement request
-- ============================================================
CREATE TABLE IF NOT EXISTS crop_registrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id         INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
  center_id         INTEGER NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  crop_type         TEXT    NOT NULL,
  expected_quantity REAL    NOT NULL,  -- in quintals
  status            TEXT    NOT NULL DEFAULT 'registered'
                    CHECK(status IN (
                      'registered', 'approved', 'scheduled',
                      'at_center', 'procured', 'payment_processing', 'paid'
                    )),
  registered_via    TEXT    NOT NULL DEFAULT 'self',
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reg_farmer ON crop_registrations(farmer_id);
CREATE INDEX IF NOT EXISTS idx_reg_center ON crop_registrations(center_id);
CREATE INDEX IF NOT EXISTS idx_reg_status ON crop_registrations(status);

-- ============================================================
-- Tokens — Assigned slot + sequential token number
-- ============================================================
CREATE TABLE IF NOT EXISTS tokens (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL UNIQUE REFERENCES crop_registrations(id) ON DELETE CASCADE,
  slot_id          INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  token_number     INTEGER NOT NULL,
  actual_quantity  REAL,   -- filled in after procurement
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slot_id, token_number)
);
CREATE INDEX IF NOT EXISTS idx_tokens_slot ON tokens(slot_id);

-- ============================================================
-- Payments — Payment record per registration
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL UNIQUE REFERENCES crop_registrations(id) ON DELETE CASCADE,
  amount          REAL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'processing', 'completed')),
  payment_ref     TEXT,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Notification Log — In-app notification history
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farmer_id       INTEGER REFERENCES farmers(id) ON DELETE CASCADE,
  registration_id INTEGER REFERENCES crop_registrations(id) ON DELETE SET NULL,
  message         TEXT    NOT NULL,
  channel         TEXT    NOT NULL DEFAULT 'in-app',  -- 'in-app' | 'sms'
  read            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_farmer ON notification_log(farmer_id);
