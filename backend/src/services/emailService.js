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
async function sendMail({ to, subject, text, html, attachments }) {
  if (DEV_MODE) {
    console.log(`\n📧 [EMAIL DEV] To: ${to} | Subject: ${subject}${attachments?.length ? ` | attachments=${attachments.length}` : ''}\n`);
    return { dev: true };
  }

  const payload = { from: FROM, to, subject, text, html };
  if (attachments?.length) {
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content:  Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
    }));
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`[email] FAILED to=${to} subject="${subject}" status=${res.status} body=${bodyText}`);
    throw new Error(`Resend API error ${res.status}: ${bodyText}`);
  }

  let id;
  try { id = JSON.parse(bodyText)?.id; } catch {}
  console.log(`[email] sent to=${to} subject="${subject}" resend_id=${id || '?'}`);
  return { dev: false, id };
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

const { getPublicSiteUrl } = require('../utils/publicUrl');
const SHOP_URL = getPublicSiteUrl();

/* ── Order Confirmed ──────────────────────────────────────────────────── */
async function sendOrderConfirmedEmail(toEmail, consumerName, orderNumber, invoiceUrl = null) {
  const trackUrl = `${SHOP_URL}/shop/orders`;
  const subject  = `Order confirmed — ${orderNumber}`;
  const text     = `Hi ${consumerName || 'there'},\n\nYour order ${orderNumber} has been confirmed and is being prepared.\n\nTrack your order: ${trackUrl}${invoiceUrl ? `\n\nView your invoice: ${invoiceUrl}` : ''}\n\nThank you for shopping with Sanathana Tattva.`;
  const html     = buildEmailHtml({
    title:    'Order Confirmed',
    preheader: `Your order ${orderNumber} is confirmed and being prepared`,
    body: `
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${consumerName || 'there'},
      </p>
      <p style="margin:0 0 20px;color:#0f172a;font-size:15px;line-height:1.6;">
        Your order <strong style="color:#14532d;">#${orderNumber}</strong> has been <strong>confirmed</strong> and is being prepared for delivery.
      </p>
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${trackUrl}" style="display:inline-block;background:#14532d;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:12px;">
          Track My Order →
        </a>
      </div>
      ${invoiceUrl ? `
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${invoiceUrl}" style="display:inline-block;background:#f8fafc;color:#14532d;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:12px;border:1.5px solid #14532d;">
          View Invoice →
        </a>
      </div>
      ` : ''}
      <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">
        You'll receive another email when your order is out for delivery.
      </p>
    `,
    footer: 'Sanathana Tattva — Pure, Cold Pressed Oils',
  });
  return sendMail({ to: toEmail, subject, text, html });
}

