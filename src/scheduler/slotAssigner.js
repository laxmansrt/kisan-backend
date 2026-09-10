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
 * High-level slot assigner that reads from and writes to DB.
 * Uses the pure functions above; handles the DB transaction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} centerId
 * @param {number} registrationId
 * @param {number} quantity
 * @param {string} fromDate - YYYY-MM-DD
 * @returns {{ slot: Object, tokenNumber: number, payment: Object }}
 */
function assignSlotInDb(db, centerId, registrationId, quantity, fromDate) {
  const center = db.prepare('SELECT * FROM centers WHERE id = ?').get(centerId);
  if (!center) throw new Error(`Center ${centerId} not found`);

  const slots = db
    .prepare(`SELECT * FROM slots WHERE center_id = ? AND date >= ? ORDER BY date, start_time`)
    .all(centerId, fromDate);

  const result = findBestSlot(slots, fromDate, quantity, center.daily_capacity_quintals);
  if (!result) {
    throw new Error(
      `No available slot found within ${SEARCH_WINDOW_DAYS} days for center ${centerId}`
    );
  }

  const { slot, tokenNumber } = result;

  // All writes in a single transaction to prevent race conditions
  const assign = db.transaction(() => {
    // Update slot counts
    db.prepare(`
      UPDATE slots
      SET farmers_assigned_count = farmers_assigned_count + 1,
          allocated_quintals = allocated_quintals + ?
      WHERE id = ?
    `).run(quantity, slot.id);

    // Create token record
    db.prepare(`
      INSERT INTO tokens (registration_id, slot_id, token_number)
      VALUES (?, ?, ?)
    `).run(registrationId, slot.id, tokenNumber);

    // Update registration status to 'scheduled'
    db.prepare(`
      UPDATE crop_registrations
      SET status = 'scheduled', updated_at = datetime('now')
      WHERE id = ?
    `).run(registrationId);

    // Create pending payment record
    db.prepare(`
      INSERT INTO payments (registration_id, status)
      VALUES (?, 'pending')
    `).run(registrationId);
  });

  assign();

  // Return the fresh slot state
  const updatedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot.id);
  const token = db.prepare('SELECT * FROM tokens WHERE registration_id = ?').get(registrationId);
  const payment = db.prepare('SELECT * FROM payments WHERE registration_id = ?').get(registrationId);

  return { slot: updatedSlot, token, payment };
}

module.exports = { findBestSlot, applyAssignment, generateDateRange, assignSlotInDb };
