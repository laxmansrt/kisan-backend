'use strict';
/**
 * Database Seed Script for MongoDB Atlas
 * ============================================================
 * Run: node src/db/seed.js
 *
 * Creates:
 *   - 2 Karnataka APMC centers with GPS coordinates
 *   - 2 officers (one per center)
 *   - Pre-built time slots (4/day × 21 days) for each center
 *   - 80 farmer registrations with realistic status spread
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectDB } = require('./db');

const Center = require('../models/Center');
const Officer = require('../models/Officer');
const Farmer = require('../models/Farmer');
const Slot = require('../models/Slot');
const CropRegistration = require('../models/CropRegistration');
const Token = require('../models/Token');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const Otp = require('../models/Otp');

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
async function seed() {
  await connectDB();
  console.log('🌱 Starting MongoDB seed...');

  // Clear existing collections
  await Promise.all([
    Notification.deleteMany({}),
    Payment.deleteMany({}),
    Token.deleteMany({}),
    CropRegistration.deleteMany({}),
    Slot.deleteMany({}),
    Otp.deleteMany({}),
    Officer.deleteMany({}),
    Farmer.deleteMany({}),
    Center.deleteMany({}),
  ]);
  console.log('  ✓ Cleared existing collections');

  // ── 1. Centers ───────────────────────────────────────────
  const createdCenters = await Center.insertMany(CENTERS);
  for (const c of createdCenters) {
    console.log(`  ✓ Center: ${c.name} (_id=${c._id})`);
  }

  // ── 2. Officers ──────────────────────────────────────────
  for (const o of OFFICERS) {
    const hash = bcrypt.hashSync(o.password, 10);
    await Officer.create({
      name: o.name,
      username: o.username,
      password_hash: hash,
      center_id: createdCenters[o.center_index]._id,
    });
    console.log(`  ✓ Officer: ${o.username} / ${o.password}`);
  }

  // ── 3. Slots (4/day × 21 days for each center) ──────────
  const slotsToCreate = [];
  for (const center of createdCenters) {
    const maxPerSlot = Math.floor(center.daily_farmer_capacity / SLOT_TIMES.length);
    for (let d = -7; d <= 14; d++) {
      const date = dateOffset(d);
      for (const [start, end] of SLOT_TIMES) {
        slotsToCreate.push({
          center_id: center._id,
          date,
          start_time: start,
          end_time: end,
          max_farmers: maxPerSlot,
          farmers_assigned_count: 0,
          allocated_quintals: 0,
        });
      }
    }
  }

  const createdSlots = await Slot.insertMany(slotsToCreate);
  console.log(`  ✓ Created ${createdSlots.length} slots across 2 centers`);

  // Map slots for fast lookup by center and date
  const slotMap = new Map();
  for (const s of createdSlots) {
    const key = `${s.center_id.toString()}_${s.date}`;
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key).push(s);
  }

  // ── 4. Farmers & Registrations ───────────────────────────
  const today = dateOffset(0);
  const shuffledStatuses = [...STATUS_SPREAD].sort(() => Math.random() - 0.5);
  const slotTokenCounters = {};
  const defaultPasswordHash = bcrypt.hashSync('farmer123', 10);
  const defaultPatternHash = bcrypt.hashSync('1-2-3-5', 10);

  for (let i = 0; i < 80; i++) {
    const name = i === 0 ? 'Ramesh Patel' : (FARMER_NAMES[i] || `Farmer ${i + 1}`);
    const mobile = i === 0 ? '9876543210' : indianMobile();
    const village = randomElement(VILLAGES);
    const center = createdCenters[i % createdCenters.length];
    const crop = randomElement(CROP_TYPES);
    const quantity = randomBetween(10, 60);
    const finalStatus = shuffledStatuses[i];
    const lang = Math.random() > 0.3 ? 'hi' : 'en';

    const daysAgo = randomBetween(0, 7);
    const createdDate = new Date(Date.now() - daysAgo * 86400000);

    const farmer = await Farmer.create({
      name,
      mobile_number: mobile,
      village,
      location: `${village}, Karnataka`,
      language_preference: lang,
      password_hash: defaultPasswordHash,
      pattern_hash: defaultPatternHash,
      created_at: createdDate,
    });

    const registration = await CropRegistration.create({
      farmer_id: farmer._id,
      center_id: center._id,
      crop_type: crop,
      expected_quantity: quantity,
      status: finalStatus === 'registered' ? 'registered' : finalStatus,
      registered_via: 'self',
      created_at: createdDate,
      updated_at: new Date(),
    });

    if (finalStatus !== 'registered') {
      let slotDate;
      if (['paid', 'payment_processing', 'procured'].includes(finalStatus)) {
        slotDate = dateOffset(-randomBetween(1, 5));
      } else if (finalStatus === 'at_center') {
        slotDate = today;
      } else {
        slotDate = dateOffset(randomBetween(1, 7));
      }

      const availableSlots = slotMap.get(`${center._id.toString()}_${slotDate}`) || [];
      if (availableSlots.length > 0) {
        const slot = randomElement(availableSlots);
        const slotIdStr = slot._id.toString();
        if (!slotTokenCounters[slotIdStr]) slotTokenCounters[slotIdStr] = 0;
        slotTokenCounters[slotIdStr]++;
        const tokenNum = slotTokenCounters[slotIdStr];

        await Token.create({
          registration_id: registration._id,
          slot_id: slot._id,
          token_number: tokenNum,
          actual_quantity: ['procured', 'payment_processing', 'paid'].includes(finalStatus)
            ? quantity - randomBetween(0, 5) : null,
        });

        await Slot.findByIdAndUpdate(slot._id, {
          $inc: { farmers_assigned_count: 1, allocated_quintals: quantity },
        });
      }

      let payStatus = 'pending';
      let amount = null;
      if (finalStatus === 'paid') {
        payStatus = 'completed';
        amount = quantity * randomBetween(180, 250);
      } else if (finalStatus === 'payment_processing') {
        payStatus = 'processing';
        amount = quantity * randomBetween(180, 250);
      }

      await Payment.create({
        registration_id: registration._id,
        amount,
        status: payStatus,
      });

      await Notification.create({
        farmer_id: farmer._id,
        registration_id: registration._id,
        message: `Your registration for ${crop} has been updated to: ${finalStatus.replace(/_/g, ' ')}`,
        channel: 'in-app',
      });
    }
  }

  console.log('  ✓ 80 farmer registrations seeded with realistic status spread');
  console.log('\n🎉 MongoDB Atlas Seed complete!');
  console.log('\nDemo officer credentials:');
  console.log('  Bellary:  officer_bellary / bellary@2026');
  console.log('  Raichur:  officer_raichur / raichur@2026');
}

module.exports = { seed };

if (require.main === module) {
  seed()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
