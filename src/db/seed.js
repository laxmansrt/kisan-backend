'use strict';
/**
 * Database Seed Script
 * ============================================================
 * Run: node src/db/seed.js
 *
 * Creates:
 *   - 2 Karnataka APMC centers with GPS coordinates
 *   - 2 officers (one per center)
 *   - Pre-built time slots (4/day × 14 days) for each center
 *   - 80 farmer registrations with realistic status spread
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const { assignSlotInDb } = require('../scheduler/slotAssigner');

// ============================================================
// Seed data definitions
// ============================================================

const CENTERS = [
  {
    name: 'Bellary APMC Procurement Center',
    location: 'Bellary, Karnataka',
    latitude: 15.1394,
    longitude: 76.9214,
    daily_capacity_quintals: 600,
    daily_farmer_capacity: 100,
    address: 'APMC Yard, Near Railway Station, Bellary, Karnataka 583101',
    contact_number: '08392-255100',
  },
  {
    name: 'Raichur APMC Procurement Center',
    location: 'Raichur, Karnataka',
    latitude: 16.2120,
    longitude: 77.3439,
    daily_capacity_quintals: 500,
    daily_farmer_capacity: 80,
    address: 'APMC Yard, Hyderabad Road, Raichur, Karnataka 584101',
    contact_number: '08532-220045',
  },
];

const OFFICERS = [
  { name: 'Rajesh Kumar', username: 'officer_bellary', password: 'bellary@2026', center_index: 0 },
  { name: 'Priya Reddy', username: 'officer_raichur', password: 'raichur@2026', center_index: 1 },
];

const CROP_TYPES = ['Paddy', 'Maize', 'Cotton', 'Sunflower', 'Jowar', 'Groundnut'];

const FARMER_NAMES = [
  'Ramaiah Gowda', 'Basavaiah Nayak', 'Venkatesh Reddy', 'Hanumanthappa K',
  'Shivappa Lingaiah', 'Mallikarjun Patil', 'Nagaraj Shettar', 'Prabhakar Rao',
  'Somashekhar Hegde', 'Veeranna Lamani', 'Raju Gowda', 'Siddappa Badiger',
  'Eranna Talwar', 'Basappa Goudra', 'Manjunath Kulkarni', 'Thimmappa Hiremath',
  'Channappa Meti', 'Fakeerappa Biradar', 'Gurusiddappa Joshi', 'Halappa Desai',
  'Iranna Waghamore', 'Jagadish Totad', 'Krishnappa Vaddara', 'Lakshmana Rathod',
  'Murugappa Bannur', 'Narayana Kori', 'Obaiah Talawar', 'Parameshwara Doddamane',
  'Rangappa Mulimani', 'Sannaiah Kinnal', 'Amarappa Hadapad', 'Bhimappa Halli',
  'Channabasappa Kuri', 'Devaraja Koppal', 'Eshwara Sindagi', 'Fakkirappa Bagewadi',
  'Gangadhar Hosamane', 'Hemappa Jakkanur', 'Ishappa Devadurga', 'Jatteppa Lingdalli',
  'Kalappa Maski', 'Lingappa Yadgir', 'Malleshappa Shapur', 'Ningappa Ramdurga',
  'Obavva Rani', 'Padmavathi Bai', 'Renuka Devi', 'Shakunthala Pai',
  'Tarabai Nayak', 'Usha Badami', 'Vimala Desai', 'Yamuna Lamani',
  'Ankaiah Mudhol', 'Bheemareddy Kambali', 'Chikkanna Hosur', 'Devappa Ilkal',
  'Erashappa Jamkhandi', 'Fakirappa Kerur', 'Ganeshappa Lokapur', 'Haleshappa Mudhol',
  'Iranna Navalgund', 'Jambappa Nargund', 'Kenchappa Savanur', 'Lokappa Shiggaon',
  'Maheshappa Tadas', 'Nagappa Uchageri', 'Obaiah Vakkund', 'Panchappa Wadi',
  'Rachappa Yalagi', 'Sandesh Rathod', 'Tippanna Badiger', 'Ukkappa Daroji',
  'Venkappa Hospet', 'Wazeer Ahmed', 'Yadavappa Kudligi', 'Zulfekar Ali',
  'Anjaneya Reddy', 'Babu Rao', 'Chandra Shekhar', 'Deva Reddy',
];

const VILLAGES = [
  'Hosapete', 'Kampli', 'Kudligi', 'Hadagali', 'Harapanahalli',
  'Sindhanur', 'Manvi', 'Devadurga', 'Lingasugur', 'Mudgal',
  'Maski', 'Raichur North', 'Sirawar', 'Kallur', 'Deodurga',
];

// Status distribution for demo data (out of 80 farmers)
// 16 paid, 10 payment_processing, 14 procured, 16 at_center, 12 scheduled, 8 approved, 4 registered
const STATUS_SPREAD = [
  ...Array(4).fill('registered'),
  ...Array(8).fill('approved'),
  ...Array(12).fill('scheduled'),
  ...Array(16).fill('at_center'),
  ...Array(14).fill('procured'),
  ...Array(10).fill('payment_processing'),
  ...Array(16).fill('paid'),
];

const SLOT_TIMES = [
  ['06:00', '08:00'],
  ['08:00', '10:00'],
  ['10:00', '12:00'],
  ['12:00', '14:00'],
];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function indianMobile() {
  const prefixes = ['98', '97', '96', '95', '94', '93', '92', '91', '90', '87', '86', '85', '84', '83', '82', '81', '80', '79', '78', '77', '76', '75', '74', '70'];
  return `+91${randomElement(prefixes)}${String(randomBetween(10000000, 99999999))}`;
}

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// Main seed function
// ============================================================
function seed() {
  console.log('🌱 Starting seed...');

  // Clear existing data
  db.exec(`
    DELETE FROM notification_log;
    DELETE FROM payments;
    DELETE FROM tokens;
    DELETE FROM crop_registrations;
    DELETE FROM slots;
    DELETE FROM otps;
    DELETE FROM officers;
    DELETE FROM farmers;
    DELETE FROM centers;
  `);

  // Reset auto-increment sequences
  db.exec(`
    DELETE FROM sqlite_sequence WHERE name IN (
      'centers','officers','farmers','slots','crop_registrations','tokens','payments','notification_log'
    );
  `);

  // ── 1. Centers ───────────────────────────────────────────
  const insertCenter = db.prepare(`
    INSERT INTO centers (name, location, latitude, longitude, daily_capacity_quintals, daily_farmer_capacity, address, contact_number)
    VALUES (@name, @location, @latitude, @longitude, @daily_capacity_quintals, @daily_farmer_capacity, @address, @contact_number)
  `);

  const centerIds = [];
  for (const c of CENTERS) {
    const result = insertCenter.run(c);
    centerIds.push(result.lastInsertRowid);
    console.log(`  ✓ Center: ${c.name} (id=${result.lastInsertRowid})`);
  }

  // ── 2. Officers ──────────────────────────────────────────
  const insertOfficer = db.prepare(`
    INSERT INTO officers (name, username, password_hash, center_id)
    VALUES (@name, @username, @password_hash, @center_id)
  `);

  for (const o of OFFICERS) {
    const hash = bcrypt.hashSync(o.password, 10);
    insertOfficer.run({
      name: o.name,
      username: o.username,
      password_hash: hash,
      center_id: centerIds[o.center_index],
    });
    console.log(`  ✓ Officer: ${o.username} / ${o.password}`);
  }

  // ── 3. Slots (4/day × 21 days for each center) ──────────
  const insertSlot = db.prepare(`
    INSERT OR IGNORE INTO slots (center_id, date, start_time, end_time, max_farmers)
    VALUES (@center_id, @date, @start_time, @end_time, @max_farmers)
  `);

  const today = dateOffset(0);
  for (const centerId of centerIds) {
    const center = CENTERS[centerIds.indexOf(centerId)];
    const maxPerSlot = Math.floor(center.daily_farmer_capacity / SLOT_TIMES.length);
    for (let d = -7; d <= 14; d++) {
      const date = dateOffset(d);
      for (const [start, end] of SLOT_TIMES) {
        insertSlot.run({ center_id: centerId, date, start_time: start, end_time: end, max_farmers: maxPerSlot });
      }
    }
  }
  console.log(`  ✓ Slots created (4/day × 21 days × 2 centers)`);

  // ── 4. Farmers & Registrations ───────────────────────────
  const insertFarmer = db.prepare(`
    INSERT INTO farmers (name, mobile_number, village, location, language_preference)
    VALUES (@name, @mobile_number, @village, @location, @language_preference)
  `);
  const insertReg = db.prepare(`
    INSERT INTO crop_registrations (farmer_id, center_id, crop_type, expected_quantity, status, created_at, updated_at)
    VALUES (@farmer_id, @center_id, @crop_type, @expected_quantity, @status, @created_at, @updated_at)
  `);
  const insertToken = db.prepare(`
    INSERT OR IGNORE INTO tokens (registration_id, slot_id, token_number, actual_quantity)
    VALUES (@registration_id, @slot_id, @token_number, @actual_quantity)
  `);
  const updateSlot = db.prepare(`
    UPDATE slots SET farmers_assigned_count = farmers_assigned_count + 1,
                     allocated_quintals = allocated_quintals + ?
    WHERE id = ?
  `);
  const insertPayment = db.prepare(`
    INSERT OR IGNORE INTO payments (registration_id, amount, status)
    VALUES (@registration_id, @amount, @status)
  `);
  const insertNotif = db.prepare(`
    INSERT INTO notification_log (farmer_id, registration_id, message, channel)
    VALUES (@farmer_id, @registration_id, @message, @channel)
  `);

  // Shuffle status spread so we get a natural distribution
  const shuffledStatuses = [...STATUS_SPREAD].sort(() => Math.random() - 0.5);

  // Track token numbers per slot
  const slotTokenCounters = {};

  for (let i = 0; i < 80; i++) {
    const name = FARMER_NAMES[i] || `Farmer ${i + 1}`;
    const mobile = indianMobile();
    const village = randomElement(VILLAGES);
    const centerId = centerIds[i % centerIds.length];
    const crop = randomElement(CROP_TYPES);
    const quantity = randomBetween(10, 60);
    const finalStatus = shuffledStatuses[i];
    const lang = Math.random() > 0.3 ? 'hi' : 'en';

    // Registration date spread over past 7 days
    const daysAgo = randomBetween(0, 7);
    const createdDate = dateOffset(-daysAgo);

    const farmerResult = insertFarmer.run({
      name, mobile_number: mobile, village, location: `${village}, Karnataka`, language_preference: lang,
    });
    const farmerId = farmerResult.lastInsertRowid;

    const regResult = insertReg.run({
      farmer_id: farmerId, center_id: centerId, crop_type: crop,
      expected_quantity: quantity, status: 'registered',
      created_at: `${createdDate} 09:00:00`, updated_at: `${createdDate} 09:00:00`,
    });
    const regId = regResult.lastInsertRowid;

    // For statuses beyond 'registered', assign a slot
    if (finalStatus !== 'registered') {
      // Pick a slot: past slots for completed, future/today for in-progress
      let slotDate;
      if (['paid', 'payment_processing', 'procured'].includes(finalStatus)) {
        slotDate = dateOffset(-randomBetween(1, 5)); // past
      } else if (finalStatus === 'at_center') {
        slotDate = today; // today
      } else {
        slotDate = dateOffset(randomBetween(1, 7)); // future
      }

      const availableSlots = db
        .prepare(`SELECT * FROM slots WHERE center_id = ? AND date = ? ORDER BY start_time`)
        .all(centerId, slotDate);

      if (availableSlots.length > 0) {
        const slot = randomElement(availableSlots);
        if (!slotTokenCounters[slot.id]) slotTokenCounters[slot.id] = 0;
        slotTokenCounters[slot.id]++;
        const tokenNum = slotTokenCounters[slot.id];

        insertToken.run({
          registration_id: regId, slot_id: slot.id, token_number: tokenNum,
          actual_quantity: ['procured', 'payment_processing', 'paid'].includes(finalStatus)
            ? quantity - randomBetween(0, 5) : null,
        });
        updateSlot.run(quantity, slot.id);
      }

      // Payment record
      let payStatus = 'pending';
      let amount = null;
      if (finalStatus === 'paid') { payStatus = 'completed'; amount = quantity * randomBetween(180, 250); }
      else if (finalStatus === 'payment_processing') { payStatus = 'processing'; amount = quantity * randomBetween(180, 250); }

      insertPayment.run({ registration_id: regId, amount, status: payStatus });

      // Update registration to final status
      db.prepare(`UPDATE crop_registrations SET status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(finalStatus, regId);

      // Add notification entry
      insertNotif.run({
        farmer_id: farmerId, registration_id: regId,
        message: `Your registration for ${crop} has been updated to: ${finalStatus.replace(/_/g, ' ')}`,
        channel: 'in-app',
      });
    }
  }

  console.log('  ✓ 80 farmer registrations seeded with realistic status spread');
  console.log('\n🎉 Seed complete!');
  console.log('\nDemo officer credentials:');
  console.log('  Bellary:  officer_bellary / bellary@2026');
  console.log('  Raichur:  officer_raichur / raichur@2026');
}

seed();
