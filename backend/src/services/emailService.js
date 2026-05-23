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

/* ── Review request ───────────────────────────────────────────────────── */
async function sendReviewRequestEmail(toEmail, consumerName, productName, reviewUrl) {
  const subject = `How was your ${productName}? Leave a review`;
  const text    = `Hi ${consumerName || 'there'},\n\nWe hope you're enjoying your ${productName}. We'd love to hear what you think!\n\nLeave your review here: ${reviewUrl}\n\nThank you for shopping with Sanathana Tattva.`;
  const html    = buildEmailHtml({
    title:    'How Was Your Order?',
    preheader: `Share your experience with ${productName}`,
    body: `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${consumerName || 'there'},
      </p>
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        We hope you're loving your <strong>${productName}</strong>! Your feedback helps other customers and helps us improve.
      </p>
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${reviewUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#14532d 0%,#16a34a 100%);color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 36px;border-radius:12px;">
          ⭐ Leave a Review
        </a>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">
        Takes less than a minute. Your review link is valid for 30 days.
      </p>
    `,
    footer: 'Sanathana Tattva — Pure, Cold Pressed Oils',
  });
  return sendMail({ to: toEmail, subject, text, html });
}

/* ── Sub-dealer commission payment confirmation ───────────────────────── */
async function sendCommissionConfirmationEmail(toEmail, {
  subDealerName, parentName, amount, method, confirmUrl, orderNumber, note,
}) {
  const methodLabel = method === 'cash' ? 'Cash (in person)' : 'Bank transfer';
  const amtStr      = `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const subject     = `Confirm commission payment of ${amtStr} from ${parentName}`;
  const text =
    `Hi ${subDealerName || 'there'},\n\n` +
    `${parentName} has marked a commission payment of ${amtStr} as paid to you via ${methodLabel}` +
    (orderNumber ? ` (order ${orderNumber})` : '') + `.\n\n` +
    `Please confirm whether you received this payment:\n${confirmUrl}\n\n` +
    `If you did not receive it, you can dispute the payment on that page — the admin will be notified immediately.\n\n` +
    `This link expires in 14 days.`;
  const html = buildEmailHtml({
    title:    'Confirm Commission Payment',
    preheader: `${parentName} marked ${amtStr} as paid — confirm or dispute`,
    body: `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${subDealerName || 'there'},
      </p>
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        <strong>${parentName}</strong> has marked a commission payment as paid to you. Please confirm whether you actually received the amount below.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:18px 22px;margin:0 0 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Amount</td>
              <td align="right" style="color:#15803d;font-size:22px;font-weight:800;padding-bottom:6px;">${amtStr}</td></tr>
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Method</td>
              <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:4px;">${methodLabel}</td></tr>
          ${orderNumber ? `<tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Order</td>
              <td align="right" style="color:#0f172a;font-size:13px;font-family:monospace;">${orderNumber}</td></tr>` : ''}
          ${note ? `<tr><td colspan="2" style="padding-top:10px;color:#64748b;font-size:12px;font-style:italic;">"${note.replace(/</g, '&lt;')}"</td></tr>` : ''}
        </table>
      </div>
      <div style="text-align:center;margin:0 0 16px;">
        <a href="${confirmUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#14532d 0%,#16a34a 100%);color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 36px;border-radius:12px;">
          Review & Confirm
        </a>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
        Link valid for 14 days. If you didn't receive this payment, choose <strong>Dispute</strong> on the page.
      </p>
    `,
    footer: 'Sanathana Tattva — Pure, Cold Pressed Oils',
  });
  return sendMail({ to: toEmail, subject, text, html });
}

/* ── Notify parent + admin of a disputed payment ──────────────────────── */
async function sendCommissionDisputeEmail(toEmail, {
  recipientName, subDealerName, parentName, amount, reason, orderNumber,
}) {
  const amtStr  = `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const subject = `[Dispute] ${subDealerName} did not receive ${amtStr} commission`;
  const text =
    `Hi ${recipientName || 'there'},\n\n` +
    `${subDealerName} has DISPUTED a commission payment of ${amtStr} marked as paid by ${parentName}` +
    (orderNumber ? ` for order ${orderNumber}` : '') + `.\n\n` +
    (reason ? `Reason: ${reason}\n\n` : '') +
    `Please investigate and reconcile manually.`;
  const html = buildEmailHtml({
    title:    'Commission Payment Disputed',
    preheader: `${subDealerName} disputed ${amtStr} from ${parentName}`,
    body: `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${recipientName || 'there'},
      </p>
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        <strong>${subDealerName}</strong> has <strong style="color:#dc2626;">disputed</strong> a commission payment marked as paid by <strong>${parentName}</strong>.
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:14px;padding:18px 22px;margin:0 0 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Amount</td>
              <td align="right" style="color:#b91c1c;font-size:20px;font-weight:800;padding-bottom:6px;">${amtStr}</td></tr>
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Sub-dealer</td>
              <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:4px;">${subDealerName}</td></tr>
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:4px;">Paid by</td>
              <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:4px;">${parentName}</td></tr>
          ${orderNumber ? `<tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Order</td>
              <td align="right" style="color:#0f172a;font-size:13px;font-family:monospace;">${orderNumber}</td></tr>` : ''}
        </table>
        ${reason ? `<p style="margin:14px 0 0;color:#7f1d1d;font-size:13px;font-style:italic;">Reason: "${reason.replace(/</g, '&lt;')}"</p>` : ''}
      </div>
      <p style="margin:0;color:#64748b;font-size:13px;">Please reach out to both parties and reconcile.</p>
    `,
    footer: 'Sanathana Tattva',
  });
  return sendMail({ to: toEmail, subject, text, html });
}

module.exports = {
  sendVerificationEmail, sendPasswordResetEmail, sendDeliveryOtpEmail, sendReviewRequestEmail,
  sendCommissionConfirmationEmail, sendCommissionDisputeEmail, DEV_MODE,
};
