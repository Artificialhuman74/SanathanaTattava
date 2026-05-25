/**
 * Container deposit lifecycle — refund or forfeit.
 *
 * Refund:   marks the original tax invoice's deposit as 'refunded'. No GST impact.
 * Forfeit:  the deposit becomes taxable consideration (CGST Act §15). A
 *           supplementary tax invoice (debit note) is generated at the supplied
 *           rate (default 18% — HSN 3923 plastic articles), saved as a new
 *           `invoices` row with `invoice_type='supplementary'` and emailed to
 *           the consumer.
 *
 * The original invoice's `container_deposit_status` is the source of truth for
 * the admin "Container Deposits" page.
 */

const db = require('../database/db');
const fs = require('fs');
const { renderInvoicePdf } = require('./invoicePdf');
const { allocateInvoiceNumber } = require('./invoiceService');
const { sendInvoiceEmail } = require('./emailService');

const BUSINESS_STATE = process.env.BUSINESS_STATE || 'Karnataka';
const DEFAULT_FORFEIT_TAX_RATE = 18; // HSN 3923 — plastic articles

function refundDeposit(invoiceId, { adminId, notes }) {
  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.invoice_type !== 'tax') throw new Error('Can only resolve deposits on original tax invoices');
  if (inv.container_deposit_status !== 'held') {
    throw new Error(`Deposit already ${inv.container_deposit_status} — cannot refund`);
  }
  if (inv.container_deposit <= 0) throw new Error('No deposit was charged on this invoice');

  db.prepare(`
    UPDATE invoices
       SET container_deposit_status='refunded',
           container_deposit_resolved_at=CURRENT_TIMESTAMP,
           container_deposit_resolved_by=?,
           container_deposit_notes=?
     WHERE id=?
  `).run(adminId || null, notes || null, invoiceId);

  return db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId);
}

async function forfeitDeposit(invoiceId, { adminId, taxRate, notes }) {
  const rate = Number(taxRate) > 0 ? Number(taxRate) : DEFAULT_FORFEIT_TAX_RATE;

  const inv = db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId);
  if (!inv) throw new Error('Invoice not found');
  if (inv.invoice_type !== 'tax') throw new Error('Can only resolve deposits on original tax invoices');
  if (inv.container_deposit_status !== 'held') {
    throw new Error(`Deposit already ${inv.container_deposit_status} — cannot forfeit`);
  }
  if (inv.container_deposit <= 0) throw new Error('No deposit was charged on this invoice');

  /* The forfeited deposit becomes a tax-inclusive consideration on today's
   * date. Compute taxable / GST split using the original deposit as gross. */
  const gross   = inv.container_deposit;
  const taxable = +(gross / (1 + rate / 100)).toFixed(2);
  const tax     = +(gross - taxable).toFixed(2);

  const isIntraState = inv.customer_state && inv.customer_state === BUSINESS_STATE;
  const cgst = isIntraState ? +(tax / 2).toFixed(2) : 0;
  const sgst = isIntraState ? +(tax - cgst).toFixed(2) : 0;
  const igst = isIntraState ? 0 : tax;

  const supplementaryItems = [{
    name:           'Container deposit forfeited (non-returnable / damaged container)',
    hsn_code:       '3923',
    quantity:       1,
    unit_price:     gross,
    tax_rate:       rate,
    taxable_amount: taxable,
    tax_amount:     tax,
  }];

  const order = db.prepare(`SELECT order_number FROM consumer_orders WHERE id=?`).get(inv.order_id);
  const supplementaryNumber = allocateInvoiceNumber();

  const insert = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id,
      customer_name, customer_email, customer_phone, customer_address, customer_state, customer_gstin,
      items_json, taxable_amount, cgst_amount, sgst_amount, igst_amount, container_deposit, total_amount,
      razorpay_payment_id, parent_invoice_id, invoice_type, container_deposit_status
    ) VALUES (?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?, ?)
  `);
  const result = insert.run(
    supplementaryNumber, inv.order_id,
    inv.customer_name, inv.customer_email, inv.customer_phone,
    inv.customer_address, inv.customer_state, inv.customer_gstin,
    JSON.stringify(supplementaryItems),
    taxable, cgst, sgst, igst, 0, gross,
    null, invoiceId, 'supplementary', 'none'
  );
  const supplementaryId = result.lastInsertRowid;

  /* Mark the original deposit as forfeited */
  db.prepare(`
    UPDATE invoices
       SET container_deposit_status='forfeited',
           container_deposit_resolved_at=CURRENT_TIMESTAMP,
           container_deposit_resolved_by=?,
           container_deposit_notes=?
     WHERE id=?
  `).run(adminId || null, notes || null, invoiceId);

  /* Render the supplementary PDF */
  let pdfPath = null;
  try {
    pdfPath = await renderInvoicePdf({
      invoice_number:    supplementaryNumber,
      order_number:      order?.order_number,
      created_at:        new Date().toISOString(),
      customer_name:     inv.customer_name,
      customer_email:    inv.customer_email,
      customer_phone:    inv.customer_phone,
      customer_address:  inv.customer_address,
      customer_state:    inv.customer_state,
      customer_gstin:    inv.customer_gstin,
      items:             supplementaryItems,
      taxable_amount:    taxable,
      cgst_amount:       cgst,
      sgst_amount:       sgst,
      igst_amount:       igst,
      container_deposit: 0,
      total_amount:      gross,
      invoice_type:      'supplementary',
      parent_invoice_number: inv.invoice_number,
    });
    db.prepare(`UPDATE invoices SET pdf_path=? WHERE id=?`).run(pdfPath, supplementaryId);
  } catch (err) {
    console.error(`[deposit] supplementary PDF render failed for ${supplementaryNumber}:`, err.message);
  }

  /* Email the supplementary invoice */
  if (inv.customer_email && pdfPath) {
    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      await sendInvoiceEmail({
        to:             inv.customer_email,
        consumerName:   inv.customer_name,
        invoiceNumber:  supplementaryNumber,
        orderNumber:    order?.order_number,
        totalAmount:    gross,
        pdfBuffer,
        pdfFilename:    `${supplementaryNumber}.pdf`,
        supplementary:  true,
        parentInvoiceNumber: inv.invoice_number,
      });
    } catch (err) {
      console.error(`[deposit] supplementary email failed for ${supplementaryNumber}:`, err.message);
    }
  }

  console.log(`[deposit] forfeited deposit on ${inv.invoice_number} → supplementary ${supplementaryNumber}`);
  return {
    original:      db.prepare(`SELECT * FROM invoices WHERE id=?`).get(invoiceId),
    supplementary: db.prepare(`SELECT * FROM invoices WHERE id=?`).get(supplementaryId),
  };
}

module.exports = { refundDeposit, forfeitDeposit, DEFAULT_FORFEIT_TAX_RATE };
