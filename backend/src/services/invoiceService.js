const Razorpay = require('razorpay');
const db = require('../database/db');

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const SHOP_URL = process.env.FRONTEND_URL || 'https://sanathanatattva.shop';

/**
 * Create a single Razorpay Invoice for an already-paid consumer order.
 *
 * We link to the existing razorpay_order_id so Razorpay marks the invoice as
 * PAID automatically (no "Proceed to Pay" button — it's a receipt). Razorpay
 * itself SMS/emails the consumer the hosted invoice link.
 *
 * Container deposits (first-time orders) appear as a separate line item with
 * a refundable-deposit note in the terms.
 */
async function sendOrderInvoice(orderId) {
  if (!razorpay) return;

  const order = db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(orderId);
  if (!order) return;
  if (order.razorpay_invoice_id) return;             // already created
  if (!order.razorpay_order_id) {                    // can't link → skip
    console.log(`[invoice] skipping order ${order.order_number} — no razorpay_order_id`);
    return;
  }

  const consumer = db.prepare('SELECT * FROM consumers WHERE id = ?').get(order.consumer_id);
  if (!consumer) return;

  const hasContact = !!(consumer.phone || consumer.email);
  if (!hasContact) {
    console.log(`[invoice] skipping order ${order.order_number} — no consumer phone or email`);
    return;
  }

  const items = db.prepare(`
    SELECT oi.*, p.name as product_name, p.unit
    FROM consumer_order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId);

  /* Per-unit price already reflects the discount (we scale by discountFactor). */
  const discountFactor = order.discount_percent > 0 ? (1 - order.discount_percent / 100) : 1;

  /* Razorpay rejects line items below INR 1.00, so we clamp to 100 paise.
   * Track whether any line was rounded so we can disclose it on the invoice. */
  let anyRounded = false;
  const lineItems = items.map(item => {
    const raw     = Math.round(item.price * discountFactor * 100);
    const clamped = Math.max(100, raw);
    if (clamped !== raw) anyRounded = true;
    return {
      name:        item.product_name,
      description: `per ${item.unit || 'unit'}`,
      amount:      clamped,
      quantity:    item.quantity,
    };
  });

  const containerTotal = order.container_costs_total || 0;
  const hasContainer = containerTotal > 0;
  if (hasContainer) {
    const rawContainer     = Math.round(containerTotal * 100);
    const clampedContainer = Math.max(100, rawContainer);
    if (clampedContainer !== rawContainer) anyRounded = true;
    lineItems.push({
      name:        'Refundable Container Deposit',
      description: 'One-time · Refundable if returned undamaged',
      amount:      clampedContainer,
      quantity:    1,
    });
  }

  const phone = consumer.phone ? consumer.phone.replace(/^(\+91|91)/, '').replace(/\D/g, '') : null;

  /* Build address from the order's delivery info; mirror to billing + shipping. */
  const address = order.delivery_address && order.delivery_pincode
    ? {
        line1:   order.delivery_address,
        zipcode: String(order.delivery_pincode),
        country: 'India',
      }
    : null;

  const customer = {
    name:    consumer.name,
    ...(phone          ? { contact: `+91${phone}` } : {}),
    ...(consumer.email ? { email:   consumer.email } : {}),
    ...(address        ? { billing_address: address, shipping_address: address } : {}),
  };

  /* Issue date = order's created_at (in IST it renders as the order's day).
   * Expiry  = end of that same IST calendar day (23:59:59 +05:30).
   * SQLite CURRENT_TIMESTAMP is UTC, so parse explicitly as UTC. */
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const createdUtc    = new Date(String(order.created_at).replace(' ', 'T') + 'Z');
  const createdIst    = new Date(createdUtc.getTime() + IST_OFFSET_MS);
  const istEndOfDay   = new Date(Date.UTC(
    createdIst.getUTCFullYear(),
    createdIst.getUTCMonth(),
    createdIst.getUTCDate(),
    23, 59, 59,
  ) - IST_OFFSET_MS);

  const nowSec  = Math.floor(Date.now() / 1000);
  const dateSec = Math.floor(createdUtc.getTime() / 1000);
  const expireBy = Math.max(Math.floor(istEndOfDay.getTime() / 1000), nowSec + 900);

  /* Compose terms. */
  const baseTerms = hasContainer
    ? 'Thank you for choosing SanathanaTattva. Your container deposit is fully refundable if returned undamaged.'
    : 'Thank you for choosing SanathanaTattva.';
  const ROUNDING_NOTE = 'Note: line items below ₹1.00 are shown rounded up to ₹1.00 per unit due to gateway minimums; the actual amount charged matches your order total.';
  const terms = anyRounded ? `${baseTerms} ${ROUNDING_NOTE}` : baseTerms;

  const invoice = await razorpay.invoices.create({
    type:        'invoice',
    order_id:    order.razorpay_order_id, // links to the already-paid order → auto-marked PAID
    description: `Order ${order.order_number} — Sanathana Tattva`,
    customer,
    line_items:  lineItems,
    currency:    'INR',
    date:        dateSec,
    expire_by:   expireBy,
    sms_notify:   phone          ? 1 : 0,
    email_notify: consumer.email ? 1 : 0,
    terms,
    notes: {
      order_number: order.order_number,
      order_id:     String(order.id),
      track_url:    `${SHOP_URL}/shop/orders`,
    },
  });

  db.prepare(`
    UPDATE consumer_orders
    SET razorpay_invoice_id = ?, razorpay_invoice_status = ?
    WHERE id = ?
  `).run(invoice.id, invoice.status, orderId);

  console.log(`[invoice] ${invoice.id} created for order ${order.order_number} (${invoice.status})`);
  return invoice;
}

module.exports = { sendOrderInvoice };
