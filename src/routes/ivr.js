'use strict';
const express = require('express');
const db = require('../db/db');
const ivr = require('../services/ivr');

const router = express.Router();

// Base URL for Twilio callbacks — set BACKEND_URL in .env for production
function baseUrl(req) {
  return process.env.BACKEND_URL ||
    `${req.protocol}://${req.get('host')}`;
}

// ============================================================
// POST /api/ivr/voice  — Twilio webhook: incoming call entry point
// ============================================================
router.post('/voice', (req, res) => {
  const gatherUrl = `${baseUrl(req)}/api/ivr/gather`;
  const twiml = ivr.greetingTwiML(gatherUrl);
  ivr.logStubCall('INCOMING', twiml);
  res.type('text/xml').send(twiml);
});

// ============================================================
// POST /api/ivr/gather  — Handle digit keypress after greeting
// ============================================================
router.post('/gather', (req, res) => {
  const digit = req.body.Digits || '';
  const callerNumber = req.body.From || '';

  if (digit === '1') {
    // Status check — try to auto-detect by caller ID first
    const normalised = callerNumber.replace(/^\+91/, '').replace(/\D/g, '');
    const farmer = normalised
      ? db.prepare(`SELECT * FROM farmers WHERE mobile_number LIKE ?`).get(`%${normalised}`)
      : null;

    if (farmer) {
      // Farmer found by caller ID — read status directly
      const registration = db.prepare(`
        SELECT cr.*, c.name AS center_name FROM crop_registrations cr
        JOIN centers c ON c.id = cr.center_id
        WHERE cr.farmer_id = ? ORDER BY cr.created_at DESC LIMIT 1
      `).get(farmer.id);

      const token = registration
        ? db.prepare(`SELECT t.*, s.date, s.start_time, s.end_time FROM tokens t JOIN slots s ON s.id = t.slot_id WHERE t.registration_id = ?`).get(registration.id)
        : null;
      const center = registration
        ? db.prepare(`SELECT * FROM centers WHERE id = ?`).get(registration.center_id)
        : null;

      const twiml = ivr.statusTwiML(farmer, registration, token, center);
      ivr.logStubCall('STATUS_BY_CALLER_ID', twiml);
      return res.type('text/xml').send(twiml);
    }

    // Caller ID not found — ask for mobile number
    const statusLookupUrl = `${baseUrl(req)}/api/ivr/status`;
    const twiml = ivr.gatherNumberTwiML(
      statusLookupUrl,
      'अपना 10 अंकों का मोबाइल नंबर दर्ज करें और # दबाएं।'
    );
    ivr.logStubCall('GATHER_NUMBER', twiml);
    return res.type('text/xml').send(twiml);
  }

  if (digit === '2') {
    const twiml = ivr.assistedRegistrationTwiML();
    ivr.logStubCall('ASSISTED_REG_PROMPT', twiml);
    return res.type('text/xml').send(twiml);
  }

  // digit === '0' or anything else — repeat greeting
  const gatherUrl = `${baseUrl(req)}/api/ivr/gather`;
  const twiml = ivr.greetingTwiML(gatherUrl);
  ivr.logStubCall('REPEAT_GREETING', twiml);
  return res.type('text/xml').send(twiml);
});

// ============================================================
// POST /api/ivr/status  — Farmer entered mobile number, read back status
// ============================================================
router.post('/status', (req, res) => {
  const digits = (req.body.Digits || '').replace(/\D/g, '');

  const farmer = db.prepare(`SELECT * FROM farmers WHERE mobile_number LIKE ?`).get(`%${digits}`);

  if (!farmer) {
    const twiml = ivr.sayTwiML(
      `${digits} नंबर से कोई पंजीकरण नहीं मिला। कृपया पुनः कॉल करें।`
    );
    ivr.logStubCall('STATUS_NOT_FOUND', twiml);
    return res.type('text/xml').send(twiml);
  }

  const registration = db.prepare(`
    SELECT cr.* FROM crop_registrations cr
    WHERE cr.farmer_id = ? ORDER BY cr.created_at DESC LIMIT 1
  `).get(farmer.id);

  const token = registration
    ? db.prepare(`SELECT t.*, s.date, s.start_time, s.end_time FROM tokens t JOIN slots s ON s.id = t.slot_id WHERE t.registration_id = ?`).get(registration.id)
    : null;
  const center = registration
    ? db.prepare(`SELECT * FROM centers WHERE id = ?`).get(registration.center_id)
    : null;

  // Log IVR interaction in notification_log for audit
  if (farmer.id) {
    db.prepare(`
      INSERT INTO notification_log (farmer_id, registration_id, message, channel)
      VALUES (?, ?, 'Farmer checked status via IVR phone call', 'ivr')
    `).run(farmer.id, registration?.id || null);
  }

  const twiml = ivr.statusTwiML(farmer, registration, token, center);
  ivr.logStubCall('STATUS_READBACK', twiml);
  return res.type('text/xml').send(twiml);
});

module.exports = router;
