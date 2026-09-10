'use strict';
/**
 * Slot Assignment Algorithm
 * ============================================================
 * Pure functions — no database calls, no side effects.
 * State is passed in as arguments; results are returned.
 * This makes the logic independently testable without a DB.
 *
 * Core invariants:
 *  1. No slot exceeds max_farmers
 *  2. No day exceeds daily_capacity_quintals
 *  3. Token numbers are sequential per slot (not per day)
 *  4. If no slot is available within SEARCH_WINDOW_DAYS, returns null
 */

const SEARCH_WINDOW_DAYS = 14; // how many days ahead to search

/**
 * Find the best available slot for a new registration.
 *
 * @param {Object[]} slots - All slots for this center (any date range)
 *   Each slot: { id, center_id, date, start_time, end_time,
 *                max_farmers, farmers_assigned_count, allocated_quintals }
 * @param {string} fromDate - ISO date string YYYY-MM-DD (today or requested date)
 * @param {number} requestedQuantity - Quintals the farmer wants to bring
 * @param {number} dailyCapacityQuintals - Center's total daily quintal cap
 * @returns {{ slot: Object, tokenNumber: number } | null}
 */
function findBestSlot(slots, fromDate, requestedQuantity, dailyCapacityQuintals) {
  // Build a lookup: date → slots[] sorted by start_time ASC
  const slotsByDate = {};
  for (const slot of slots) {
    if (!slotsByDate[slot.date]) slotsByDate[slot.date] = [];
    slotsByDate[slot.date].push(slot);
  }
  for (const date of Object.keys(slotsByDate)) {
    slotsByDate[date].sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  // Generate date range to search
  const searchDates = generateDateRange(fromDate, SEARCH_WINDOW_DAYS);

  for (const date of searchDates) {
    const daySlots = slotsByDate[date] || [];

    // Compute total quintals already allocated on this day
    const dayAllocatedQuintals = daySlots.reduce(
      (sum, s) => sum + (s.allocated_quintals || 0), 0
    );

    // Check if this day has remaining quintal capacity
    const dayRemainingQuintals = dailyCapacityQuintals - dayAllocatedQuintals;
    if (dayRemainingQuintals < requestedQuantity) continue;

    // Find the first slot on this day with farmer capacity
    for (const slot of daySlots) {
      if (slot.farmers_assigned_count < slot.max_farmers) {
        // This slot works — compute next token number for this slot
        const tokenNumber = slot.farmers_assigned_count + 1;
        return { slot, tokenNumber };
      }
    }
  }

  return null; // No slot found within search window
}

/**
 * Apply an assignment to a slot (returns updated slot state — does not mutate).
 * Call this to compute the new state before writing to DB.
 *
 * @param {Object} slot
 * @param {number} quantity
 * @param {number} tokenNumber
 * @returns {Object} Updated slot fields to write back
 */
function applyAssignment(slot, quantity, tokenNumber) {
  return {
    ...slot,
    farmers_assigned_count: slot.farmers_assigned_count + 1,
    allocated_quintals: (slot.allocated_quintals || 0) + quantity,
  };
}

/**
 * Generate an array of YYYY-MM-DD strings starting from fromDate.
 * @param {string} fromDate - YYYY-MM-DD
 * @param {number} days
 * @returns {string[]}
 */
function generateDateRange(fromDate, days) {
  const dates = [];
  const start = new Date(fromDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * High-level slot assigner for Mongoose / MongoDB.
 *
 * @param {any} _dbOrCenterId - Can accept centerId directly or (db, centerId...) for backward compat
 * @param {any} centerId
 * @param {any} registrationId
 * @param {number} quantity
 * @param {string} fromDate - YYYY-MM-DD
 * @returns {Promise<{ slot: Object, token: Object, payment: Object }>}
 */
async function assignSlotInDb(_dbOrCenterId, centerId, registrationId, quantity, fromDate) {
  // Support both (centerId, registrationId, quantity, fromDate) and (db, centerId, registrationId, quantity, fromDate)
  let actualCenterId = centerId;
  let actualRegId = registrationId;
  let actualQty = quantity;
  let actualFromDate = fromDate;

  if (typeof _dbOrCenterId === 'string' || (typeof _dbOrCenterId === 'object' && _dbOrCenterId?._bsontype)) {
    actualCenterId = _dbOrCenterId;
    actualRegId = centerId;
    actualQty = registrationId;
    actualFromDate = quantity;
  }

  const Center = require('../models/Center');
  const Slot = require('../models/Slot');
  const Token = require('../models/Token');
  const Payment = require('../models/Payment');
  const CropRegistration = require('../models/CropRegistration');

  const center = await Center.findById(actualCenterId);
  if (!center) throw new Error(`Center ${actualCenterId} not found`);

  const slots = await Slot.find({
    center_id: actualCenterId,
    date: { $gte: actualFromDate },
  }).sort({ date: 1, start_time: 1 }).lean();

  const result = findBestSlot(slots, actualFromDate, actualQty, center.daily_capacity_quintals);
  if (!result) {
    throw new Error(
      `No available slot found within ${SEARCH_WINDOW_DAYS} days for center ${actualCenterId}`
    );
  }

  const { slot, tokenNumber } = result;

  // Update slot counts atomically
  const updatedSlot = await Slot.findByIdAndUpdate(
    slot._id,
    {
      $inc: {
        farmers_assigned_count: 1,
        allocated_quintals: actualQty,
      },
    },
    { new: true }
  );

  // Create token record
  const token = await Token.create({
    registration_id: actualRegId,
    slot_id: slot._id,
    token_number: tokenNumber,
  });

  // Update registration status to 'scheduled'
  await CropRegistration.findByIdAndUpdate(actualRegId, {
    status: 'scheduled',
  });

  // Create or find payment record
  let payment = await Payment.findOne({ registration_id: actualRegId });
  if (!payment) {
    payment = await Payment.create({
      registration_id: actualRegId,
      status: 'pending',
    });
  }

  return { slot: updatedSlot.toJSON(), token: token.toJSON(), payment: payment.toJSON() };
}

module.exports = { findBestSlot, applyAssignment, generateDateRange, assignSlotInDb };
