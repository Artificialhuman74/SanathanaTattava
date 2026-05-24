const Razorpay = require('razorpay');
const db = require('../database/db');

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const SHOP_URL = process.env.FRONTEND_URL || 'https://sanathanatattva.shop';

/**
 * Create Razorpay Invoice(s) for a consumer order after payment is confirmed.
 *
 * - Normal order  → one invoice (products only), terms = thank-you note.
 * - First-time order containing refundable containers → two invoices:
 *     1) Products invoice  → terms tell consumer the container invoice is coming.
 *     2) Container invoice → separate, refundable-deposit note.
 *
 * Only the products invoice is returned to the caller (its short_url is what
 * we embed in the order-confirmation email). Razorpay itself SMS/emails both.
 */
async function sendOrderInvoice(orderId) {
  if (!razorpay) return;

  const order = db.prepare('SELECT * FROM consumer_orders WHERE id = ?').get(orderId);
  if (!order) return;
  if (order.razorpay_invoice_id) return; // already created

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
   * Track whether any line was rounded up so we can disclose it on the invoice. */
  let productsRounded = false;
  const productLineItems = items.map(item => {
    const raw     = Math.round(item.price * discountFactor * 100);
    const clamped = Math.max(100, raw);
    if (clamped !== raw) productsRounded = true;
    return {
      name:        item.product_name,
      description: `per ${item.unit || 'unit'}`,
      amount:      clamped,
      quantity:    item.quantity,
    };
  });

  const phone = consumer.phone ? consumer.phone.replace(/^(\+91|91)/, '').replace(/\D/g, '') : null;
  const containerTotal = order.container_costs_total || 0;
  const hasContainer = containerTotal > 0;
  const rawContainerPaise = Math.round(containerTotal * 100);
  const containerRounded = hasContainer && rawContainerPaise < 100;

  const ROUNDING_NOTE = 'Note: line items below ₹1.00 are shown rounded up to ₹1.00 per unit due to gateway minimums; the actual amount charged matches your order total.';

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
  const notifyFlags = {
    sms_notify:   phone          ? 1 : 0,
    email_notify: consumer.email ? 1 : 0,
  };
  /* Issue date = order's created_at (in IST it'll render as the order's day).
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

  const nowSec   = Math.floor(Date.now() / 1000);
  const dateSec  = Math.floor(createdUtc.getTime() / 1000);
  /* Razorpay requires expire_by to be strictly in the future; pad if needed. */
  const expireBy = Math.max(Math.floor(istEndOfDay.getTime() / 1000), nowSec + 900);

  /* ── 1) Products invoice ──────────────────────────────────────────────── */
  const productsBaseTerms = hasContainer
    ? 'A separate invoice for your refundable container deposit will be sent shortly.'
    : 'Thank you for choosing SanathanaTattva.';
  const productsTerms = productsRounded
    ? `${productsBaseTerms} ${ROUNDING_NOTE}`
    : productsBaseTerms;

  const productsInvoice = await razorpay.invoices.create({
    type:        'invoice',
    description: `Order ${order.order_number} — Sanathana Tattva`,
    customer,
    line_items:  productLineItems,
    currency:    'INR',
    date:        dateSec,
    expire_by:   expireBy,
    ...notifyFlags,
    terms:       productsTerms,
    notes: {
      order_number: order.order_number,
      order_id:     String(order.id),
      kind:         'products',
      track_url:    `${SHOP_URL}/shop/orders`,
    },
  });

  db.prepare(`
    UPDATE consumer_orders
    SET razorpay_invoice_id = ?, razorpay_invoice_status = ?
    WHERE id = ?
  `).run(productsInvoice.id, productsInvoice.status, orderId);

  console.log(`[invoice] ${productsInvoice.id} (products) created for order ${order.order_number} (${productsInvoice.status})`);

  /* ── 2) Container invoice (only on first-time container orders) ───────── */
  if (hasContainer) {
    try {
      const containerInvoice = await razorpay.invoices.create({
        type:        'invoice',
        description: `Container Deposit — Order ${order.order_number}`,
        customer,
        line_items: [{
          name:        'Refundable Container Deposit',
          description: 'One-time · Refundable if returned undamaged',
          amount:      Math.max(100, Math.round(containerTotal * 100)), // paise; Razorpay min is INR 1.00
          quantity:    1,
        }],
        currency:   'INR',
        date:       dateSec,
        expire_by:  expireBy,
        ...notifyFlags,
        terms:      containerRounded
          ? `This container deposit is fully refundable if returned undamaged. ${ROUNDING_NOTE}`
          : 'This container deposit is fully refundable if returned undamaged.',
        notes: {
          order_number: order.order_number,
          order_id:     String(order.id),
          kind:         'container_deposit',
        },
      });

      db.prepare(`
        UPDATE consumer_orders
        SET razorpay_container_invoice_id = ?, razorpay_container_invoice_status = ?
        WHERE id = ?
      `).run(containerInvoice.id, containerInvoice.status, orderId);

      console.log(`[invoice] ${containerInvoice.id} (container) created for order ${order.order_number} (${containerInvoice.status})`);
    } catch (err) {
      const rzpErr = err?.error || err;
      console.error(`[invoice] container invoice failed for order ${order.order_number}:`, {
        statusCode:  err?.statusCode,
        code:        rzpErr?.code,
        description: rzpErr?.description,
        field:       rzpErr?.field,
        reason:      rzpErr?.reason,
        message:     err?.message,
        raw:         JSON.stringify(err),
      });
    }
  }

  return productsInvoice;
}

module.exports = { sendOrderInvoice };
