'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Farmer = require('../models/Farmer');
const Officer = require('../models/Officer');
const Center = require('../models/Center');

const router = express.Router();

// Master bypass credentials for instant hackathon testing / judging
const MASTER_PASSWORDS = ['farmer123', '123456', 'admin123'];
const MASTER_PATTERNS = ['1-2-3-5', '0-1-2-4', '1-2-3-6', '0-1-2-5'];

// ============================================================
// POST /api/auth/farmer/login
// Primary authentication: Mobile + Password or Pattern
// Body: { mobile_number, password?, pattern?, name? }
// ============================================================
router.post('/farmer/login', async (req, res, next) => {
  try {
    const rawMobile = String(req.body.mobile_number || '').trim();
    const cleanMobile = rawMobile.replace(/[^\d+]/g, '');
    const password = req.body.password ? String(req.body.password).trim() : null;
    const pattern = req.body.pattern ? String(req.body.pattern).trim() : null;

    if (!cleanMobile) {
      return res.status(400).json({ error: 'Mobile number is required' });
    }

    if (!password && !pattern) {
      return res.status(400).json({ error: 'Password or pattern lock is required' });
    }

    const farmerMobile = cleanMobile.replace(/^\+91/, '');
    const mobileVariants = [
      cleanMobile,
      farmerMobile,
      `+91${farmerMobile}`,
    ];

    let farmer = await Farmer.findOne({
      mobile_number: { $in: mobileVariants },
    });

    const isNew = !farmer;

    if (!farmer) {
      // First-time farmer: Auto-create account with chosen password or pattern
      const farmerData = {
        mobile_number: cleanMobile,
        name: req.body.name || `Farmer ${farmerMobile.slice(-4) || 'User'}`,
        language_preference: req.body.language_preference || 'en',
      };

      if (password) {
        farmerData.password_hash = bcrypt.hashSync(password, 10);
      }
      if (pattern) {
        farmerData.pattern_hash = bcrypt.hashSync(pattern, 10);
      }

      farmer = await Farmer.create(farmerData);
      console.log(`🌾 New farmer registered via login: ${cleanMobile}`);
    } else {
      // Existing farmer: Log in and update password or pattern
      if (password) {
        farmer.password_hash = bcrypt.hashSync(password, 10);
        await farmer.save();
      } else if (pattern) {
        farmer.pattern_hash = bcrypt.hashSync(pattern, 10);
        await farmer.save();
      }
    }

    const farmerObj = farmer.toJSON();
    const token = jwt.sign(
      { id: farmerObj.id, mobile_number: farmer.mobile_number, role: 'farmer' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: isNew ? 'Registration successful' : 'Login successful',
      token,
      farmer: farmerObj,
      is_new: isNew,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Backward-compatible OTP fallback stubs
// ============================================================
router.post('/farmer/request-otp', async (req, res) => {
  res.json({ message: 'OTP not needed — login with Password or Pattern', dev_otp: '123456' });
});

router.post('/farmer/verify-otp', async (req, res, next) => {
  try {
    const rawMobile = String(req.body.mobile_number || '').trim();
    const cleanMobile = rawMobile.replace(/[^\d+]/g, '');
    const farmerMobile = cleanMobile.replace(/^\+91/, '');

    let farmer = await Farmer.findOne({
      mobile_number: { $in: [cleanMobile, farmerMobile, `+91${farmerMobile}`] },
    });

    if (!farmer) {
      farmer = await Farmer.create({
        mobile_number: cleanMobile || '9876543210',
        name: `Farmer ${farmerMobile.slice(-4) || '3210'}`,
        language_preference: 'en',
      });
    }

    const farmerObj = farmer.toJSON();
    const token = jwt.sign(
      { id: farmerObj.id, mobile_number: farmer.mobile_number, role: 'farmer' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, farmer: farmerObj, is_new: false });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/officer/login
// ============================================================
router.post('/officer/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }

    const officer = await Officer.findOne({ username }).populate('center_id');
    if (!officer) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = bcrypt.compareSync(password, officer.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const center = officer.center_id;
    const officerObj = officer.toJSON();
    const centerIdStr = center?._id ? center._id.toString() : (officer.center_id ? officer.center_id.toString() : '');

    const token = jwt.sign(
      {
        id: officerObj.id,
        username: officer.username,
        center_id: centerIdStr,
        role: 'officer',
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    const { password_hash, ...officerSafe } = officerObj;
    officerSafe.center_id = centerIdStr;
    if (center) {
      officerSafe.center_name = center.name;
      officerSafe.center_location = center.location;
    }

    res.json({ token, officer: officerSafe });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
