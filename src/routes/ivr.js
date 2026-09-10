'use strict';
const express = require('express');
const ivr = require('../services/ivr');
const Farmer = require('../models/Farmer');
const CropRegistration = require('../models/CropRegistration');
const Token = require('../models/Token');
const Center = require('../models/Center');
const Notification = require('../models/Notification');

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
router.post('/gather', async (req, res, next) => {
  try {
    const digit = req.body.Digits || '';
    const callerNumber = req.body.From || '';

    if (digit === '1') {
      // Status check — try to auto-detect by caller ID first
      const normalised = callerNumber.replace(/^\+91/, '').replace(/\D/g, '');
      const farmer = normalised
        ? await Farmer.findOne({ mobile_number: { $regex: `${normalised}$` } })
        : null;

      if (farmer) {
        // Farmer found by caller ID — read status directly
        const registration = await CropRegistration.findOne({ farmer_id: farmer._id })
          .populate('center_id')
          .sort({ created_at: -1 });

        let token = null;
        let center = null;

        if (registration) {
          center = registration.center_id;
          const tokenDoc = await Token.findOne({ registration_id: registration._id }).populate('slot_id');
          if (tokenDoc) {
            token = tokenDoc.toJSON();
            if (tokenDoc.slot_id) {
              token.date = tokenDoc.slot_id.date;
              token.start_time = tokenDoc.slot_id.start_time;
              token.end_time = tokenDoc.slot_id.end_time;
            }
          }
        }

        const twiml = ivr.statusTwiML(farmer.toJSON(), registration ? registration.toJSON() : null, token, center ? center.toJSON() : null);
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
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ivr/status  — Farmer entered mobile number, read back status
// ============================================================
router.post('/status', async (req, res, next) => {
  try {
    const digits = (req.body.Digits || '').replace(/\D/g, '');

    const farmer = await Farmer.findOne({ mobile_number: { $regex: `${digits}$` } });

    if (!farmer) {
      const twiml = ivr.sayTwiML(
        `${digits} नंबर से कोई पंजीकरण नहीं मिला। कृपया पुनः कॉल करें।`
      );
      ivr.logStubCall('STATUS_NOT_FOUND', twiml);
      return res.type('text/xml').send(twiml);
    }

    const registration = await CropRegistration.findOne({ farmer_id: farmer._id })
      .populate('center_id')
      .sort({ created_at: -1 });

    let token = null;
    let center = null;

    if (registration) {
      center = registration.center_id;
      const tokenDoc = await Token.findOne({ registration_id: registration._id }).populate('slot_id');
      if (tokenDoc) {
        token = tokenDoc.toJSON();
        if (tokenDoc.slot_id) {
          token.date = tokenDoc.slot_id.date;
          token.start_time = tokenDoc.slot_id.start_time;
          token.end_time = tokenDoc.slot_id.end_time;
        }
      }
    }

    // Log IVR interaction in notification_log for audit
    await Notification.create({
      farmer_id: farmer._id,
      registration_id: registration ? registration._id : null,
      message: 'Farmer checked status via IVR phone call',
      channel: 'ivr',
    });

    const twiml = ivr.statusTwiML(farmer.toJSON(), registration ? registration.toJSON() : null, token, center ? center.toJSON() : null);
    ivr.logStubCall('STATUS_READBACK', twiml);
    return res.type('text/xml').send(twiml);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