/* ── Out For Delivery ─────────────────────────────────────────────────── */
async function sendOutForDeliveryEmail(toEmail, consumerName, orderNumber) {
  const trackUrl = `${SHOP_URL}/shop/orders`;
  const subject  = `Your order is on the way — ${orderNumber}`;
  const text     = `Hi ${consumerName || 'there'},\n\nGreat news! Your order ${orderNumber} is out for delivery and will arrive soon.\n\nTrack your order: ${trackUrl}\n\nYou'll receive a separate message with your delivery OTP code shortly.`;
  const html     = buildEmailHtml({
    title:    'Out For Delivery',
    preheader: `Your order ${orderNumber} is on its way to you`,
    body: `
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${consumerName || 'there'},
      </p>
      <p style="margin:0 0 20px;color:#0f172a;font-size:15px;line-height:1.6;">
        Great news! Your order <strong style="color:#14532d;">#${orderNumber}</strong> is <strong>out for delivery</strong> and will arrive at your doorstep soon.
      </p>
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${trackUrl}" style="display:inline-block;background:#14532d;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:12px;">
          Track My Order →
        </a>
      </div>
      <p style="margin:0;color:#64748b;font-size:13px;text-align:center;">
        You'll receive your delivery OTP code in a separate email — share it only with your delivery agent to confirm receipt.
      </p>
    `,
    footer: 'Sanathana Tattva — Pure, Cold Pressed Oils',
  });
  return sendMail({ to: toEmail, subject, text, html });
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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ravigbb@gmail.com';

async function sendAdminStockAlert({ dealerName, orderNumber, errorMessage }) {
  const subject = `⚠️ Stock shortage — ${dealerName} cannot pack ${orderNumber}`;
  const text = `Admin alert: ${dealerName} tried to pack order ${orderNumber} but failed due to insufficient stock.\n\nError: ${errorMessage}\n\nPlease restock this dealer from the admin panel.`;
  const html = buildEmailHtml({
    title: 'Stock Shortage Alert',
    preheader: `${dealerName} cannot pack ${orderNumber} — restock needed`,
    body: `
      <p style="margin:0 0 16px;color:#0f172a;font-size:15px;">
        A dealer attempted to pack an order but does not have enough stock.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Dealer</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:700;padding-bottom:6px;">${dealerName.replace(/</g, '&lt;')}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Order</td>
            <td align="right" style="color:#0f172a;font-size:13px;font-family:monospace;padding-bottom:6px;">${orderNumber}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Error</td>
            <td align="right" style="color:#b91c1c;font-size:13px;font-weight:600;">${errorMessage.replace(/</g, '&lt;')}</td></tr>
      </table>
      <p style="margin:0;color:#64748b;font-size:13px;">Please restock this dealer from the <strong>Admin → Partner Inventory</strong> panel.</p>
    `,
    footer: 'Sanathana Tattva',
  });
  return sendMail({ to: ADMIN_EMAIL, subject, text, html });
}

async function sendAdminLowStockEmail({ dealerName, productName, quantity, threshold, unit }) {
  const subject = `⚠️ Low stock — ${dealerName} · ${productName}`;
  const qtyStr  = `${quantity}${unit ? ' ' + unit + (quantity === 1 ? '' : 's') : ''}`;
  const thrStr  = `${threshold}${unit ? ' ' + unit + (threshold === 1 ? '' : 's') : ''}`;
  const text =
    `Low-stock alert\n\n` +
    `Partner: ${dealerName}\n` +
    `Product: ${productName}\n` +
    `Quantity left: ${qtyStr}\n` +
    `Alert threshold: ${thrStr}\n\n` +
    `Restock this partner from the Admin → Partner Inventory panel.`;
  const html = buildEmailHtml({
    title:    'Low Stock Alert',
    preheader: `${dealerName} · ${productName} at ${qtyStr}`,
    body: `
      <p style="margin:0 0 16px;color:#0f172a;font-size:15px;">
        A partner's inventory has dropped to their alert threshold.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Partner</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:700;padding-bottom:6px;">${dealerName.replace(/</g, '&lt;')}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Product</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:6px;">${productName.replace(/</g, '&lt;')}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Quantity left</td>
            <td align="right" style="color:#b91c1c;font-size:18px;font-weight:800;padding-bottom:6px;">${qtyStr}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Alert threshold</td>
            <td align="right" style="color:#0f172a;font-size:13px;">${thrStr}</td></tr>
      </table>
      <p style="margin:0;color:#64748b;font-size:13px;">Restock from <strong>Admin → Partner Inventory</strong>.</p>
    `,
    footer: 'Sanathana Tattva',
  });
  return sendMail({ to: ADMIN_EMAIL, subject, text, html });
}

/* ── GST Invoice (PDF attached) ───────────────────────────────────────── */
async function sendInvoiceEmail({ to, consumerName, invoiceNumber, orderNumber, totalAmount, pdfBuffer, pdfFilename, supplementary = false, parentInvoiceNumber = null }) {
  const businessName = process.env.BUSINESS_NAME  || 'Gravity Traders';
  const brandName    = process.env.BUSINESS_BRAND || 'SanathanaTattva';
  const amtStr = `Rs. ${Number(totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const subject = supplementary
    ? `Supplementary Tax Invoice ${invoiceNumber} — forfeited container deposit`
    : `Your Invoice from ${brandName} - ${invoiceNumber}`;
  const text = supplementary
    ? `Hi ${consumerName || 'there'},\n\n` +
      `This is a supplementary tax invoice (${invoiceNumber}) for the forfeited container deposit ` +
      `on your earlier order ${orderNumber} (invoice ${parentInvoiceNumber || ''}).\n\n` +
      `Amount recognised as taxable: ${amtStr}.\n\n` +
      `This deposit was already paid by you at the time of purchase, so no new payment is required. ` +
      `We are issuing this invoice purely to comply with GST law, which requires us to record the ` +
      `forfeited deposit as a taxable supply.\n\n` +
      `The PDF is attached for your records.\n\n` +
      `— ${brandName} (a brand of ${businessName})`
    : `Hi ${consumerName || 'there'},\n\n` +
      `Thank you for choosing ${brandName}! We are truly grateful for your trust in our pure, cold-pressed oils.\n\n` +
      `Your tax invoice ${invoiceNumber} for order ${orderNumber} (${amtStr}) is attached as a PDF.\n\n` +
      `Payment has already been received — this is a receipt, no further action is needed.\n\n` +
      `We look forward to serving you again.\n\n` +
      `— ${brandName} (a brand of ${businessName})`;
  const html = buildEmailHtml({
    title:    supplementary ? 'Supplementary Tax Invoice' : 'Your Tax Invoice',
    preheader: supplementary
      ? `Supplementary invoice ${invoiceNumber} · forfeited deposit ${amtStr}`
      : `Invoice ${invoiceNumber} · ${amtStr} · Payment received`,
    body: supplementary ? `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${consumerName || 'there'},
      </p>
      <p style="margin:0 0 20px;color:#0f172a;font-size:15px;line-height:1.6;">
        This is a <strong>supplementary tax invoice</strong> (<strong>${invoiceNumber}</strong>) issued for the
        <strong>forfeited container deposit</strong> on your earlier order
        <strong>#${orderNumber}</strong>${parentInvoiceNumber ? ` (original invoice <strong>${parentInvoiceNumber}</strong>)` : ''}.
      </p>
      <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
        The deposit was already paid by you at the time of purchase, so <strong>no new payment is required</strong>.
        We are issuing this invoice purely to comply with GST law, which requires the forfeited deposit
        to be recorded as a taxable supply.
      </p>
    ` : `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${consumerName || 'there'},
      </p>
      <p style="margin:0 0 16px;color:#0f172a;font-size:16px;line-height:1.6;font-weight:600;">
        Thank you for choosing <span style="color:#14532d;">${brandName}</span>! 🙏
      </p>
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
        We are truly grateful for your trust in our pure, cold-pressed oils, and we look forward to serving you again.
      </p>
      <p style="margin:0 0 20px;color:#0f172a;font-size:15px;line-height:1.6;">
        Your tax invoice <strong>${invoiceNumber}</strong> for order
        <strong>#${orderNumber}</strong> is attached as a PDF.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:18px 22px;margin:0 0 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Amount</td>
              <td align="right" style="color:#15803d;font-size:22px;font-weight:800;padding-bottom:6px;">${amtStr}</td></tr>
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Status</td>
              <td align="right" style="color:#15803d;font-size:14px;font-weight:700;">Payment Received</td></tr>
        </table>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:13px;text-align:center;">
        This is a tax receipt. No further payment is due.
      </p>
    `,
    footer: `${brandName} — a brand of ${businessName}`,
  });
  return sendMail({
    to, subject, text, html,
    attachments: [{ filename: pdfFilename, content: pdfBuffer }],
  });
}

/* ── Container refund request (dealer + admin) ───────────────────────────
 * Sent to both the consumer's linked dealer AND the admin when a consumer
 * opts a container out for refund. The linked dealer is responsible for
 * physical pickup regardless of distance.
 */
async function sendContainerRefundRequestEmail({
  to, recipientName, recipientRole,        // 'dealer' | 'admin'
  consumerName, consumerPhone, consumerAddress,
  productName, containerType, destination, notes, holdingId,
}) {
  const destLabel = destination === 'store_credit' ? 'Store credit' : 'Manual bank refund';
  const isDealer  = recipientRole === 'dealer';
  const subject   = isDealer
    ? `Container pickup needed — ${consumerName} (1 × ${containerType})`
    : `Container refund requested — ${consumerName} (${destLabel})`;
  const text =
    `Hi ${recipientName || 'there'},\n\n` +
    `${consumerName} has requested a refund for 1 × ${containerType} container ` +
    `(originally bought with ${productName}).\n\n` +
    `Refund destination: ${destLabel}\n` +
    (isDealer
      ? `\nAs the linked dealer, please collect this container from the consumer on your next visit, ` +
        `regardless of distance. Inspect for damage before marking the refund as approved.\n\n` +
        `Consumer phone: ${consumerPhone || 'n/a'}\n` +
        (consumerAddress ? `Pickup address: ${consumerAddress}\n` : '')
      : `\nThe linked dealer has been notified to pick up the container. ` +
        `You will see this request in the admin Container Refunds queue.\n`) +
    (notes ? `\nConsumer note: "${notes}"\n` : '') +
    `\nHolding ID: ${holdingId}\n\n— Sanathana Tattva`;
  const html = buildEmailHtml({
    title:    isDealer ? 'Container Pickup Needed' : 'Container Refund Requested',
    preheader: `${consumerName} · 1 × ${containerType} · ${destLabel}`,
    body: `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${recipientName || 'there'},
      </p>
      <p style="margin:0 0 16px;color:#0f172a;font-size:15px;line-height:1.6;">
        <strong>${consumerName.replace(/</g, '&lt;')}</strong> has requested a refund for
        <strong>1 × ${containerType}</strong> container (originally bought with
        <strong>${productName.replace(/</g, '&lt;')}</strong>).
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:18px 22px;margin:0 0 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Destination</td>
              <td align="right" style="color:#0f172a;font-size:14px;font-weight:700;padding-bottom:6px;">${destLabel}</td></tr>
          <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Holding ID</td>
              <td align="right" style="color:#0f172a;font-size:13px;font-family:monospace;padding-bottom:6px;">#${holdingId}</td></tr>
          ${isDealer && consumerPhone ? `<tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Phone</td>
              <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:6px;">${consumerPhone}</td></tr>` : ''}
          ${isDealer && consumerAddress ? `<tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Pickup address</td>
              <td align="right" style="color:#0f172a;font-size:13px;">${consumerAddress.replace(/</g, '&lt;')}</td></tr>` : ''}
        </table>
        ${notes ? `<p style="margin:14px 0 0;color:#475569;font-size:13px;font-style:italic;">"${notes.replace(/</g, '&lt;')}"</p>` : ''}
      </div>
      ${isDealer ? `
      <p style="margin:0 0 8px;color:#0f172a;font-size:14px;line-height:1.6;">
        As the linked dealer, please <strong>collect this container on your next visit, regardless of distance</strong>. Inspect for damage before marking the refund as approved.
      </p>
      ` : `
      <p style="margin:0 0 8px;color:#0f172a;font-size:14px;line-height:1.6;">
        The linked dealer has been notified to pick up the container. You will see this request in the admin Container Refunds queue.
      </p>
      `}
    `,
    footer: 'Sanathana Tattva — Pure, Cold Pressed Oils',
  });
  return sendMail({ to, subject, text, html });
}

/* Phase 9 — driver reported container as damaged. Triggers an admin
 * email with the photo URL + a 48h dispute deadline reminder. */
async function sendAdminDamageReportEmail({
  driverName, consumerName, consumerPhone, holdingId,
  containerType, depositAmount, damagePhotoUrl, disputeDeadline, notes,
}) {
  const subject = `📸 Container damage reported — ${containerType} · ₹${depositAmount}`;
  const text =
    `Damage report on container holding #${holdingId}\n\n` +
    `Driver: ${driverName}\n` +
    `Consumer: ${consumerName}${consumerPhone ? ' (' + consumerPhone + ')' : ''}\n` +
    `Container: ${containerType} · Deposit ₹${depositAmount}\n` +
    `Photo: ${damagePhotoUrl || 'NOT PROVIDED'}\n` +
    `Dispute deadline: ${disputeDeadline}\n` +
    (notes ? `Notes: ${notes}\n\n` : '\n') +
    `The consumer can dispute this within 48 hours via WhatsApp.`;
  const html = buildEmailHtml({
    title: 'Container Damage Report',
    preheader: `${driverName} reported a damaged ${containerType} from ${consumerName}`,
    body: `
      <p style="margin:0 0 16px;color:#0f172a;font-size:15px;">
        A delivery agent has reported a damaged container during pickup. The deposit will be forfeited unless the consumer disputes within 48 hours.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Driver</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:700;padding-bottom:6px;">${(driverName||'').replace(/</g,'&lt;')}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Consumer</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:6px;">${(consumerName||'').replace(/</g,'&lt;')}${consumerPhone ? ' · ' + consumerPhone : ''}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Container</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:6px;">${containerType}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Deposit at stake</td>
            <td align="right" style="color:#b91c1c;font-size:18px;font-weight:800;padding-bottom:6px;">₹${depositAmount}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Dispute deadline</td>
            <td align="right" style="color:#0f172a;font-size:13px;font-family:monospace;">${disputeDeadline}</td></tr>
      </table>
      ${damagePhotoUrl ? `<p style="margin:0 0 8px;font-size:13px;color:#64748b;">Damage photo:</p>
        <p style="margin:0 0 16px;"><a href="${damagePhotoUrl}" style="color:#0d9488;text-decoration:underline;font-size:13px;font-family:monospace;">${damagePhotoUrl}</a></p>` : ''}
      ${notes ? `<p style="margin:0 0 8px;font-size:13px;color:#64748b;">Driver notes:</p>
        <p style="margin:0 0 16px;color:#0f172a;font-size:13px;">${notes.replace(/</g,'&lt;')}</p>` : ''}
      <p style="margin:0;color:#64748b;font-size:13px;">If the consumer disputes via WhatsApp, you can override the holding back to <em>held</em> in the Admin → Holdings page.</p>
    `,
    footer: 'Sanathana Tattva',
  });
  return sendMail({ to: ADMIN_EMAIL, subject, text, html });
}

/* Phase 9 — consumer raised a damage dispute. Mirrors the WhatsApp ping
 * so the admin has a permanent paper trail in their inbox. */
async function sendAdminDisputeOpenedEmail({
  consumerName, consumerPhone, holdingId, containerType, depositAmount, consumerNotes,
}) {
  const subject = `🚨 Consumer disputed damage — ${containerType} · ₹${depositAmount}`;
  const text =
    `Damage dispute opened on holding #${holdingId}\n\n` +
    `Consumer: ${consumerName}${consumerPhone ? ' (' + consumerPhone + ')' : ''}\n` +
    `Container: ${containerType} · Deposit ₹${depositAmount}\n` +
    (consumerNotes ? `Their statement: ${consumerNotes}\n\n` : '\n') +
    `Reach out via WhatsApp and resolve in /admin/holdings.`;
  const html = buildEmailHtml({
    title: 'Damage Dispute Opened',
    preheader: `${consumerName} is contesting the damage claim on holding #${holdingId}`,
    body: `
      <p style="margin:0 0 16px;color:#0f172a;font-size:15px;">
        The consumer disagrees with the driver's damage report and has opened a dispute. Reach out via WhatsApp to gather their side.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Consumer</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:700;padding-bottom:6px;">${(consumerName||'').replace(/</g,'&lt;')}${consumerPhone ? ' · ' + consumerPhone : ''}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;padding-bottom:6px;">Container</td>
            <td align="right" style="color:#0f172a;font-size:14px;font-weight:600;padding-bottom:6px;">${containerType}</td></tr>
        <tr><td style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Deposit at stake</td>
            <td align="right" style="color:#b91c1c;font-size:18px;font-weight:800;">₹${depositAmount}</td></tr>
      </table>
      ${consumerNotes ? `<p style="margin:0 0 8px;font-size:13px;color:#64748b;">Consumer notes:</p>
        <p style="margin:0 0 16px;color:#0f172a;font-size:13px;">${consumerNotes.replace(/</g,'&lt;')}</p>` : ''}
    `,
    footer: 'Sanathana Tattva',
  });
  return sendMail({ to: ADMIN_EMAIL, subject, text, html });
}

/* ── Delivery assignment notification (to assigned trader) ────────────── */
async function sendDeliveryAssignmentEmail({
  toEmail, traderName, orderNumber, consumerName, consumerPhone,
  deliveryAddress, itemsSummary, totalAmount, orderUrl,
}) {
  const subject  = `New delivery assigned · Order ${orderNumber}`;
  const text     =
    `Hi ${traderName || 'there'},\n\n` +
    `A new consumer order has been assigned to you for delivery.\n\n` +
    `Order:    ${orderNumber}\n` +
    `Customer: ${consumerName || '—'}${consumerPhone ? ` (${consumerPhone})` : ''}\n` +
    `Address:  ${deliveryAddress || '—'}\n` +
    `Items:    ${itemsSummary || '—'}\n` +
    `Total:    ₹${Number(totalAmount || 0).toFixed(2)}\n\n` +
    `Open the order to accept and start delivery: ${orderUrl}\n`;
  const html     = buildEmailHtml({
    title:     'New delivery assigned',
    preheader: `Order ${orderNumber} — ${consumerName || 'customer'}`,
    body: `
      <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
        Hi <strong>${traderName || 'there'}</strong>, a new consumer order has been assigned to you for delivery.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border-radius:12px;padding:16px;margin:0 0 20px;">
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;width:96px;">Order</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;font-family:monospace;">${orderNumber}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;">Customer</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;">${consumerName || '—'}${consumerPhone ? ` · ${consumerPhone}` : ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;vertical-align:top;">Address</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;">${deliveryAddress || '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;vertical-align:top;">Items</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;">${itemsSummary || '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:13px;">Total</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:700;">₹${Number(totalAmount || 0).toFixed(2)}</td>
        </tr>
      </table>
      <div style="text-align:center;margin:0 0 16px;">
        <a href="${orderUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#14532d,#16a34a);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 28px;border-radius:12px;">
          Open delivery dashboard
        </a>
      </div>
      <p style="margin:0;color:#64748b;font-size:13px;text-align:center;">
        Accept the order, pack it, and confirm the customer's 6-digit OTP at the door.
      </p>
    `,
    footer: 'You are receiving this because you were assigned this order on Sanathana Tattva.',
  });
  return sendMail({ to: toEmail, subject, text, html });
}

module.exports = {
  sendVerificationEmail, sendPasswordResetEmail, sendDeliveryOtpEmail, sendReviewRequestEmail,
  sendCommissionConfirmationEmail, sendCommissionDisputeEmail, sendAdminStockAlert,
  sendAdminLowStockEmail,
  sendOrderConfirmedEmail, sendOutForDeliveryEmail, sendInvoiceEmail,
  sendContainerRefundRequestEmail,
  sendAdminDamageReportEmail, sendAdminDisputeOpenedEmail,
  sendDeliveryAssignmentEmail,
  DEV_MODE,
};
