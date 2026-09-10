'use strict';
/**
 * IVR Service — Twilio Voice TwiML builder
 * Mirrors sms.js: when Twilio credentials are not set, logs the TwiML
 * to console so the flow is demo-able via curl without a real Twilio account.
 */

const VOICE_LANG = 'hi-IN';
const VOICE_FALLBACK = 'en-IN';

function sayTwiML(text, lang = VOICE_LANG) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="${lang}" voice="Polly.Aditi">${escapeXml(text)}</Say>\n</Response>`;
}

function greetingTwiML(gatherUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Gather numDigits="1" action="${escapeXml(gatherUrl)}" method="POST" timeout="10">\n    <Say language="${VOICE_LANG}" voice="Polly.Aditi">नमस्ते। गवProcure में आपका स्वागत है। टोकन की जानकारी के लिए एक दबाएं। फसल पंजीकरण के लिए दो दबाएं। दोबारा सुनने के लिए शून्य दबाएं।</Say>\n  </Gather>\n  <Redirect method="POST">${escapeXml(gatherUrl)}</Redirect>\n</Response>`;
}

function gatherNumberTwiML(nextUrl, prompt) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Gather numDigits="10" action="${escapeXml(nextUrl)}" method="POST" timeout="15" finishOnKey="#">\n    <Say language="${VOICE_LANG}" voice="Polly.Aditi">${escapeXml(prompt)}</Say>\n  </Gather>\n  <Say language="${VOICE_LANG}" voice="Polly.Aditi">समय सीमा समाप्त। कृपया पुनः कॉल करें।</Say>\n</Response>`;
}

function statusTwiML(farmer, registration, token, center) {
  let script;
  if (!registration) {
    script = `${farmer.name} जी, आपका कोई सक्रिय पंजीकरण नहीं है। पंजीकरण के लिए केंद्र पर जाएं।`;
  } else if (token) {
    script = `${farmer.name} जी, आपका टोकन नंबर ${token.token_number} है। ` +
      `${center ? center.name + ' पर' : ''} ${token.date} को ${token.start_time} से ${token.end_time} के बीच आएं। ` +
      `वर्तमान स्थिति: ${statusLabel(registration.status)}।`;
  } else {
    script = `${farmer.name} जी, आपका ${registration.crop_type} पंजीकरण प्राप्त हुआ। ` +
      `स्लॉट निर्धारित होते ही SMS आएगा। वर्तमान स्थिति: ${statusLabel(registration.status)}।`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="${VOICE_LANG}" voice="Polly.Aditi">${escapeXml(script)}</Say>\n  <Say language="${VOICE_FALLBACK}">Thank you for calling GovProcure. Goodbye.</Say>\n  <Hangup/>\n</Response>`;
}

function assistedRegistrationTwiML() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say language="${VOICE_LANG}" voice="Polly.Aditi">फसल पंजीकरण के लिए कृपया अपने नजदीकी खरीद केंद्र पर जाएं या केंद्र के अधिकारी से संपर्क करें। वे आपकी ओर से पंजीकरण करेंगे। धन्यवाद।</Say>\n  <Hangup/>\n</Response>`;
}

function statusLabel(status) {
  const map = {
    registered: 'पंजीकृत', approved: 'स्वीकृत', scheduled: 'समय निर्धारित',
    at_center: 'केंद्र पर', procured: 'खरीदा गया',
    payment_processing: 'भुगतान प्रक्रिया में', paid: 'भुगतान पूर्ण',
  };
  return map[status] || status;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function logStubCall(direction, twiml) {
  console.log('\n📞 [IVR STUB] ─────────────────────────────────');
  console.log(`   Direction: ${direction}`);
  console.log(`   TwiML:\n${twiml}`);
  console.log('────────────────────────────────────────────────\n');
}

module.exports = { greetingTwiML, gatherNumberTwiML, statusTwiML, assistedRegistrationTwiML, sayTwiML, logStubCall };
