'use strict';
const express = require('express');
const db = require('../db/db');
const { authFarmer } = require('../middleware/auth');
const { assignSlotInDb } = require('../scheduler/slotAssigner');
const { sendSlotAssignmentSms, sendStatusUpdateSms } = require('../services/sms');
const { pushToFarmer } = require('../services/push');

const router = express.Router();

// ============================================================
// GET /api/centers — list all centers with current load
// (public — no auth required so farmer can browse before registering)
// ============================================================
router.get('/centers', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const centers = db.prepare(`
    SELECT
      c.*,
      COALESCE(SUM(s.farmers_assigned_count), 0) AS today_farmers_assigned,
      c.daily_farmer_capacity AS today_capacity
    FROM centers c
    LEFT JOIN slots s ON s.center_id = c.id AND s.date = ?
    GROUP BY c.id
    ORDER BY c.name
  `).all(today);

  res.json(centers.map(c => ({
    ...c,
    load_percent: c.today_capacity > 0
      ? Math.round((c.today_farmers_assigned / c.today_capacity) * 100)
      : 0,
  })));
});

// ============================================================
// POST /api/farmers/register
// Body: { name, village, language_preference, center_id, crop_type, expected_quantity }
// Auth: Bearer JWT (farmer)
// ============================================================
router.post('/register', authFarmer, (req, res) => {
  const { name, village, language_preference, center_id, crop_type, expected_quantity } = req.body;

  if (!center_id || !crop_type || !expected_quantity) {
    return res.status(400).json({ error: 'center_id, crop_type, and expected_quantity are required' });
  }

  const farmerId = req.farmer.id;
  const today = new Date().toISOString().slice(0, 10);

  // Update farmer profile if name/village provided
  if (name || village || language_preference) {
    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (village) { updates.push('village = ?'); params.push(village); }
    if (language_preference) { updates.push('language_preference = ?'); params.push(language_preference); }
    params.push(farmerId);
    if (updates.length) {
      db.prepare(`UPDATE farmers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
  }

  // Check for an existing active registration (prevent duplicates)
  const existing = db.prepare(`
    SELECT id FROM crop_registrations
    WHERE farmer_id = ? AND status NOT IN ('paid')
    ORDER BY created_at DESC LIMIT 1
  `).get(farmerId);

  if (existing) {
    return res.status(409).json({
      error: 'You already have an active registration. Complete or pay the existing one first.',
      existing_registration_id: existing.id,
    });
  }

  // Create the registration
  const regResult = db.prepare(`
    INSERT INTO crop_registrations (farmer_id, center_id, crop_type, expected_quantity, status)
    VALUES (?, ?, ?, ?, 'registered')
  `).run(farmerId, center_id, crop_type, expected_quantity);
  const regId = regResult.lastInsertRowid;

  // Auto-assign slot
  let slotResult;
  try {
    slotResult = assignSlotInDb(db, center_id, regId, expected_quantity, today);
  } catch (err) {
    // Still return the registration (status stays 'registered'), let officer manually assign later
    console.warn('Slot assignment failed:', err.message);
    const reg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
    return res.status(202).json({
      message: 'Registered but no slot available yet — check back later',
      registration: reg,
      slot: null,
      token: null,
    });
  }

  // Fetch full state for response
  const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(farmerId);
  const center = db.prepare(`SELECT * FROM centers WHERE id = ?`).get(center_id);
  const registration = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);

  // Fire SMS (non-blocking)
  sendSlotAssignmentSms(farmer, slotResult.slot, slotResult.token.token_number, center)
    .catch(e => console.error('SMS error:', e));

  // Log in-app notification
  db.prepare(`
    INSERT INTO notification_log (farmer_id, registration_id, message, channel)
    VALUES (?, ?, ?, 'in-app')
  `).run(
    farmerId, regId,
    `Token ${slotResult.token.token_number} assigned. Visit ${center.name} on ${slotResult.slot.date} ` +
    `between ${slotResult.slot.start_time}–${slotResult.slot.end_time}.`
  );

  // Push real-time update
  pushToFarmer(farmerId, { registration, slot: slotResult.slot, token: slotResult.token });

  res.status(201).json({
    message: 'Registered and slot assigned',
    registration,
    slot: slotResult.slot,
    token: slotResult.token,
    payment: slotResult.payment,
  });
});

// ============================================================
// GET /api/farmers/:id/status
// ============================================================
router.get('/:id/status', authFarmer, (req, res) => {
  const farmerId = parseInt(req.params.id, 10);
  if (farmerId !== req.farmer.id) {
    return res.status(403).json({ error: 'Cannot access another farmer\'s status' });
  }

  const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(farmerId);
  if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

  // Get most recent active registration
  const registration = db.prepare(`
    SELECT cr.*, c.name as center_name, c.location as center_location,
           c.address as center_address, c.contact_number as center_contact
    FROM crop_registrations cr
    JOIN centers c ON c.id = cr.center_id
    WHERE cr.farmer_id = ?
    ORDER BY cr.created_at DESC LIMIT 1
  `).get(farmerId);

  if (!registration) {
    return res.json({ farmer, registration: null, token: null, slot: null, payment: null });
  }

  const token = db.prepare(`
    SELECT t.*, s.date, s.start_time, s.end_time
    FROM tokens t
    JOIN slots s ON s.id = t.slot_id
    WHERE t.registration_id = ?
  `).get(registration.id);

  const payment = db.prepare(`SELECT * FROM payments WHERE registration_id = ?`).get(registration.id);

  // Recent notifications for this farmer
  const notifications = db.prepare(`
    SELECT * FROM notification_log WHERE farmer_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(farmerId);

  res.json({ farmer, registration, token, slot: token || null, payment, notifications });
});

// ============================================================
// GET /api/farmers/:id/notifications
// ============================================================
router.get('/:id/notifications', authFarmer, (req, res) => {
  const farmerId = parseInt(req.params.id, 10);
  if (farmerId !== req.farmer.id) return res.status(403).json({ error: 'Forbidden' });

  const notifications = db.prepare(`
    SELECT * FROM notification_log WHERE farmer_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(farmerId);

  // Mark all as read
  db.prepare(`UPDATE notification_log SET read = 1 WHERE farmer_id = ? AND read = 0`).run(farmerId);

  res.json(notifications);
});

module.exports = router;
