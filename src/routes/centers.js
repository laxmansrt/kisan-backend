'use strict';
const express = require('express');
const Center = require('../models/Center');
const Slot = require('../models/Slot');

const router = express.Router();

// GET /api/centers — public, no auth required
router.get('/', async (req, res, next) => {
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

module.exports = router;
