/**
 * Self-generated GST-compliant invoice flow.
 *
 * Replaces the prior Razorpay Invoices API integration. Triggered from the
 * `payment.captured` webhook (idempotent — skips if invoice already exists
 * for the order).
 *
 * Pipeline:
 *   1. Pull order + items + consumer
 *   2. Allocate sequential invoice number (FY-scoped, resets every April 1)
 *   3. Compute taxable/CGST/SGST/IGST split (MRP is GST-inclusive)
 *   4. Insert row in `invoices` table
 *   5. Render PDF via pdfkit, save to disk
 *   6. Email PDF as attachment via Resend
 */

const db = require('../database/db');
const fs = require('fs');
const { renderInvoicePdf } = require('./invoicePdf');
const { stateFromPincode } = require('./pincodeState');
const { sendInvoiceEmail } = require('./emailService');
const { createHoldingsForInvoice } = require('./containerHoldingsService');

const BUSINESS_STATE = process.env.BUSINESS_STATE || 'Karnataka';

/* ── Invoice number generator (FY-scoped, sequential) ───────────────── */
function currentFY() {
  const now = new Date();
  const m = now.getMonth(), y = now.getFullYear();
  const start = m >= 3 ? y : y - 1; // April = month index 3
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

const allocateInvoiceNumber = db.transaction(() => {
  const fy = currentFY();
  const key = `invoice_seq_${fy}`;
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  const next = (row ? parseInt(row.value, 10) : 0) + 1;
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).run(key, String(next));
  return `INV-${fy}-${String(next).padStart(4, '0')}`;
});

