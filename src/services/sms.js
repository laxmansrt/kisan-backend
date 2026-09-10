'use strict';
/**
 * SMS Service — Twilio wrapper
 * If Twilio credentials are not set, logs the SMS to console.
 * This keeps the demo working even without a Twilio account.
 */

let twilioClient = null;

function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

/**
 * Send an SMS message.
 * @param {string} to - E.164 format phone number (+91XXXXXXXXXX)
 * @param {string} body - Message text
 * @returns {Promise<{sent: boolean, sid?: string, error?: string}>}
 */
async function sendSms(to, body) {
  const client = getTwilioClient();
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!client || !from) {
    // Stub mode: log and return success so the rest of the flow continues
    console.log('\n📱 [SMS STUB] ─────────────────────────────────');
    console.log(`   To:   ${to}`);
    console.log(`   Body: ${body}`);
    console.log('────────────────────────────────────────────────\n');
    return { sent: true, stub: true };
  }

  try {
    const message = await client.messages.create({ to, from, body });
    console.log(`📱 SMS sent to ${to} — SID: ${message.sid}`);
    return { sent: true, sid: message.sid };
  } catch (err) {
    console.error(`📱 SMS failed to ${to}:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Send slot assignment SMS to farmer.
 */
async function sendSlotAssignmentSms(farmer, slot, tokenNumber, center) {
  const body =
    `Your token is ${tokenNumber}. Visit ${center.name} on ${slot.date} ` +
    `between ${slot.start_time}–${slot.end_time}. Bring this message. -GovProcure`;
  return sendSms(farmer.mobile_number, body);
}

/**
 * Send status update SMS.
 */
async function sendStatusUpdateSms(farmer, status, crop) {
  const statusLabels = {
    approved: 'approved and scheduled',
    procured: 'crop procured',
    payment_processing: 'payment being processed',
    paid: 'payment completed',
  };
  const label = statusLabels[status] || status;
  const body = `GovProcure Update: Your ${crop} registration has been ${label}. -GovProcure`;
  return sendSms(farmer.mobile_number, body);
}

module.exports = { sendSms, sendSlotAssignmentSms, sendStatusUpdateSms };
