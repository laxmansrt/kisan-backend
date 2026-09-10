'use strict';
const express = require('express');
const db = require('../db/db');
const { authOfficer } = require('../middleware/auth');
const { sendStatusUpdateSms } = require('../services/sms');
const { pushToFarmer, pushToCenter } = require('../services/push');

const router = express.Router();

// All officer routes require officer JWT
router.use(authOfficer);

// ============================================================
// GET /api/officer/dashboard?center_id=&date=
// ============================================================
router.get('/dashboard', (req, res) => {
  const centerId = req.query.center_id || req.officer.center_id;
  const date = req.query.date || new Date().toISOString().slice(0, 10);

  // KPI summary
  const summary = db.prepare(`
    SELECT
      COUNT(cr.id)                                                        AS total,
      SUM(CASE WHEN cr.status = 'paid' THEN 1 ELSE 0 END)               AS paid,
      SUM(CASE WHEN cr.status = 'payment_processing' THEN 1 ELSE 0 END) AS payment_processing,
      SUM(CASE WHEN cr.status = 'procured' THEN 1 ELSE 0 END)           AS procured,
      SUM(CASE WHEN cr.status = 'at_center' THEN 1 ELSE 0 END)          AS at_center,
      SUM(CASE WHEN cr.status = 'scheduled' THEN 1 ELSE 0 END)          AS scheduled,
      SUM(CASE WHEN cr.status = 'approved' THEN 1 ELSE 0 END)           AS approved,
      SUM(CASE WHEN cr.status = 'registered' THEN 1 ELSE 0 END)         AS registered,
      SUM(COALESCE(t.actual_quantity, 0))                                AS total_procured_quintals
    FROM crop_registrations cr
    JOIN tokens t ON t.registration_id = cr.id
    JOIN slots s ON s.id = t.slot_id
    WHERE cr.center_id = ? AND s.date = ?
  `).get(centerId, date);

  // Per-slot breakdown
  const slots = db.prepare(`
    SELECT
      s.id, s.start_time, s.end_time, s.max_farmers, s.farmers_assigned_count,
      COUNT(cr.id) AS total_registrations,
      SUM(CASE WHEN cr.status IN ('procured','payment_processing','paid') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN cr.status IN ('registered','approved','scheduled') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN cr.status = 'at_center' THEN 1 ELSE 0 END) AS at_center
    FROM slots s
    LEFT JOIN tokens t ON t.slot_id = s.id
    LEFT JOIN crop_registrations cr ON cr.id = t.registration_id
    WHERE s.center_id = ? AND s.date = ?
    GROUP BY s.id
    ORDER BY s.start_time
  `).all(centerId, date);

  res.json({ date, center_id: centerId, summary, slots });
});

// ============================================================
// GET /api/officer/registrations?center_id=&date=&status=&page=&limit=
// ============================================================
router.get('/registrations', (req, res) => {
  const centerId = req.query.center_id || req.officer.center_id;
  const date = req.query.date;
  const status = req.query.status;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  let where = 'WHERE cr.center_id = ?';
  const params = [centerId];

  if (date) {
    where += ' AND s.date = ?';
    params.push(date);
  }
  if (status) {
    where += ' AND cr.status = ?';
    params.push(status);
  }

  const rows = db.prepare(`
    SELECT
      cr.*,
      f.name AS farmer_name, f.mobile_number, f.village,
      t.token_number, t.actual_quantity, t.id AS token_id,
      s.date AS slot_date, s.start_time, s.end_time,
      p.amount, p.status AS payment_status
    FROM crop_registrations cr
    JOIN farmers f ON f.id = cr.farmer_id
    LEFT JOIN tokens t ON t.registration_id = cr.id
    LEFT JOIN slots s ON s.id = t.slot_id
    LEFT JOIN payments p ON p.registration_id = cr.id
    ${where}
    ORDER BY s.date ASC, s.start_time ASC, t.token_number ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(cr.id) AS count
    FROM crop_registrations cr
    LEFT JOIN tokens t ON t.registration_id = cr.id
    LEFT JOIN slots s ON s.id = t.slot_id
    ${where}
  `).get(...params)?.count || 0;

  res.json({ registrations: rows, total, page, limit });
});

