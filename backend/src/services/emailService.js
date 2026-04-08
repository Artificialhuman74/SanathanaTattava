/**
 * Email Service — Gmail SMTP via Nodemailer
 *
 * Required env vars (set in Railway / .env):
 *   EMAIL_USER  — Gmail address (e.g. yourapp@gmail.com)
 *   EMAIL_PASS  — Gmail App Password (NOT your login password)
 *                 Generate at: myaccount.google.com → Security → 2-Step Verification → App passwords
 *
 * Dev mode (EMAIL_USER not set):
 *   Emails are NOT sent. Token/OTP is returned in the API response as `dev_token` / `dev_otp`.
 */

const nodemailer = require('nodemailer');

const DEV_MODE = !process.env.EMAIL_USER;

function getTransporter() {
  return nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false, // STARTTLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

const FROM = process.env.EMAIL_FROM || `Sanathana Tattva <${process.env.EMAIL_USER}>`;

/* ── Generic send helper ──────────────────────────────────────────────── */
async function sendMail({ to, subject, text, html }) {
  if (DEV_MODE) {
    console.log(`\n📧 [EMAIL DEV] To: ${to} | Subject: ${subject}\n`);
    return { dev: true };
  }
  const transporter = getTransporter();
  await transporter.sendMail({ from: FROM, to, subject, text, html });
  return { dev: false };
}

/* ── Email verification ───────────────────────────────────────────────── */
async function sendVerificationEmail(toEmail, verifyUrl) {
  const subject = 'Verify your Sanathana Tattva account';
  const text    = `Please verify your email by visiting: ${verifyUrl}\n\nThis link expires in 15 minutes.`;
  const html    = buildEmailHtml({
    title:    'Verify Your Email',
    preheader: 'One click to activate your account',
    body: `
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        Thanks for signing up! Click the button below to verify your email address and activate your account.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${verifyUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 32px;border-radius:12px;">
          Verify Email Address
        </a>
      </div>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;text-align:center;">
        ⏱ This link expires in <strong>15 minutes</strong>.
      </p>
      <p style="margin:0;color:#64748b;font-size:12px;text-align:center;word-break:break-all;">
        Or copy this link: <a href="${verifyUrl}" style="color:#16a34a;">${verifyUrl}</a>
      </p>
    `,
    footer: "If you didn't create an account, you can safely ignore this email.",
  });
  return sendMail({ to: toEmail, subject, text, html });
}

/* ── Password reset ───────────────────────────────────────────────────── */
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const subject = 'Reset your Sanathana Tattva password';
  const text    = `Reset your password by visiting: ${resetUrl}\n\nThis link expires in 15 minutes.`;
  const html    = buildEmailHtml({
    title:    'Reset Your Password',
    preheader: 'Password reset requested',
    body: `
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        We received a request to reset your password. Click the button below to choose a new one.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${resetUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 32px;border-radius:12px;">
          Reset Password
        </a>
      </div>
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;text-align:center;">
        ⏱ This link expires in <strong>15 minutes</strong>.
      </p>
      <p style="margin:0;color:#64748b;font-size:12px;text-align:center;word-break:break-all;">
        Or copy this link: <a href="${resetUrl}" style="color:#4f46e5;">${resetUrl}</a>
      </p>
    `,
    footer: "If you didn't request a password reset, you can safely ignore this email.",
  });
  return sendMail({ to: toEmail, subject, text, html });
}

/* ── Shared HTML template ─────────────────────────────────────────────── */
function buildEmailHtml({ title, preheader, body, footer }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:linear-gradient(135deg,#14532d 0%,#16a34a 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Sanathana Tattva</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">${title}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">${footer}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, DEV_MODE };
