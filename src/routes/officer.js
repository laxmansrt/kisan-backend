'use strict';
const express = require('express');
const { authOfficer } = require('../middleware/auth');
const { sendStatusUpdateSms, sendSlotAssignmentSms } = require('../services/sms');
const { pushToFarmer, pushToCenter } = require('../services/push');
const { assignSlotInDb } = require('../scheduler/slotAssigner');

const Officer = require('../models/Officer');
const Center = require('../models/Center');
const Farmer = require('../models/Farmer');
const Slot = require('../models/Slot');
const CropRegistration = require('../models/CropRegistration');
const Token = require('../models/Token');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');

const router = express.Router();

// All officer routes require officer JWT
router.use(authOfficer);

// ============================================================
// GET /api/officer/dashboard?center_id=&date=
// ============================================================
router.get('/dashboard', async (req, res, next) => {
  try {
    const centerId = req.query.center_id || req.officer.center_id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // Find all slots for this center and date
    const centerSlots = await Slot.find({ center_id: centerId, date }).sort({ start_time: 1 }).lean();
    const slotIds = centerSlots.map(s => s._id);

    // Find tokens for these slots
    const tokens = await Token.find({ slot_id: { $in: slotIds } }).lean();
    const regIds = tokens.map(t => t.registration_id);

    // Find crop registrations for these tokens
    const registrations = await CropRegistration.find({ _id: { $in: regIds } }).lean();
    const regMap = new Map(registrations.map(r => [r._id.toString(), r]));
    const tokenMapByReg = new Map(tokens.map(t => [t.registration_id.toString(), t]));

    // Build KPI summary
    const summary = {
      total: registrations.length,
      paid: 0,
      payment_processing: 0,
      procured: 0,
      at_center: 0,
      scheduled: 0,
      approved: 0,
      registered: 0,
      total_procured_quintals: 0,
    };

    for (const r of registrations) {
      if (summary[r.status] !== undefined) {
        summary[r.status] += 1;
      }
      const tok = tokenMapByReg.get(r._id.toString());
      if (tok && tok.actual_quantity) {
        summary.total_procured_quintals += tok.actual_quantity;
      }
    }

    // Per-slot breakdown
    const slots = centerSlots.map(s => {
      const slotTokens = tokens.filter(t => t.slot_id.toString() === s._id.toString());
      const slotRegs = slotTokens.map(t => regMap.get(t.registration_id.toString())).filter(Boolean);

      const completed = slotRegs.filter(r => ['procured', 'payment_processing', 'paid'].includes(r.status)).length;
      const pending = slotRegs.filter(r => ['registered', 'approved', 'scheduled'].includes(r.status)).length;
      const at_center = slotRegs.filter(r => r.status === 'at_center').length;

      return {
        ...s,
        id: s._id.toString(),
        total_registrations: slotRegs.length,
        completed,
        pending,
        at_center,
      };
    });

    res.json({ date, center_id: centerId, summary, slots });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/officer/registrations?center_id=&date=&status=&page=&limit=
// ============================================================
router.get('/registrations', async (req, res, next) => {
  try {
    const centerId = req.query.center_id || req.officer.center_id;
    const date = req.query.date;
    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const filter = { center_id: centerId };
    if (status) filter.status = status;

    // If date is provided, find slots for that date first
    if (date) {
      const slots = await Slot.find({ center_id: centerId, date }).select('_id').lean();
      const slotIds = slots.map(s => s._id);
      const tokens = await Token.find({ slot_id: { $in: slotIds } }).select('registration_id').lean();
      filter._id = { $in: tokens.map(t => t.registration_id) };
    }

    const total = await CropRegistration.countDocuments(filter);
    const registrations = await CropRegistration.find(filter)
      .populate('farmer_id')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const regIds = registrations.map(r => r._id);
    const tokens = await Token.find({ registration_id: { $in: regIds } }).populate('slot_id').lean();
    const payments = await Payment.find({ registration_id: { $in: regIds } }).lean();

    const tokenMap = new Map(tokens.map(t => [t.registration_id.toString(), t]));
    const paymentMap = new Map(payments.map(p => [p.registration_id.toString(), p]));

    const rows = registrations.map(cr => {
      const farmer = cr.farmer_id || {};
      const token = tokenMap.get(cr._id.toString());
      const slot = token?.slot_id;
      const payment = paymentMap.get(cr._id.toString());

      return {
        ...cr,
        id: cr._id.toString(),
        farmer_name: farmer.name || '—',
        mobile_number: farmer.mobile_number || '—',
        village: farmer.village || '—',
        token_number: token?.token_number || null,
        actual_quantity: token?.actual_quantity || null,
        token_id: token?._id?.toString() || null,
        slot_date: slot?.date || null,
        start_time: slot?.start_time || null,
        end_time: slot?.end_time || null,
        amount: payment?.amount || null,
        payment_status: payment?.status || 'pending',
      };
    });

    res.json({ registrations: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/officer/registrations/:id/approve
// ============================================================
router.post('/registrations/:id/approve', async (req, res, next) => {
  try {
    const regId = req.params.id;
    const reg = await CropRegistration.findById(regId);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (String(reg.center_id) !== String(req.officer.center_id)) {
      return res.status(403).json({ error: 'Not your center' });
    }

    reg.status = 'approved';
    await reg.save();

    const farmer = await Farmer.findById(reg.farmer_id);
    const token = await Token.findOne({ registration_id: regId }).populate('slot_id');
    const updatedReg = reg.toJSON();

    let slotDate = '';
    let slotTime = '';
    if (token?.slot_id) {
      slotDate = token.slot_id.date;
      slotTime = `${token.slot_id.start_time}–${token.slot_id.end_time}`;
    }

    const message = `Your registration has been approved.${token ? ` Token: ${token.token_number}, Date: ${slotDate}, ${slotTime}` : ''}`;
    await Notification.create({ farmer_id: farmer._id, registration_id: regId, message, channel: 'in-app' });

    pushToFarmer(farmer._id, { registration: updatedReg, token: token ? token.toJSON() : null });
    pushToCenter(req.officer.center_id, { type: 'registration_approved', registration_id: regId });

    sendStatusUpdateSms(farmer, 'approved', reg.crop_type).catch(console.error);

    res.json({ message: 'Approved', registration: updatedReg });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/officer/registrations/:id/mark-at-center
// ============================================================
router.post('/registrations/:id/mark-at-center', async (req, res, next) => {
  try {
    const regId = req.params.id;
    const reg = await CropRegistration.findById(regId);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    reg.status = 'at_center';
    await reg.save();

    const farmer = await Farmer.findById(reg.farmer_id);
    const updatedReg = reg.toJSON();

    await Notification.create({
      farmer_id: farmer._id,
      registration_id: regId,
      message: 'You have been marked as present at the center. Please proceed to the procurement counter.',
      channel: 'in-app',
    });

    pushToFarmer(farmer._id, { registration: updatedReg });
    pushToCenter(req.officer.center_id, { type: 'farmer_at_center', registration_id: regId });

    res.json({ message: 'Marked at center', registration: updatedReg });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/officer/registrations/:id/procure
// Body: { actual_quantity }
// ============================================================
router.post('/registrations/:id/procure', async (req, res, next) => {
  try {
    const regId = req.params.id;
    const { actual_quantity } = req.body;

    if (!actual_quantity || actual_quantity <= 0) {
      return res.status(400).json({ error: 'actual_quantity must be a positive number' });
    }

    const reg = await CropRegistration.findById(regId);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (String(reg.center_id) !== String(req.officer.center_id)) {
      return res.status(403).json({ error: 'Not your center' });
    }

    await Token.findOneAndUpdate({ registration_id: regId }, { actual_quantity: Number(actual_quantity) });
    reg.status = 'procured';
    await reg.save();

    const farmer = await Farmer.findById(reg.farmer_id);
    const updatedReg = reg.toJSON();

    await Notification.create({
      farmer_id: farmer._id,
      registration_id: regId,
      message: `Your ${reg.crop_type} (${actual_quantity} quintals) has been procured. Payment will be processed soon.`,
      channel: 'in-app',
    });

    pushToFarmer(farmer._id, { registration: updatedReg });
    pushToCenter(req.officer.center_id, { type: 'procured', registration_id: regId });

    sendStatusUpdateSms(farmer, 'procured', reg.crop_type).catch(console.error);

    res.json({ message: 'Marked as procured', registration: updatedReg });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/officer/registrations/:id/payment
// Body: { status: 'processing' | 'completed', amount?, payment_ref? }
// ============================================================
router.post('/registrations/:id/payment', async (req, res, next) => {
  try {
    const regId = req.params.id;
    const { status: paymentStatus, amount, payment_ref } = req.body;

    if (!['processing', 'completed'].includes(paymentStatus)) {
      return res.status(400).json({ error: 'status must be "processing" or "completed"' });
    }

    const reg = await CropRegistration.findById(regId);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (String(reg.center_id) !== String(req.officer.center_id)) {
      return res.status(403).json({ error: 'Not your center' });
    }

    const regStatus = paymentStatus === 'completed' ? 'paid' : 'payment_processing';

    const paymentUpdate = { status: paymentStatus };
    if (amount !== undefined && amount !== null) paymentUpdate.amount = Number(amount);
    if (payment_ref) paymentUpdate.payment_ref = payment_ref;

    const payment = await Payment.findOneAndUpdate(
      { registration_id: regId },
      paymentUpdate,
      { new: true, upsert: true }
    );

    reg.status = regStatus;
    await reg.save();

    const farmer = await Farmer.findById(reg.farmer_id);
    const updatedReg = reg.toJSON();

    const message = paymentStatus === 'completed'
      ? `Payment of ₹${payment.amount?.toFixed(2) || '—'} for your ${reg.crop_type} has been completed.`
      : `Payment for your ${reg.crop_type} is being processed.`;

    await Notification.create({ farmer_id: farmer._id, registration_id: regId, message, channel: 'in-app' });
    pushToFarmer(farmer._id, { registration: updatedReg, payment: payment.toJSON() });
    pushToCenter(req.officer.center_id, { type: 'payment_updated', registration_id: regId });

    sendStatusUpdateSms(farmer, regStatus, reg.crop_type).catch(console.error);

    res.json({ message: 'Payment updated', registration: updatedReg, payment: payment.toJSON() });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/officer/slots?center_id=&date=
// ============================================================
router.get('/slots', async (req, res, next) => {
  try {
    const centerId = req.query.center_id || req.officer.center_id;
    const date = req.query.date;

    const filter = { center_id: centerId };
    if (date) filter.date = date;

    const slots = await Slot.find(filter).sort({ date: 1, start_time: 1 }).lean();
    res.json(slots.map(s => ({ ...s, id: s._id.toString() })));
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/officer/slots — create a slot
// ============================================================
router.post('/slots', async (req, res, next) => {
  try {
    const { center_id, date, start_time, end_time, max_farmers } = req.body;
    const cId = center_id || req.officer.center_id;

    if (!date || !start_time || !end_time) {
      return res.status(400).json({ error: 'date, start_time, end_time required' });
    }

    try {
      const slot = await Slot.create({
        center_id: cId,
        date,
        start_time,
        end_time,
        max_farmers: max_farmers || 25,
      });

      res.status(201).json(slot.toJSON());
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'A slot already exists for this center/date/start_time' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PUT /api/officer/slots/:id — edit a slot
// ============================================================
router.put('/slots/:id', async (req, res, next) => {
  try {
    const slotId = req.params.id;
    const { max_farmers, start_time, end_time } = req.body;

    const slot = await Slot.findById(slotId);
    if (!slot) return res.status(404).json({ error: 'Slot not found' });
    if (String(slot.center_id) !== String(req.officer.center_id)) {
      return res.status(403).json({ error: 'Not your center' });
    }

    if (max_farmers !== undefined) slot.max_farmers = max_farmers;
    if (start_time !== undefined) slot.start_time = start_time;
    if (end_time !== undefined) slot.end_time = end_time;

    await slot.save();
    res.json(slot.toJSON());
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/officer/me — officer profile
// ============================================================
router.get('/me', async (req, res, next) => {
  try {
    const officer = await Officer.findById(req.officer.id).populate('center_id');
    if (!officer) return res.status(404).json({ error: 'Officer not found' });

    const obj = officer.toJSON();
    if (officer.center_id) {
      obj.center_name = officer.center_id.name;
      obj.center_location = officer.center_id.location;
    }
    delete obj.password_hash;
    res.json(obj);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/officer/assisted-register
// Officer registers a crop on a farmer's behalf (in-person)
// Body: { mobile_number, name, village, center_id, crop_type, expected_quantity, language_preference }
// ============================================================
router.post('/assisted-register', async (req, res, next) => {
  try {
    let { mobile_number, name, village, center_id, crop_type, expected_quantity, language_preference } = req.body;

    if (!mobile_number || !center_id || !crop_type || !expected_quantity) {
      return res.status(400).json({ error: 'mobile_number, center_id, crop_type, and expected_quantity are required' });
    }

    const mongoose = require('mongoose');
    let centerDoc = null;
    if (mongoose.isValidObjectId(center_id)) {
      centerDoc = await Center.findById(center_id);
    }
    if (!centerDoc) {
      const allCenters = await Center.find().sort({ name: 1 });
      const num = parseInt(center_id, 10);
      if (!isNaN(num) && num > 0 && num <= allCenters.length) {
        centerDoc = allCenters[num - 1];
      } else {
        centerDoc = allCenters[0];
      }
    }
    if (!centerDoc) {
      return res.status(404).json({ error: 'Procurement center not found' });
    }
    center_id = centerDoc._id.toString();

    const today = new Date().toISOString().slice(0, 10);

    // Find or create farmer
    let farmer = await Farmer.findOne({ mobile_number });
    if (!farmer) {
      farmer = await Farmer.create({
        mobile_number,
        name: name || `Farmer ${mobile_number.slice(-4)}`,
        village: village || null,
        language_preference: language_preference || 'en',
      });
    } else {
      const updates = {};
      if (name) updates.name = name;
      if (village) updates.village = village;
      if (language_preference) updates.language_preference = language_preference;
      if (Object.keys(updates).length) {
        await Farmer.findByIdAndUpdate(farmer._id, updates);
        farmer = await Farmer.findById(farmer._id);
      }
    }

    // Block if farmer already has an active registration
    const existing = await CropRegistration.findOne({
      farmer_id: farmer._id,
      status: { $nin: ['paid', 'cancelled', 'rejected'] },
    }).sort({ created_at: -1 });

    if (existing) {
      return res.status(409).json({
        error: 'This farmer already has an active registration. Complete or pay the existing one first.',
        existing_registration_id: existing.id || existing._id.toString(),
      });
    }

    // Create registration
    const registration = await CropRegistration.create({
      farmer_id: farmer._id,
      center_id,
      crop_type,
      expected_quantity: Number(expected_quantity),
      status: 'registered',
      registered_via: 'assisted',
    });

    const regId = registration._id;

    // Auto-assign slot
    let slotResult;
    try {
      slotResult = await assignSlotInDb(center_id, regId, Number(expected_quantity), today);
    } catch (err) {
      console.warn('Slot assignment failed (assisted):', err.message);
      const reg = await CropRegistration.findById(regId);
      return res.status(202).json({
        message: 'Registered (assisted) but no slot available yet',
        registration: reg.toJSON(),
        slot: null,
        token: null,
      });
    }

    const center = await Center.findById(center_id);

    // SMS + in-app notification
    sendSlotAssignmentSms(farmer, slotResult.slot, slotResult.token.token_number, center)
      .catch(e => console.error('SMS error (assisted):', e));

    await Notification.create({
      farmer_id: farmer._id,
      registration_id: regId,
      message: `[Assisted] Token ${slotResult.token.token_number} assigned. Visit ${center.name} on ${slotResult.slot.date} between ${slotResult.slot.start_time}–${slotResult.slot.end_time}.`,
      channel: 'in-app',
    });

    pushToFarmer(farmer._id, { registration: registration.toJSON(), slot: slotResult.slot, token: slotResult.token });

    res.status(201).json({
      message: 'Registered (assisted) and slot assigned',
      farmer: farmer.toJSON(),
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
// GET /api/officer/assisted-stats
// Returns registration count breakdown by channel (for impact slide)
// ============================================================
router.get('/assisted-stats', async (req, res, next) => {
  try {
    const centerId = req.query.center_id || req.officer.center_id;
    const counts = await CropRegistration.aggregate([
      { $match: { center_id: new (require('mongoose').Types.ObjectId)(centerId) } },
      { $group: { _id: '$registered_via', count: { $sum: 1 } } },
    ]);

    const stats = { self: 0, assisted: 0, ivr: 0, total: 0 };
    counts.forEach(r => {
      const channel = r._id || 'self';
      if (stats[channel] !== undefined) stats[channel] = r.count;
      stats.total += r.count;
    });

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