// ============================================================
// POST /api/officer/registrations/:id/approve
// ============================================================
router.post('/registrations/:id/approve', (req, res) => {
  const regId = parseInt(req.params.id);
  const reg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  if (reg.center_id !== req.officer.center_id) return res.status(403).json({ error: 'Not your center' });

  db.prepare(`
    UPDATE crop_registrations SET status = 'approved', updated_at = datetime('now') WHERE id = ?
  `).run(regId);

  const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(reg.farmer_id);
  const token = db.prepare(`SELECT t.*, s.* FROM tokens t JOIN slots s ON s.id = t.slot_id WHERE t.registration_id = ?`).get(regId);
  const updatedReg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);

  // Notify farmer
  const message = `Your registration has been approved.${token ? ` Token: ${token.token_number}, Date: ${token.date}, ${token.start_time}–${token.end_time}` : ''}`;
  db.prepare(`INSERT INTO notification_log (farmer_id, registration_id, message) VALUES (?, ?, ?)`).run(farmer.id, regId, message);
  pushToFarmer(farmer.id, { registration: updatedReg, token });
  pushToCenter(req.officer.center_id, { type: 'registration_approved', registration_id: regId });

  sendStatusUpdateSms(farmer, 'approved', reg.crop_type).catch(console.error);

  res.json({ message: 'Approved', registration: updatedReg });
});

// ============================================================
// POST /api/officer/registrations/:id/mark-at-center
// ============================================================
router.post('/registrations/:id/mark-at-center', (req, res) => {
  const regId = parseInt(req.params.id);
  const reg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });

  db.prepare(`UPDATE crop_registrations SET status = 'at_center', updated_at = datetime('now') WHERE id = ?`).run(regId);

  const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(reg.farmer_id);
  const updatedReg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);

  db.prepare(`INSERT INTO notification_log (farmer_id, registration_id, message) VALUES (?, ?, ?)`).run(
    farmer.id, regId, 'You have been marked as present at the center. Please proceed to the procurement counter.'
  );
  pushToFarmer(farmer.id, { registration: updatedReg });
  pushToCenter(req.officer.center_id, { type: 'farmer_at_center', registration_id: regId });

  res.json({ message: 'Marked at center', registration: updatedReg });
});

// ============================================================
// POST /api/officer/registrations/:id/procure
// Body: { actual_quantity }
// ============================================================
router.post('/registrations/:id/procure', (req, res) => {
  const regId = parseInt(req.params.id);
  const { actual_quantity } = req.body;

  if (!actual_quantity || actual_quantity <= 0) {
    return res.status(400).json({ error: 'actual_quantity must be a positive number' });
  }

  const reg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  if (reg.center_id !== req.officer.center_id) return res.status(403).json({ error: 'Not your center' });

  db.transaction(() => {
    db.prepare(`UPDATE tokens SET actual_quantity = ? WHERE registration_id = ?`).run(actual_quantity, regId);
    db.prepare(`UPDATE crop_registrations SET status = 'procured', updated_at = datetime('now') WHERE id = ?`).run(regId);
  })();

  const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(reg.farmer_id);
  const updatedReg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);

  db.prepare(`INSERT INTO notification_log (farmer_id, registration_id, message) VALUES (?, ?, ?)`).run(
    farmer.id, regId, `Your ${reg.crop_type} (${actual_quantity} quintals) has been procured. Payment will be processed soon.`
  );
  pushToFarmer(farmer.id, { registration: updatedReg });
  pushToCenter(req.officer.center_id, { type: 'procured', registration_id: regId });

  sendStatusUpdateSms(farmer, 'procured', reg.crop_type).catch(console.error);

  res.json({ message: 'Marked as procured', registration: updatedReg });
});

