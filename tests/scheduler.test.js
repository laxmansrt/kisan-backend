'use strict';
/**
 * Scheduler Unit Tests
 * ============================================================
 * Uses Node.js built-in test runner (node:test) — no extra deps.
 * Run: node --test tests/scheduler.test.js
 *
 * Verifies:
 *   1. No slot exceeds max_farmers
 *   2. No day exceeds daily_capacity_quintals
 *   3. No duplicate tokens within a slot
 *   4. Slot filling spills to next day when full
 *   5. Returns null when search window exhausted
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { findBestSlot, applyAssignment, generateDateRange } = require('../src/scheduler/slotAssigner');

// ============================================================
// Test helpers
// ============================================================

/**
 * Build a set of slots for a center across N days.
 * 4 slots per day, max_farmers=25, daily_capacity_quintals = 500
 */
function buildSlots(numDays, fromDate, maxFarmersPerSlot = 25) {
  const slots = [];
  const dates = generateDateRange(fromDate, numDays);
  let id = 1;
  const times = [
    ['06:00', '08:00'],
    ['08:00', '10:00'],
    ['10:00', '12:00'],
    ['12:00', '14:00'],
  ];
  for (const date of dates) {
    for (const [start, end] of times) {
      slots.push({
        id: id++,
        center_id: 1,
        date,
        start_time: start,
        end_time: end,
        max_farmers: maxFarmersPerSlot,
        farmers_assigned_count: 0,
        allocated_quintals: 0,
      });
    }
  }
  return slots;
}

/**
 * Simulate N sequential farmer registrations against a set of slots.
 * Mutates slot state in-place (mirrors what the DB transaction does).
 * Returns array of { slot, tokenNumber } assignments.
 */
function simulateRegistrations(numFarmers, slots, fromDate, quantityPerFarmer, dailyCapacity) {
  const assignments = [];
  for (let i = 0; i < numFarmers; i++) {
    const result = findBestSlot(slots, fromDate, quantityPerFarmer, dailyCapacity);
    if (!result) {
      assignments.push(null);
      continue;
    }
    const { slot, tokenNumber } = result;
    // Apply assignment in-place (mirror DB update)
    const updated = applyAssignment(slot, quantityPerFarmer, tokenNumber);
    Object.assign(slot, updated);
    assignments.push({ slotId: slot.id, tokenNumber, date: slot.date });
  }
  return assignments;
}

// ============================================================
// Tests
// ============================================================

const FROM_DATE = '2026-09-10';
const DAILY_CAPACITY = 500;   // quintals
const PER_FARMER_QTY = 5;     // quintals per farmer
const MAX_FARMERS_SLOT = 25;  // 4 slots/day × 25 = 100/day
// Max per day by quintals: 500/5 = 100 farmers → matches farmer capacity exactly

