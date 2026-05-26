/**
 * GST-compliant tax invoice PDF generator (pdfkit).
 *
 * Writes the rendered PDF to disk and returns its path. Layout mirrors the
 * minimum disclosures required for a B2C tax invoice under CGST Rules
 * (rule 46): supplier details + GSTIN, recipient details, invoice number
 * and date, HSN code, taxable value, CGST/SGST or IGST breakup, total.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/* Legal entity registered under the GSTIN (printed as the supplier).
 * BUSINESS_BRAND is the customer-facing trading name shown as a subtitle. */
const BUSINESS_NAME    = process.env.BUSINESS_NAME    || 'Gravity Traders';
const BUSINESS_BRAND   = process.env.BUSINESS_BRAND   || 'SanathanaTattva';
const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || '';
const BUSINESS_GSTIN   = process.env.BUSINESS_GSTIN   || '';
const BUSINESS_STATE   = process.env.BUSINESS_STATE   || 'Karnataka';
const BUSINESS_EMAIL   = process.env.BUSINESS_EMAIL   || '';
const BUSINESS_PHONE   = process.env.BUSINESS_PHONE   || '';

const INVOICE_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '../../../data'), 'invoices');

function ensureInvoiceDir() {
  if (!fs.existsSync(INVOICE_DIR)) fs.mkdirSync(INVOICE_DIR, { recursive: true });
}

