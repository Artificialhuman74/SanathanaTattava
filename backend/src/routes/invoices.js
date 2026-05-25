/**
 * Invoice download endpoints.
 *
 * GET /api/invoice/:invoice_number — streams the saved PDF.
 * Falls back to regenerating from the DB row if the on-disk file is missing
 * (e.g. after a fresh deploy on a new volume).
 */

const express = require('express');
const fs      = require('fs');
const db      = require('../database/db');
const { renderInvoicePdf } = require('../services/invoicePdf');

const router = express.Router();

router.get('/:invoice_number', async (req, res) => {
  const num = req.params.invoice_number;
  const inv = db.prepare(`SELECT * FROM invoices WHERE invoice_number=?`).get(num);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  let pdfPath = inv.pdf_path;
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    try {
      const order = db.prepare(`SELECT order_number FROM consumer_orders WHERE id=?`).get(inv.order_id);
      pdfPath = await renderInvoicePdf({
        ...inv,
        order_number: order?.order_number,
        items:        JSON.parse(inv.items_json || '[]'),
      });
      db.prepare(`UPDATE invoices SET pdf_path=? WHERE id=?`).run(pdfPath, inv.id);
    } catch (err) {
      console.error(`[invoice] regenerate failed for ${num}:`, err.message);
      return res.status(500).json({ error: 'Failed to render invoice' });
    }
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${num}.pdf"`);
  fs.createReadStream(pdfPath).pipe(res);
});

module.exports = router;