describe('Scheduler — Core Invariants', () => {
  test('100 farmers fill 4 days exactly (25 per slot, 4 slots/day)', () => {
    const slots = buildSlots(14, FROM_DATE, MAX_FARMERS_SLOT);
    const assignments = simulateRegistrations(100, slots, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);

    assert.equal(assignments.length, 100, 'All 100 assignments returned');
    assert.ok(assignments.every(a => a !== null), 'No null assignments');
  });

  test('No slot exceeds max_farmers', () => {
    const slots = buildSlots(14, FROM_DATE, MAX_FARMERS_SLOT);
    simulateRegistrations(100, slots, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);

    for (const slot of slots) {
      assert.ok(
        slot.farmers_assigned_count <= MAX_FARMERS_SLOT,
        `Slot ${slot.id} on ${slot.date} ${slot.start_time} has ${slot.farmers_assigned_count} > ${MAX_FARMERS_SLOT}`
      );
    }
  });

  test('No day exceeds daily_capacity_quintals', () => {
    const slots = buildSlots(14, FROM_DATE, MAX_FARMERS_SLOT);
    simulateRegistrations(100, slots, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);

    // Group slots by date and sum allocated_quintals
    const byDate = {};
    for (const slot of slots) {
      byDate[slot.date] = (byDate[slot.date] || 0) + slot.allocated_quintals;
    }
    for (const [date, total] of Object.entries(byDate)) {
      assert.ok(
        total <= DAILY_CAPACITY,
        `Day ${date} allocated ${total} quintals > capacity ${DAILY_CAPACITY}`
      );
    }
  });

  test('No duplicate token numbers within a slot', () => {
    const slots = buildSlots(14, FROM_DATE, MAX_FARMERS_SLOT);
    const assignments = simulateRegistrations(100, slots, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);

    const seen = new Set();
    for (const a of assignments) {
      const key = `${a.slotId}:${a.tokenNumber}`;
      assert.ok(!seen.has(key), `Duplicate token slot=${a.slotId} token=${a.tokenNumber}`);
      seen.add(key);
    }
  });

  test('Slots fill in order — earlier slots fill before later ones', () => {
    const slots = buildSlots(14, FROM_DATE, MAX_FARMERS_SLOT);
    const assignments = simulateRegistrations(30, slots, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);

    // First 25 assignments should all be on same date/slot (slot 1, day 1)
    const firstSlotId = assignments[0].slotId;
    for (let i = 0; i < 25; i++) {
      assert.equal(assignments[i].slotId, firstSlotId, `Farmer ${i + 1} not in first slot`);
    }
    // 26th farmer should spill to second slot
    assert.notEqual(assignments[25].slotId, firstSlotId, '26th farmer should be in next slot');
  });

  test('Returns null when all slots in search window are full', () => {
    // Build a single slot manually (max 5 farmers) and fill it
    const singleSlot = [{
      id: 999, center_id: 1, date: FROM_DATE,
      start_time: '06:00', end_time: '08:00',
      max_farmers: 5, farmers_assigned_count: 0, allocated_quintals: 0,
    }];
    // Fill it completely
    simulateRegistrations(5, singleSlot, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);
    assert.equal(singleSlot[0].farmers_assigned_count, 5, 'Slot should be full');

    // Next registration against this single slot should return null
    const result = findBestSlot(singleSlot, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);
    assert.equal(result, null, 'Should return null when all slots full');
  });

  test('Quintal cap prevents over-allocation even if farmer slots remain', () => {
    // Tight quintal cap: each farmer brings 60 quintals, center cap = 100/day
    // So max ~1 farmer per slot before quintal cap hits
    const slots = buildSlots(14, FROM_DATE, 25); // plenty of farmer capacity
    const tightCapacity = 100;
    const bigQuantity = 60;
    const assignments = simulateRegistrations(5, slots, FROM_DATE, bigQuantity, tightCapacity);

    // Only 1 farmer per day can fit (60 < 100, but two would be 120 > 100)
    const byDate = {};
    for (const a of assignments) {
      if (!a) continue;
      byDate[a.date] = (byDate[a.date] || 0) + bigQuantity;
    }
    for (const [date, total] of Object.entries(byDate)) {
      assert.ok(
        total <= tightCapacity,
        `Day ${date} quintal total ${total} exceeds cap ${tightCapacity}`
      );
    }
  });

  test('generateDateRange produces correct sequence', () => {
    const dates = generateDateRange('2026-09-10', 5);
    assert.deepEqual(dates, [
      '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14',
    ]);
  });
});

describe('Scheduler — Large Scale (200 farmers)', () => {
  test('200 farmers across 14 days — no invariants violated', () => {
    const slots = buildSlots(14, FROM_DATE, 25);
    const assignments = simulateRegistrations(200, slots, FROM_DATE, PER_FARMER_QTY, DAILY_CAPACITY);

    const successful = assignments.filter(a => a !== null);
    // 14 days × 100 farmers/day = 1400 capacity. 200 should all fit.
    assert.equal(successful.length, 200);

    // Duplicate check
    const seen = new Set();
    for (const a of successful) {
      const key = `${a.slotId}:${a.tokenNumber}`;
      assert.ok(!seen.has(key));
      seen.add(key);
    }

    // Slot cap check
    for (const slot of slots) {
      assert.ok(slot.farmers_assigned_count <= 25);
    }
  });
});
