/**
 * SMS / OTP Service — Twilio Verify
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID        — Twilio Account SID (starts with AC)
 *   TWILIO_AUTH_TOKEN         — Twilio Auth Token
 *   TWILIO_VERIFY_SERVICE_SID — Twilio Verify Service SID (starts with VA)
 */

const twilio = require('twilio');

const SMS_ENABLED = !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_VERIFY_SERVICE_SID
);

let client = null;
if (SMS_ENABLED) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/** Normalise to E.164 Indian mobile number */
function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  let ten;
  if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1);
  else if (digits.length === 10) ten = digits;
  else ten = digits.slice(-10);
  if (!ten || ten.length !== 10) return null;
  return `+91${ten}`;
}

/**
 * Send a delivery OTP via Twilio Verify.
 * Twilio generates the OTP and sends the SMS — we never see the code.
 *
 * @param {string} phone  — raw phone number (any format)
 * @returns {Promise<{ sent: boolean, dev?: boolean, error?: string }>}
 */
async function sendDeliveryOtp(phone) {
  const to = toE164(phone);
  if (!to) {
    console.warn(`[sms] invalid phone: ${phone}`);
    return { sent: false, error: 'invalid_phone' };
  }

  if (!SMS_ENABLED) {
    console.log(`\n📱 [SMS DEV] Would send Twilio Verify OTP to: ${to}\n`);
    return { sent: false, dev: true };
  }

  try {
    await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to, channel: 'sms' });
    console.log(`[sms] Twilio Verify OTP sent to ${to}`);
    return { sent: true };
  } catch (err) {
    console.error(`[sms] Twilio Verify error:`, err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Check a delivery OTP via Twilio Verify.
 *
 * @param {string} phone — raw phone number (must match the one used in sendDeliveryOtp)
 * @param {string} code  — the 6-digit code entered by the delivery agent
 * @returns {Promise<{ approved: boolean, error?: string }>}
 */
async function checkDeliveryOtp(phone, code) {
  const to = toE164(phone);
  if (!to) return { approved: false, error: 'invalid_phone' };

  if (!SMS_ENABLED) {
    // Dev fallback: accept "000000" as a valid test OTP
    const approved = String(code) === '000000';
    console.log(`[sms] DEV verify: code=${code} → ${approved ? 'approved' : 'rejected'}`);
    return { approved };
  }

  try {
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to, code });
    return { approved: check.status === 'approved' };
  } catch (err) {
    console.error(`[sms] Twilio VerificationCheck error:`, err.message);
    return { approved: false, error: err.message };
  }
}

module.exports = { sendDeliveryOtp, checkDeliveryOtp, SMS_ENABLED, toE164 };