function inr(n) {
  return `${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {object} inv  Invoice row + items array
 * @returns Promise<string>  path to the generated PDF
 */
function renderInvoicePdf(inv) {
  ensureInvoiceDir();
  const filePath = path.join(INVOICE_DIR, `${inv.invoice_number}.pdf`);

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    stream.on('finish', () => resolve(filePath));
    stream.on('error',  reject);

    /* ── Header ─────────────────────────────────────────────────────── */
    const isSupplementary = inv.invoice_type === 'supplementary';
    doc.fontSize(isSupplementary ? 15 : 18).font('Helvetica-Bold')
       .fillColor(isSupplementary ? '#b91c1c' : '#14532d')
       .text(isSupplementary ? 'SUPPLEMENTARY TAX INVOICE' : 'TAX INVOICE / RECEIPT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor('#475569')
       .text(isSupplementary
              ? `Issued against original invoice ${inv.parent_invoice_number || ''} — forfeited container deposit`
              : 'Original for Recipient',
            { align: 'center' });
    doc.moveDown(0.8);

    /* ── Supplier block ─────────────────────────────────────────────── */
    const topY = doc.y;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a').text(BUSINESS_NAME);
    if (BUSINESS_BRAND) {
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#64748b')
         .text(`(Brand: ${BUSINESS_BRAND})`);
    }
    doc.fontSize(9).font('Helvetica').fillColor('#334155');
    if (BUSINESS_ADDRESS) doc.text(BUSINESS_ADDRESS, { width: 280 });
    if (BUSINESS_GSTIN)   doc.text(`GSTIN: ${BUSINESS_GSTIN}`);
    if (BUSINESS_STATE)   doc.text(`State: ${BUSINESS_STATE}`);
    if (BUSINESS_EMAIL)   doc.text(`Email: ${BUSINESS_EMAIL}`);
    if (BUSINESS_PHONE)   doc.text(`Phone: ${BUSINESS_PHONE}`);

    /* Invoice meta — right column */
    const metaX = 340, metaW = 215;
    doc.fontSize(9).fillColor('#0f172a').font('Helvetica-Bold');
    doc.text('Invoice No.:', metaX, topY, { continued: true })
       .font('Helvetica').text(`  ${inv.invoice_number}`);
    doc.font('Helvetica-Bold').text('Date:', metaX, doc.y, { continued: true })
       .font('Helvetica').text(`  ${new Date(inv.created_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
    if (inv.razorpay_payment_id) {
      doc.font('Helvetica-Bold').text('Payment Ref:', metaX, doc.y, { continued: true })
         .font('Helvetica').fontSize(8).text(`  ${inv.razorpay_payment_id}`);
      doc.fontSize(9);
    }
    if (inv.order_number) {
      doc.font('Helvetica-Bold').text('Order:', metaX, doc.y, { continued: true })
         .font('Helvetica').text(`  ${inv.order_number}`);
    }

    doc.moveDown(1.5);
    doc.strokeColor('#cbd5e1').lineWidth(0.5)
       .moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.6);

    /* ── Recipient block ────────────────────────────────────────────── */
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a').text('Bill To:');
    doc.fontSize(10).font('Helvetica').fillColor('#334155').text(inv.customer_name || '');
    doc.fontSize(9);
    if (inv.customer_address) doc.text(inv.customer_address, { width: 515 });
    if (inv.customer_state)   doc.text(`State: ${inv.customer_state}`);
    if (inv.customer_email)   doc.text(`Email: ${inv.customer_email}`);
    if (inv.customer_phone)   doc.text(`Phone: ${inv.customer_phone}`);
    if (inv.customer_gstin)   doc.text(`GSTIN: ${inv.customer_gstin}`);

    doc.moveDown(1);

    /* ── Items table ────────────────────────────────────────────────── */
    const isIntraState = (inv.cgst_amount || 0) > 0;
    const cols = isIntraState
      ? [
          { label: '#',          x: 40,  w: 22,  align: 'left'  },
          { label: 'Description', x: 62, w: 175, align: 'left'  },
          { label: 'HSN',        x: 237, w: 50,  align: 'left'  },
          { label: 'Qty',        x: 287, w: 35,  align: 'right' },
          { label: 'Rate',       x: 322, w: 55,  align: 'right' },
          { label: 'Taxable',    x: 377, w: 60,  align: 'right' },
          { label: 'CGST',       x: 437, w: 55,  align: 'right' },
          { label: 'SGST',       x: 492, w: 63,  align: 'right' },
        ]
      : [
          { label: '#',          x: 40,  w: 22,  align: 'left'  },
          { label: 'Description', x: 62, w: 200, align: 'left'  },
          { label: 'HSN',        x: 262, w: 50,  align: 'left'  },
          { label: 'Qty',        x: 312, w: 35,  align: 'right' },
          { label: 'Rate',       x: 347, w: 60,  align: 'right' },
          { label: 'Taxable',    x: 407, w: 65,  align: 'right' },
          { label: 'IGST',       x: 472, w: 83,  align: 'right' },
        ];

    const drawRow = (vals, opts = {}) => {
      const y = doc.y;
      doc.fontSize(opts.bold ? 9 : 8.5).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
      cols.forEach((c, i) => {
        doc.fillColor(opts.bold ? '#0f172a' : '#334155')
           .text(String(vals[i] ?? ''), c.x, y, { width: c.w, align: c.align });
      });
      doc.y = y + (opts.bold ? 16 : 14);
    };

    /* Header strip */
    const hdrY = doc.y;
    doc.rect(40, hdrY - 2, 515, 18).fill('#f1f5f9');
    doc.y = hdrY + 2;
    drawRow(cols.map(c => c.label), { bold: true });
    doc.strokeColor('#cbd5e1').lineWidth(0.5)
       .moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.2);

    /* Body rows */
    const items = inv.items || [];
    items.forEach((it, idx) => {
      const taxable = it.taxable_amount ?? (it.unit_price * it.quantity / (1 + (it.tax_rate || 0) / 100));
      const tax     = it.tax_amount     ?? (it.unit_price * it.quantity - taxable);
      const row = isIntraState
        ? [ idx + 1, it.name, it.hsn_code || '-', it.quantity, inr(it.unit_price),
            inr(taxable), inr(tax / 2), inr(tax / 2) ]
        : [ idx + 1, it.name, it.hsn_code || '-', it.quantity, inr(it.unit_price),
            inr(taxable), inr(tax) ];
      drawRow(row);
    });

    doc.strokeColor('#cbd5e1').lineWidth(0.5)
       .moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.6);

    /* ── Totals block (right-aligned) ───────────────────────────────── */
    const totX = 360, totW = 195;
    const totalLine = (label, value, opts = {}) => {
      const y = doc.y;
      doc.fontSize(opts.bold ? 11 : 9.5).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
         .fillColor(opts.bold ? '#0f172a' : '#475569');
      doc.text(label, totX, y, { width: 110, align: 'left' });
      doc.text(value, totX + 110, y, { width: 85, align: 'right' });
      doc.y = y + (opts.bold ? 18 : 14);
    };

    totalLine('Taxable Amount', `Rs. ${inr(inv.taxable_amount)}`);
    if (isIntraState) {
      totalLine('CGST', `Rs. ${inr(inv.cgst_amount)}`);
      totalLine('SGST', `Rs. ${inr(inv.sgst_amount)}`);
    } else {
      totalLine('IGST', `Rs. ${inr(inv.igst_amount)}`);
    }
    if (inv.container_deposit > 0) {
      totalLine('Refundable Container Deposit', `Rs. ${inr(inv.container_deposit)}`);
    }
    doc.strokeColor('#cbd5e1').lineWidth(0.5)
       .moveTo(totX, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.3);
    totalLine('Total', `Rs. ${inr(inv.total_amount)}`, { bold: true });

    if (inv.container_deposit > 0) {
      doc.moveDown(0.4);
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#64748b')
         .text('Note: The container deposit is a refundable security deposit and is not subject to GST. It will be refunded in full when the container is returned undamaged.',
               40, doc.y, { width: 515, align: 'left' });
    }

    /* ── Bottom block: PAYMENT RECEIVED stamp + thank-you, pinned near footer.
     * We jump to a fixed Y so the stamp always sits just above the footer line,
     * regardless of how short the invoice body is. Math.max ensures we still
     * flow normally if a very long item list has already pushed past that point. */
    const bottomBlockY = Math.max(doc.y + 16, 680);
    doc.y = bottomBlockY;

    /* Payment received stamp */
    const stampY = doc.y;
    doc.rect(40, stampY, 515, 36).fill('#f0fdf4').stroke('#16a34a');
    doc.fillColor('#15803d').fontSize(13).font('Helvetica-Bold')
       .text('PAYMENT RECEIVED', 40, stampY + 6, { align: 'center', width: 515 });
    doc.fontSize(9).font('Helvetica').fillColor('#166534')
       .text(isSupplementary
              ? 'The forfeited deposit (already paid earlier) is recognised here as taxable consideration. No new payment is due.'
              : 'This invoice is a receipt for an already-paid order. No payment is due.',
            40, stampY + 22, { align: 'center', width: 515 });
    doc.y = stampY + 44;

    /* Thank-you note (only on original tax invoice) */
    if (!isSupplementary) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#14532d')
         .text(`Thank you for choosing ${BUSINESS_BRAND || BUSINESS_NAME}!`, 40, doc.y, { align: 'center', width: 515 });
      doc.moveDown(0.3);
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#475569')
         .text('We are grateful for your trust in our pure, cold-pressed oils and look forward to serving you again.', 40, doc.y, { align: 'center', width: 515 });
    }

    /* ── Footer ─────────────────────────────────────────────────────── */
    doc.fontSize(8).fillColor('#94a3b8').font('Helvetica')
       .text('This is a computer-generated invoice. Signature not required.', 40, 790, { align: 'center', width: 515 });

    doc.end();
  });
}

module.exports = { renderInvoicePdf, INVOICE_DIR };
