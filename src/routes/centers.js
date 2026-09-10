'use strict';
const express = require('express');
const db = require('../db/db');

const router = express.Router();

// GET /api/centers — public, no auth required
router.get('/', (req, res) => {
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

module.exports = router;