/* ── Main entry point ───────────────────────────────────────────────── */
async function generateInvoiceForOrder(orderId, { paymentId } = {}) {
  const existing = db.prepare(`SELECT * FROM invoices WHERE order_id=?`).get(orderId);
  if (existing) {
    console.log(`[invoice] order ${orderId} already has invoice ${existing.invoice_number} — skipping`);
    return existing;
  }

  const order = db.prepare(`SELECT * FROM consumer_orders WHERE id=?`).get(orderId);
  if (!order) { console.log(`[invoice] order ${orderId} not found`); return null; }

  const consumer = db.prepare(`SELECT * FROM consumers WHERE id=?`).get(order.consumer_id);
  if (!consumer) { console.log(`[invoice] consumer ${order.consumer_id} not found`); return null; }

  const items = db.prepare(`
    SELECT oi.product_id, oi.quantity, oi.price AS unit_price, oi.is_refill,
           oi.container_cost,
           p.name, p.hsn_code, p.unit, p.container_type
    FROM consumer_order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId);

  if (!items.length) { console.log(`[invoice] order ${orderId} has no items — skipping`); return null; }

  /* ── Tax computation ─────────────────────────────────────────────────
   * Prices stored on consumer_order_items are GST-inclusive at the rate
   * declared on the product (default 5% for oils — HSN 1512).
   * For each item: gross = unit_price * qty; taxable = gross / (1+rate/100). */
  const DEFAULT_TAX_RATE = 5;

  const customerState = stateFromPincode(order.pincode);
  const isIntraState  = !!customerState && customerState === BUSINESS_STATE;

  let totalTaxable = 0, totalTax = 0, grossTotal = 0;
  const invoiceItems = items.map(it => {
    const rate    = DEFAULT_TAX_RATE; // oils — same rate across the SKU range
    const gross   = it.unit_price * it.quantity;
    const taxable = +(gross / (1 + rate / 100)).toFixed(2);
    const tax     = +(gross - taxable).toFixed(2);
    totalTaxable += taxable;
    totalTax     += tax;
    grossTotal   += gross;
    const displayName = (it.is_refill && it.container_type) ? `${it.name} (Refill)` : it.name;
    return {
      name:           displayName,
      hsn_code:       it.hsn_code || null,
      quantity:       it.quantity,
      unit_price:     it.unit_price,
      tax_rate:       rate,
      taxable_amount: taxable,
      tax_amount:     tax,
      is_refill:      it.is_refill ? 1 : 0,
      container_type: it.container_type || null,
    };
  });

  totalTaxable = +totalTaxable.toFixed(2);
  totalTax     = +totalTax.toFixed(2);

  const cgst = isIntraState ? +(totalTax / 2).toFixed(2) : 0;
  const sgst = isIntraState ? +(totalTax - cgst).toFixed(2) : 0;
  const igst = isIntraState ? 0 : totalTax;

  /* Refundable container deposit — not part of taxable supply.
   * Safe under CGST Act §2(31) Explanation: refundable deposits aren't
   * "consideration" until forfeited. Must be refunded on undamaged return. */
  const containerDeposit = +(order.container_costs_total || 0).toFixed(2);

  /* Invoice total = full taxable supply (including tax + refundable deposit).
   * Phase 7: any store credit applied is a payment instrument, NOT a discount
   * on the consideration. So the invoice total stays at gross; only the
   * Razorpay charge (order.total_amount) is reduced. */
  const totalAmount = +(totalTaxable + totalTax + containerDeposit).toFixed(2);

  const invoiceNumber = allocateInvoiceNumber();

  /* ── Persist row ─────────────────────────────────────────────────── */
  const insert = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id,
      customer_name, customer_email, customer_phone, customer_address, customer_state, customer_gstin,
      items_json, taxable_amount, cgst_amount, sgst_amount, igst_amount, container_deposit, total_amount,
      razorpay_payment_id
    ) VALUES (?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?, ?)
  `);
  const result = insert.run(
    invoiceNumber, orderId,
    consumer.name, consumer.email || null, consumer.phone || null,
    order.delivery_address || null, customerState || null, consumer.gstin || null,
    JSON.stringify(invoiceItems),
    totalTaxable, cgst, sgst, igst, containerDeposit, totalAmount,
    paymentId || order.razorpay_payment_id || null
  );
  const invoiceId = result.lastInsertRowid;

  /* ── Materialise per-unit container holdings (Phase 2) ─────────────
   * One row per physical container in pending_delivery state. Flipped
   * to 'held' when the delivery agent verifies OTP. */
  try {
    createHoldingsForInvoice({ invoiceId, orderId, consumerId: order.consumer_id });
  } catch (err) {
    console.error(`[invoice] holdings creation failed for ${invoiceNumber}:`, err.message);
  }

  /* ── Render PDF ──────────────────────────────────────────────────── */
  let pdfPath = null;
  try {
    pdfPath = await renderInvoicePdf({
      invoice_number:      invoiceNumber,
      order_number:        order.order_number,
      created_at:          new Date().toISOString(),
      customer_name:       consumer.name,
      customer_email:      consumer.email,
      customer_phone:      consumer.phone,
      customer_address:    order.delivery_address,
      customer_state:      customerState,
      customer_gstin:      consumer.gstin,
      items:               invoiceItems,
      taxable_amount:      totalTaxable,
      cgst_amount:         cgst,
      sgst_amount:         sgst,
      igst_amount:         igst,
      container_deposit:   containerDeposit,
      total_amount:        totalAmount,
      razorpay_payment_id: paymentId || order.razorpay_payment_id || null,
    });
    db.prepare(`UPDATE invoices SET pdf_path=? WHERE id=?`).run(pdfPath, invoiceId);
  } catch (err) {
    console.error(`[invoice] PDF render failed for ${invoiceNumber}:`, err.message);
  }

  /* ── Email PDF (best-effort) ─────────────────────────────────────── */
  if (consumer.email && pdfPath) {
    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      await sendInvoiceEmail({
        to:             consumer.email,
        consumerName:   consumer.name,
        invoiceNumber,
        orderNumber:    order.order_number,
        totalAmount,
        pdfBuffer,
        pdfFilename:    `${invoiceNumber}.pdf`,
      });
    } catch (err) {
      console.error(`[invoice] email send failed for ${invoiceNumber}:`, err.message);
    }
  }

  console.log(`[invoice] ${invoiceNumber} created for order ${order.order_number} (intra-state=${isIntraState})`);
  return db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId);
}

module.exports = { generateInvoiceForOrder, allocateInvoiceNumber };