// ============================================================
// POST /api/officer/registrations/:id/payment
// Body: { status: 'processing' | 'completed', amount?, payment_ref? }
// ============================================================
router.post('/registrations/:id/payment', (req, res) => {
  const regId = parseInt(req.params.id);
  const { status: paymentStatus, amount, payment_ref } = req.body;

  if (!['processing', 'completed'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'status must be "processing" or "completed"' });
  }

  const reg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
  if (!reg) return res.status(404).json({ error: 'Registration not found' });
  if (reg.center_id !== req.officer.center_id) return res.status(403).json({ error: 'Not your center' });

  const regStatus = paymentStatus === 'completed' ? 'paid' : 'payment_processing';

  db.transaction(() => {
    db.prepare(`
      UPDATE payments SET status = ?, amount = COALESCE(?, amount), payment_ref = COALESCE(?, payment_ref),
             updated_at = datetime('now')
      WHERE registration_id = ?
    `).run(paymentStatus, amount || null, payment_ref || null, regId);
    db.prepare(`UPDATE crop_registrations SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(regStatus, regId);
  })();

  const farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(reg.farmer_id);
  const updatedReg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
  const payment = db.prepare(`SELECT * FROM payments WHERE registration_id = ?`).get(regId);

  const message = paymentStatus === 'completed'
    ? `Payment of ₹${payment.amount?.toFixed(2) || '—'} for your ${reg.crop_type} has been completed.`
    : `Payment for your ${reg.crop_type} is being processed.`;

  db.prepare(`INSERT INTO notification_log (farmer_id, registration_id, message) VALUES (?, ?, ?)`).run(farmer.id, regId, message);
  pushToFarmer(farmer.id, { registration: updatedReg, payment });
  pushToCenter(req.officer.center_id, { type: 'payment_updated', registration_id: regId });

  sendStatusUpdateSms(farmer, regStatus, reg.crop_type).catch(console.error);

  res.json({ message: 'Payment updated', registration: updatedReg, payment });
});

// ============================================================
// GET /api/officer/slots?center_id=&date=
// ============================================================
router.get('/slots', (req, res) => {
  const centerId = req.query.center_id || req.officer.center_id;
  const date = req.query.date;

  let query = `SELECT * FROM slots WHERE center_id = ?`;
  const params = [centerId];
  if (date) { query += ' AND date = ?'; params.push(date); }
  query += ' ORDER BY date, start_time';

  res.json(db.prepare(query).all(...params));
});

// ============================================================
// POST /api/officer/slots — create a slot
// ============================================================
router.post('/slots', (req, res) => {
  const { center_id, date, start_time, end_time, max_farmers } = req.body;
  const cId = center_id || req.officer.center_id;

  if (!date || !start_time || !end_time) {
    return res.status(400).json({ error: 'date, start_time, end_time required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO slots (center_id, date, start_time, end_time, max_farmers)
      VALUES (?, ?, ?, ?, ?)
    `).run(cId, date, start_time, end_time, max_farmers || 25);

    res.status(201).json(db.prepare(`SELECT * FROM slots WHERE id = ?`).get(result.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A slot already exists for this center/date/start_time' });
    }
    throw err;
  }
});

// ============================================================
// PUT /api/officer/slots/:id — edit a slot
// ============================================================
router.put('/slots/:id', (req, res) => {
  const slotId = parseInt(req.params.id);
  const { max_farmers, start_time, end_time } = req.body;

  const slot = db.prepare(`SELECT * FROM slots WHERE id = ?`).get(slotId);
  if (!slot) return res.status(404).json({ error: 'Slot not found' });
  if (slot.center_id !== req.officer.center_id) return res.status(403).json({ error: 'Not your center' });

  db.prepare(`
    UPDATE slots
    SET max_farmers = COALESCE(?, max_farmers),
        start_time = COALESCE(?, start_time),
        end_time = COALESCE(?, end_time)
    WHERE id = ?
  `).run(max_farmers || null, start_time || null, end_time || null, slotId);

  res.json(db.prepare(`SELECT * FROM slots WHERE id = ?`).get(slotId));
});

// ============================================================
// GET /api/officer/me — officer profile
// ============================================================
router.get('/me', (req, res) => {
  const officer = db.prepare(`
    SELECT o.id, o.name, o.username, o.center_id,
           c.name AS center_name, c.location AS center_location
    FROM officers o JOIN centers c ON c.id = o.center_id
    WHERE o.id = ?
  `).get(req.officer.id);
  res.json(officer);
});

// ============================================================
// POST /api/officer/assisted-register
// Officer registers a crop on a farmer's behalf (in-person)
// Body: { mobile_number, name, village, center_id, crop_type, expected_quantity, language_preference }
// ============================================================
router.post('/assisted-register', (req, res) => {
  const { mobile_number, name, village, center_id, crop_type, expected_quantity, language_preference } = req.body;

  if (!mobile_number || !center_id || !crop_type || !expected_quantity) {
    return res.status(400).json({ error: 'mobile_number, center_id, crop_type, and expected_quantity are required' });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Find or create the farmer by mobile_number
  let farmer = db.prepare(`SELECT * FROM farmers WHERE mobile_number = ?`).get(mobile_number);
  if (!farmer) {
    const farmerName = name || `Farmer ${mobile_number.slice(-4)}`;
    const result = db.prepare(`
      INSERT INTO farmers (mobile_number, name, village, language_preference)
      VALUES (?, ?, ?, ?)
    `).run(mobile_number, farmerName, village || null, language_preference || 'en');
    farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(result.lastInsertRowid);
  } else {
    // Update profile fields if provided
    const updates = [];
    const params = [];
    if (name)                { updates.push('name = ?');                params.push(name); }
    if (village)             { updates.push('village = ?');             params.push(village); }
    if (language_preference) { updates.push('language_preference = ?'); params.push(language_preference); }
    if (updates.length) {
      params.push(farmer.id);
      db.prepare(`UPDATE farmers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      farmer = db.prepare(`SELECT * FROM farmers WHERE id = ?`).get(farmer.id);
    }
  }

  // Block if farmer already has an active (non-terminal) registration
  const existing = db.prepare(`
    SELECT id FROM crop_registrations
    WHERE farmer_id = ? AND status NOT IN ('paid', 'cancelled', 'rejected')
    ORDER BY created_at DESC LIMIT 1
  `).get(farmer.id);

  if (existing) {
    return res.status(409).json({
      error: 'This farmer already has an active registration. Complete or pay the existing one first.',
      existing_registration_id: existing.id,
    });
  }

  // Create the registration, tagged as 'assisted'
  const regResult = db.prepare(`
    INSERT INTO crop_registrations (farmer_id, center_id, crop_type, expected_quantity, status, registered_via)
    VALUES (?, ?, ?, ?, 'registered', 'assisted')
  `).run(farmer.id, center_id, crop_type, expected_quantity);
  const regId = regResult.lastInsertRowid;

  // Auto-assign slot (same logic as self-registration)
  let slotResult;
  try {
    slotResult = assignSlotInDb(db, center_id, regId, expected_quantity, today);
  } catch (err) {
    console.warn('Slot assignment failed (assisted):', err.message);
    const reg = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);
    return res.status(202).json({
      message: 'Registered (assisted) but no slot available yet',
      registration: reg, slot: null, token: null,
    });
  }

  const center = db.prepare(`SELECT * FROM centers WHERE id = ?`).get(center_id);
  const registration = db.prepare(`SELECT * FROM crop_registrations WHERE id = ?`).get(regId);

  // SMS + in-app notification (same as self-register)
  const { sendSlotAssignmentSms } = require('../services/sms');
  sendSlotAssignmentSms(farmer, slotResult.slot, slotResult.token.token_number, center)
    .catch(e => console.error('SMS error (assisted):', e));

  db.prepare(`
    INSERT INTO notification_log (farmer_id, registration_id, message, channel)
    VALUES (?, ?, ?, 'in-app')
  `).run(
    farmer.id, regId,
    `[Assisted] Token ${slotResult.token.token_number} assigned. Visit ${center.name} on ` +
    `${slotResult.slot.date} between ${slotResult.slot.start_time}–${slotResult.slot.end_time}.`
  );

  pushToFarmer(farmer.id, { registration, slot: slotResult.slot, token: slotResult.token });

  res.status(201).json({
    message: 'Registered (assisted) and slot assigned',
    farmer,
    registration,
    slot: slotResult.slot,
    token: slotResult.token,
    payment: slotResult.payment,
  });
});

// ============================================================
// GET /api/officer/assisted-stats
// Returns registration count breakdown by channel (for impact slide)
// ============================================================
router.get('/assisted-stats', (req, res) => {
  const centerId = req.query.center_id || req.officer.center_id;
  const rows = db.prepare(`
    SELECT registered_via, COUNT(*) AS count
    FROM crop_registrations
    WHERE center_id = ?
    GROUP BY registered_via
  `).all(centerId);

  const stats = { self: 0, assisted: 0, ivr: 0, total: 0 };
  rows.forEach(r => {
    stats[r.registered_via] = r.count;
    stats.total += r.count;
  });
  res.json(stats);
});

module.exports = router;
