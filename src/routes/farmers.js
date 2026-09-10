'use strict';
const express = require('express');
const { authFarmer } = require('../middleware/auth');
const { assignSlotInDb } = require('../scheduler/slotAssigner');
const { sendSlotAssignmentSms } = require('../services/sms');
const { pushToFarmer } = require('../services/push');

const Center = require('../models/Center');
const Farmer = require('../models/Farmer');
const Slot = require('../models/Slot');
const CropRegistration = require('../models/CropRegistration');
const Token = require('../models/Token');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');

const router = express.Router();

// ============================================================
// GET /api/farmers/centers — list all centers with current load
// (public — no auth required so farmer can browse before registering)
// ============================================================
router.get('/centers', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const centers = await Center.find().sort({ name: 1 }).lean();

    const result = await Promise.all(
      centers.map(async (c) => {
        const slots = await Slot.find({ center_id: c._id, date: today }).lean();
        const today_farmers_assigned = slots.reduce((acc, s) => acc + (s.farmers_assigned_count || 0), 0);
        const today_capacity = c.daily_farmer_capacity || 100;
        const load_percent = today_capacity > 0
          ? Math.round((today_farmers_assigned / today_capacity) * 100)
          : 0;

        return {
          ...c,
          id: c._id.toString(),
          today_farmers_assigned,
          today_capacity,
          load_percent,
        };
      })
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/farmers/register
// Body: { name, village, language_preference, center_id, crop_type, expected_quantity }
// Auth: Bearer JWT (farmer)
// ============================================================
router.post('/register', authFarmer, async (req, res, next) => {
  try {
    const { name, village, language_preference, center_id, crop_type, expected_quantity } = req.body;

    if (!center_id || !crop_type || !expected_quantity) {
      return res.status(400).json({ error: 'center_id, crop_type, and expected_quantity are required' });
    }

    const farmerId = req.farmer.id;
    const today = new Date().toISOString().slice(0, 10);

    // Update farmer profile if name/village/lang provided
    const farmerUpdates = {};
    if (name) farmerUpdates.name = name;
    if (village) farmerUpdates.village = village;
    if (language_preference) farmerUpdates.language_preference = language_preference;

    if (Object.keys(farmerUpdates).length > 0) {
      await Farmer.findByIdAndUpdate(farmerId, farmerUpdates);
    }

    // Check for an existing active registration (prevent duplicates)
    const existing = await CropRegistration.findOne({
      farmer_id: farmerId,
      status: { $nin: ['paid', 'cancelled', 'rejected'] },
    }).sort({ created_at: -1 });

    if (existing) {
      return res.status(409).json({
        error: 'You already have an active registration. Complete or pay the existing one first.',
        existing_registration_id: existing.id || existing._id.toString(),
      });
    }

    // Create the registration
    const registrationDoc = await CropRegistration.create({
      farmer_id: farmerId,
      center_id,
      crop_type,
      expected_quantity: Number(expected_quantity),
      status: 'registered',
      registered_via: 'self',
    });

    const regId = registrationDoc._id;

    // Auto-assign slot
    let slotResult;
    try {
      slotResult = await assignSlotInDb(center_id, regId, Number(expected_quantity), today);
    } catch (err) {
      console.warn('Slot assignment failed:', err.message);
      const reg = await CropRegistration.findById(regId);
      return res.status(202).json({
        message: 'Registered but no slot available yet — check back later',
        registration: reg.toJSON(),
        slot: null,
        token: null,
      });
    }

    // Fetch full state for response
    const farmer = await Farmer.findById(farmerId);
    const center = await Center.findById(center_id);
    const registration = await CropRegistration.findById(regId);

    // Fire SMS (non-blocking)
    sendSlotAssignmentSms(farmer, slotResult.slot, slotResult.token.token_number, center)
      .catch(e => console.error('SMS error:', e));

    // Log in-app notification
    await Notification.create({
      farmer_id: farmerId,
      registration_id: regId,
      message: `Token ${slotResult.token.token_number} assigned. Visit ${center.name} on ${slotResult.slot.date} between ${slotResult.slot.start_time}–${slotResult.slot.end_time}.`,
      channel: 'in-app',
    });

    // Push real-time update
    pushToFarmer(farmerId, { registration: registration.toJSON(), slot: slotResult.slot, token: slotResult.token });

    res.status(201).json({
      message: 'Registered and slot assigned',
      registration: registration.toJSON(),
      slot: slotResult.slot,
      token: slotResult.token,
      payment: slotResult.payment,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/farmers/:id/status
// ============================================================
router.get('/:id/status', authFarmer, async (req, res, next) => {
  try {
    const farmerId = req.params.id;
    if (String(farmerId) !== String(req.farmer.id)) {
      return res.status(403).json({ error: 'Cannot access another farmer\'s status' });
    }

    const farmer = await Farmer.findById(farmerId);
    if (!farmer) return res.status(404).json({ error: 'Farmer not found' });

    // Get most recent active registration
    const registrationDoc = await CropRegistration.findOne({ farmer_id: farmerId })
      .populate('center_id')
      .sort({ created_at: -1 });

    if (!registrationDoc) {
      return res.json({
        farmer: farmer.toJSON(),
        registration: null,
        token: null,
        slot: null,
        payment: null,
        notifications: [],
      });
    }

    const reg = registrationDoc.toJSON();
    if (registrationDoc.center_id) {
      reg.center_name = registrationDoc.center_id.name;
      reg.center_location = registrationDoc.center_id.location;
      reg.center_address = registrationDoc.center_id.address;
      reg.center_contact = registrationDoc.center_id.contact_number;
    }

    const tokenDoc = await Token.findOne({ registration_id: registrationDoc._id }).populate('slot_id');
    let token = null;
    let slot = null;

    if (tokenDoc) {
      token = tokenDoc.toJSON();
      if (tokenDoc.slot_id) {
        token.date = tokenDoc.slot_id.date;
        token.start_time = tokenDoc.slot_id.start_time;
        token.end_time = tokenDoc.slot_id.end_time;
        slot = tokenDoc.slot_id.toJSON();
      }
    }

    const paymentDoc = await Payment.findOne({ registration_id: registrationDoc._id });
    const payment = paymentDoc ? paymentDoc.toJSON() : null;

    const notifications = await Notification.find({ farmer_id: farmerId })
      .sort({ created_at: -1 })
      .limit(20)
      .lean();

    res.json({
      farmer: farmer.toJSON(),
      registration: reg,
      token,
      slot: slot || token,
      payment,
      notifications: notifications.map(n => ({ ...n, id: n._id.toString() })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/farmers/:id/notifications
// ============================================================
router.get('/:id/notifications', authFarmer, async (req, res, next) => {
  try {
    const farmerId = req.params.id;
    if (String(farmerId) !== String(req.farmer.id)) return res.status(403).json({ error: 'Forbidden' });

    const notifications = await Notification.find({ farmer_id: farmerId })
      .sort({ created_at: -1 })
      .limit(50)
      .lean();

    await Notification.updateMany({ farmer_id: farmerId, read: false }, { read: true });

    res.json(notifications.map(n => ({ ...n, id: n._id.toString() })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
