/**
 * Public, no-auth endpoints accessed via signed/random tokens.
 * Currently: sub-dealer commission payment confirmation.
 */
const express = require('express');
const db      = require('../database/db');

const router = express.Router();

const loadByToken = (token) => db.prepare(`
  SELECT cm.id, cm.amount, cm.rate, cm.type, cm.status, cm.payment_method,
         cm.paid_at_offline, cm.confirmation_expires_at, cm.payment_note,
         cm.confirmed_at, cm.disputed_at, cm.dispute_reason,
         sd.id   AS sub_dealer_id,   sd.name AS sub_dealer_name,
         sd.email AS sub_dealer_email,
         pp.id   AS parent_id,       pp.name AS parent_name, pp.email AS parent_email,
         co.order_number, co.total_amount AS order_amount
  FROM commissions cm
  JOIN users sd ON sd.id = cm.trader_id
  LEFT JOIN users pp ON pp.id = cm.paid_by_trader_id
  LEFT JOIN consumer_orders co ON co.id = cm.consumer_order_id
  WHERE cm.confirmation_token = ?
`).get(token);

router.get('/commission-confirmation/:token', (req, res) => {
  const c = loadByToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Invalid or unknown confirmation link' });

  const expired = c.confirmation_expires_at && new Date(c.confirmation_expires_at).getTime() < Date.now();
  res.json({
    commission: {
      id: c.id, amount: c.amount, rate: c.rate, type: c.type, status: c.status,
      payment_method: c.payment_method, paid_at_offline: c.paid_at_offline,
      payment_note: c.payment_note, confirmed_at: c.confirmed_at,
      disputed_at: c.disputed_at, dispute_reason: c.dispute_reason,
      order_number: c.order_number, order_amount: c.order_amount,
    },
    sub_dealer:  { id: c.sub_dealer_id, name: c.sub_dealer_name, email: c.sub_dealer_email },
    parent:      { id: c.parent_id,     name: c.parent_name,     email: c.parent_email },
    expired,
  });
});

router.post('/commission-confirmation/:token/confirm', (req, res) => {
  const c = loadByToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Invalid link' });
  if (c.status !== 'awaiting_confirmation')
    return res.status(400).json({ error: `Commission status is ${c.status}, cannot confirm` });
  if (c.confirmation_expires_at && new Date(c.confirmation_expires_at).getTime() < Date.now())
    return res.status(400).json({ error: 'Confirmation link expired' });

  db.prepare(`
    UPDATE commissions
    SET status='paid', confirmed_at=CURRENT_TIMESTAMP, paid_at=CURRENT_TIMESTAMP,
        confirmation_token=NULL
    WHERE id=?
  `).run(c.id);

  /* Notify parent in-app */
  try {
    const { createNotification } = require('../services/notificationService');
    if (c.parent_id) {
      createNotification(
        'dealer', c.parent_id,
        `Commission confirmed by ${c.sub_dealer_name}`,
        `${c.sub_dealer_name} confirmed receipt of ₹${Number(c.amount).toFixed(2)}.`,
        { commission_id: c.id },
      );
    }
  } catch { /* non-fatal */ }

  res.json({ success: true });
});

router.post('/commission-confirmation/:token/dispute', async (req, res) => {
  const c = loadByToken(req.params.token);
  if (!c) return res.status(404).json({ error: 'Invalid link' });
  if (c.status !== 'awaiting_confirmation')
    return res.status(400).json({ error: `Commission status is ${c.status}, cannot dispute` });
  if (c.confirmation_expires_at && new Date(c.confirmation_expires_at).getTime() < Date.now())
    return res.status(400).json({ error: 'Confirmation link expired' });

  const reason = (req.body?.reason || '').toString().trim().slice(0, 1000) || null;

  db.prepare(`
    UPDATE commissions
    SET status='disputed', disputed_at=CURRENT_TIMESTAMP, dispute_reason=?,
        confirmation_token=NULL
    WHERE id=?
  `).run(reason, c.id);

  /* Notify parent + admin (in-app) */
  try {
    const { createNotification } = require('../services/notificationService');
    if (c.parent_id) {
      createNotification(
        'dealer', c.parent_id,
        `⚠️ ${c.sub_dealer_name} disputed your payment`,
        `${c.sub_dealer_name} did NOT receive the ₹${Number(c.amount).toFixed(2)} you marked as paid.`,
        { commission_id: c.id, disputed: true },
      );
    }
    const admins = db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active'`).all();
    for (const a of admins) {
      createNotification(
        'admin', a.id,
        `Commission payment disputed — ₹${Number(c.amount).toFixed(2)}`,
        `${c.sub_dealer_name} disputed a payment marked as paid by ${c.parent_name || 'parent'}.`,
        { commission_id: c.id, disputed: true },
      );
    }
  } catch { /* non-fatal */ }

  /* Email parent + admin */
  try {
    const { sendCommissionDisputeEmail } = require('../services/emailService');
    const payload = {
      subDealerName: c.sub_dealer_name,
      parentName:    c.parent_name || 'Parent dealer',
      amount:        c.amount,
      reason,
      orderNumber:   c.order_number,
    };
    if (c.parent_email) {
      try { await sendCommissionDisputeEmail(c.parent_email, { recipientName: c.parent_name, ...payload }); }
      catch (err) { console.error('[dispute] parent email failed:', err.message); }
    }
    const admins = db.prepare(`SELECT name, email FROM users WHERE role='admin' AND status='active' AND email IS NOT NULL`).all();
    for (const a of admins) {
      try { await sendCommissionDisputeEmail(a.email, { recipientName: a.name, ...payload }); }
      catch (err) { console.error('[dispute] admin email failed:', err.message); }
    }
  } catch (err) { console.error('[dispute] email block error:', err.message); }

  res.json({ success: true });
});

module.exports = router;
