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
  const lang = farmer?.language_preference || 'en';
  let body = '';
  if (lang === 'kn') {
    body = `ಕಿಸಾನ್‌ಸಾಥಿ: ನಿಮ್ಮ ಟೋಕನ್ ${tokenNumber}. ${slot.date} ರಂದು ${slot.start_time}–${slot.end_time} ಸಮಯದಲ್ಲಿ ${center.name} ಕೇಂದ್ರಕ್ಕೆ ಭೇಟಿ ನೀಡಿ. -KisanSaathi`;
  } else if (lang === 'ta') {
    body = `கிசான்சாதி: உங்கள் டோக்கன் ${tokenNumber}. ${slot.date} அன்று ${slot.start_time}–${slot.end_time} நேரத்தில் ${center.name} மையத்திற்கு வரவும். -KisanSaathi`;
  } else if (lang === 'te') {
    body = `కిసాన్‌సాథి: మీ టోకెన్ ${tokenNumber}. ${slot.date} నాడు ${slot.start_time}–${slot.end_time} సమయంలో ${center.name} కేంద్రానికి రండి. -KisanSaathi`;
  } else if (lang === 'hi') {
    body = `किसानसाथी: आपका टोकन ${tokenNumber} है। ${slot.date} को ${slot.start_time}–${slot.end_time} के बीच ${center.name} पर आएं। -KisanSaathi`;
  } else if (lang === 'mr') {
    body = `किसानसाथी: आपला टोकन ${tokenNumber} आहे. ${slot.date} रोजी ${slot.start_time}–${slot.end_time} दरम्यान ${center.name} केंद्रावर यावे. -KisanSaathi`;
  } else {
    body = `Your token is ${tokenNumber}. Visit ${center.name} on ${slot.date} between ${slot.start_time}–${slot.end_time}. Bring this message. -KisanSaathi`;
  }
  return sendSms(farmer.mobile_number, body);
}

/**
 * Send status update SMS.
 */
async function sendStatusUpdateSms(farmer, status, crop) {
  const lang = farmer?.language_preference || 'en';
  let body = '';
  if (lang === 'kn') {
    body = `ಕಿಸಾನ್‌ಸಾಥಿ: ನಿಮ್ಮ ${crop} ಬೆಳೆ ನೋಂದಣಿ ಸ್ಥಿತಿ ನವೀಕರಿಸಲಾಗಿದೆ: ${status}. -KisanSaathi`;
  } else if (lang === 'ta') {
    body = `கிசான்சாதி: உங்கள் ${crop} பயிர் பதிவு நிலை புதுப்பிக்கப்பட்டது: ${status}. -KisanSaathi`;
  } else if (lang === 'te') {
    body = `కిసాన్‌సాథి: మీ ${crop} పంట నమోదు స్థితి అప్‌డేట్ చేయబడింది: ${status}. -KisanSaathi`;
  } else if (lang === 'hi') {
    body = `किसानसाथी: आपकी ${crop} फसल पंजीकरण स्थिति अपडेट हुई: ${status}। -KisanSaathi`;
  } else if (lang === 'mr') {
    body = `किसानसाथी: आपल्या ${crop} पीक नोंदणीची स्थिती अपडेट झाली: ${status}. -KisanSaathi`;
  } else {
    body = `KisanSaathi Update: Your ${crop} registration status is now ${status}. -KisanSaathi`;
  }
  return sendSms(farmer.mobile_number, body);
}

module.exports = { sendSms, sendSlotAssignmentSms, sendStatusUpdateSms };
