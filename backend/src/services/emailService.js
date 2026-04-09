/**
 * Email Service — Resend HTTP API
 *
 * Required env vars:
 *   RESEND_API_KEY  — API key from resend.com
 *
 * Dev mode (RESEND_API_KEY not set):
 *   Emails are NOT sent. OTP is returned in the API response as `dev_otp`.
 */

const DEV_MODE = !process.env.RESEND_API_KEY;

const FROM = process.env.EMAIL_FROM || 'Sanathana Tattva <namaste@sanathanatattva.shop>';

/* ── Generic send helper ──────────────────────────────────────────────── */
async function sendMail({ to, subject, text, html }) {
  if (DEV_MODE) {
    console.log(`\n📧 [EMAIL DEV] To: ${to} | Subject: ${subject}\n`);
    return { dev: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, text, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error ${res.status}: ${err}`);
  }

  return { dev: false };
}

/* ── Email verification ───────────────────────────────────────────────── */
async function sendVerificationEmail(toEmail, otp) {
  const subject = 'Your Sanathana Tattva verification code';
  const text    = `Your verification code is: ${otp}\n\nThis code expires in 15 minutes.`;
  const html    = buildEmailHtml({
    title:    'Verify Your Email',
    preheader: `Your verification code: ${otp}`,
    body: `
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        Thanks for signing up! Enter the code below in the app to verify your email address.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <div style="display:inline-block;background:#f0fdf4;border:2px dashed #16a34a;border-radius:16px;padding:20px 40px;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">Verification Code</p>
          <p style="margin:0;color:#15803d;font-size:40px;font-weight:800;letter-spacing:0.25em;font-family:monospace;">${otp}</p>
        </div>
      </div>
      <p style="margin:0;color:#64748b;font-size:13px;text-align:center;">
        ⏱ This code expires in <strong>15 minutes</strong>. Do not share it with anyone.
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

/* ── Delivery OTP ─────────────────────────────────────────────────────── */
async function sendDeliveryOtpEmail(toEmail, consumerName, otp, orderNumber) {
  const subject = `Your delivery code — Order ${orderNumber}`;
  const text    = `Your delivery is on the way!\n\nDelivery code: ${otp}\n\nShow this code to the delivery agent to confirm receipt of Order ${orderNumber}.`;
  const html    = buildEmailHtml({
    title:    'Your Order Is On The Way',
    preheader: `Delivery code for order ${orderNumber}: ${otp}`,
    body: `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${consumerName || 'there'},<br/>
        Your order <strong>#${orderNumber}</strong> is out for delivery. Show the code below to the delivery agent to confirm receipt.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <div style="display:inline-block;background:#fdf8f0;border:2px dashed #c8963c;border-radius:16px;padding:20px 40px;">
          <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;">Delivery Code</p>
          <p style="margin:0;color:#14532d;font-size:44px;font-weight:800;letter-spacing:0.3em;font-family:monospace;">${otp}</p>
        </div>
      </div>
      <p style="margin:0;color:#64748b;font-size:13px;text-align:center;">
        Do not share this code with anyone other than your delivery agent.
      </p>
    `,
    footer: 'Sanathana Tattva — Pure, Cold Pressed Oils',
  });
  return sendMail({ to: toEmail, subject, text, html });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendDeliveryOtpEmail, DEV_MODE };
