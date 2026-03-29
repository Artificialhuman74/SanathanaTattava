/**
 * Email Service — OTP delivery
 *
 * Dev mode  (no SMTP_USER env var):
 *   OTP is printed to the server console and returned in the API response body
 *   (dev_otp field) so you can test without any email setup.
 *
 * Production mode (SMTP_USER configured in .env):
 *   OTP is sent as a branded HTML email via Nodemailer.
 *   Works with Gmail (use App Password), Resend, SendGrid SMTP relay, etc.
 *
 * To switch to SMS later: replace the body of sendOtpEmail with a
 *   Twilio/MSG91 call and update the function signature.
 */

const nodemailer = require('nodemailer');

const DEV_MODE = !process.env.SMTP_USER;

function getTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send OTP via email.
 * @param {string} toEmail  - recipient email address
 * @param {string} phone    - phone number (for display in email)
 * @param {string} otp      - 6-digit OTP string
 * @returns {{ dev: boolean }} dev=true when in dev mode (no email sent)
 */
async function sendOtpEmail(toEmail, phone, otp) {
  if (DEV_MODE) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔑  OTP for ${phone} (${toEmail}): ${otp}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return { dev: true };
  }

  const from = process.env.SMTP_FROM || `TradeHub <${process.env.SMTP_USER}>`;
  const transporter = getTransporter();

  await transporter.sendMail({
    from,
    to:      toEmail,
    subject: `${otp} is your TradeHub login code`,
    text:    `Your TradeHub verification code is ${otp}. It expires in 10 minutes. Do not share it with anyone.`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">TradeHub</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">Your verification code</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              Hi there 👋 — here is your one-time login code for TradeHub:
            </p>
            <!-- OTP Box -->
            <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
              <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#4f46e5;font-family:monospace;">${otp}</span>
            </div>
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;text-align:center;">
              ⏱ This code expires in <strong>10 minutes</strong>.
            </p>
            <p style="margin:0;color:#64748b;font-size:13px;text-align:center;">
              🔒 Do not share this code with anyone.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
              If you didn't request this code, you can safely ignore this email.
              <br>This code was requested for phone number: ${phone}
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });

  return { dev: false };
}

module.exports = { sendOtpEmail, DEV_MODE };
