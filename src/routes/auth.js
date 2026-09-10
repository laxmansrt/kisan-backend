'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');

const router = express.Router();

// ============================================================
// POST /api/auth/farmer/request-otp
// ============================================================
router.post('/farmer/request-otp', (req, res) => {
  const { mobile_number } = req.body;
  if (!mobile_number) return res.status(400).json({ error: 'mobile_number required' });

  // Generate 6-digit OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  // Store as full ISO string with Z so JS Date comparison is timezone-safe
  const expiresAt = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 10) * 60000)
    .toISOString();

  // Invalidate old OTPs for this number
  db.prepare(`UPDATE otps SET used = 1 WHERE mobile_number = ? AND used = 0`).run(mobile_number);

  // Store new OTP
  db.prepare(`INSERT INTO otps (mobile_number, otp_code, expires_at) VALUES (?, ?, ?)`)
    .run(mobile_number, otp, expiresAt);

  console.log(`🔑 OTP for ${mobile_number}: ${otp} (expires ${expiresAt})`);

  // In dev mode or when Twilio is not configured, return OTP in response for demo/testing
  const response = { message: 'OTP sent', expires_in_minutes: 10 };
  if (process.env.NODE_ENV !== 'production' || !process.env.TWILIO_ACCOUNT_SID) response.dev_otp = otp;

  res.json(response);
});

// ============================================================
// POST /api/auth/farmer/verify-otp
// ============================================================
router.post('/farmer/verify-otp', (req, res) => {
  const { mobile_number, otp_code } = req.body;
  if (!mobile_number || !otp_code) {
    return res.status(400).json({ error: 'mobile_number and otp_code required' });
  }

  let record = db.prepare(`
    SELECT * FROM otps
    WHERE mobile_number = ? AND otp_code = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(mobile_number, otp_code);

  // Demo fallback: allow 123456 as universal master OTP for demo/testing
  const isMasterOtp = (otp_code === '123456');
  if (!record && !isMasterOtp) return res.status(401).json({ error: 'Invalid OTP' });

  if (record && new Date(record.expires_at) < new Date()) {
    return res.status(401).json({ error: 'OTP expired' });
  }

  // Mark OTP used
  if (record) {
    db.prepare(`UPDATE otps SET used = 1 WHERE id = ?`).run(record.id);
  }

  // Find or create farmer
  let farmer = db.prepare(`SELECT * FROM farmers WHERE mobile_number = ?`).get(mobile_number);
  const isNew = !farmer;

  if (!farmer) {
    const result = db.prepare(`
      INSERT INTO farmers (mobile_number, name, language_preference)
      VALUES (?, ?, 'en')
    `).run(mobile_number, `Farmer ${mobile_number.slice(-4)}`);
    farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(result.lastInsertRowid);
  }

  const token = jwt.sign(
    { id: farmer.id, mobile_number: farmer.mobile_number, role: 'farmer' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, farmer, is_new: isNew });
});

// ============================================================
// POST /api/auth/officer/login
// ============================================================
router.post('/officer/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const officer = db.prepare(`
    SELECT o.*, c.name as center_name, c.location as center_location
    FROM officers o
    JOIN centers c ON c.id = o.center_id
    WHERE o.username = ?
  `).get(username);

  if (!officer) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = bcrypt.compareSync(password, officer.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: officer.id, username: officer.username, center_id: officer.center_id, role: 'officer' },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );

  const { password_hash, ...officerSafe } = officer;
  res.json({ token, officer: officerSafe });
});

module.exports = router;
