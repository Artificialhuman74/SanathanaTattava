/**
 * Finance / Books endpoints for admin.
 *
 * Income sources:
 *   - consumer_orders (gross total_amount, status='delivered')
 *   - manual_income   (admin-logged misc income)
 *   - trader_payments (admin-logged first-distribution payments from traders)
 *
 * Expense sources:
 *   - inventory_transactions where type='restock' (cost_price × qty per trader/product)
 *   - commissions paid (status='paid' or 'pending', gross amount owed to traders)
 */

const express = require('express');
const db = require('../database/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

/* ── helpers ────────────────────────────────────────────────────────────── */

function monthBounds(month) {
  // month is YYYY-MM. Returns [startInclusive, endExclusive] as 'YYYY-MM-DD'
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next  = new Date(Date.UTC(y, m, 1));
  const endY  = next.getUTCFullYear();
  const endM  = String(next.getUTCMonth() + 1).padStart(2, '0');
  return [start, `${endY}-${endM}-01`];
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonth(req) {
  const m = req.query.month;
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return currentMonth();
  return m;
}

/* ── 1. Summary (one month) ─────────────────────────────────────────────── */
router.get('/summary', (req, res) => {
  const month = parseMonth(req);
  const [start, end] = monthBounds(month);

  const consumerIncome = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) AS s, COUNT(*) AS c
    FROM consumer_orders
    WHERE status = 'delivered' AND created_at >= ? AND created_at < ?
  `).get(start, end);

  const manualIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
    FROM manual_income WHERE recorded_date >= ? AND recorded_date < ?
  `).get(start, end);

  const traderPayments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
    FROM trader_payments WHERE payment_date >= ? AND payment_date < ?
  `).get(start, end);

  const restockExpense = db.prepare(`
    SELECT COALESCE(SUM(it.quantity * COALESCE(p.cost_price, 0)), 0) AS s
    FROM inventory_transactions it
    JOIN products p ON p.id = it.product_id
    WHERE it.type = 'restock' AND it.created_at >= ? AND it.created_at < ?
  `).get(start, end);

  const commissionExpense = db.prepare(`
    SELECT COALESCE(SUM(cm.amount), 0) AS s
    FROM commissions cm
    LEFT JOIN consumer_orders co ON co.id = cm.consumer_order_id
    WHERE cm.created_at >= ? AND cm.created_at < ?
      AND (co.id IS NULL OR co.status != 'cancelled')
  `).get(start, end);

  /* Container money trail — driven by container_finance_log so we can
   * separate income (forfeits retained, where company keeps the deposit)
   * from expense (cash that actually left the company: driver UPI
   * reimbursements, bank/UPI wire refunds, store-credit issuance). */
  const containerForfeitedIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
      FROM container_finance_log
     WHERE event_type='container_forfeited'
       AND created_at >= ? AND created_at < ?
  `).get(start, end);

  const driverReimbExpense = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
      FROM container_finance_log
     WHERE event_type='driver_reimbursed'
       AND created_at >= ? AND created_at < ?
  `).get(start, end);

  const manualRefundExpense = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
      FROM container_finance_log
     WHERE event_type='manual_refund_settled'
       AND created_at >= ? AND created_at < ?
  `).get(start, end);

  const storeCreditExpense = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
      FROM container_finance_log
     WHERE event_type='store_credit_issued'
       AND created_at >= ? AND created_at < ?
  `).get(start, end);

  const containerPayoutExpense = driverReimbExpense.s + manualRefundExpense.s + storeCreditExpense.s;

  const income  = consumerIncome.s + manualIncome.s + traderPayments.s + containerForfeitedIncome.s;
  const expense = restockExpense.s + commissionExpense.s + containerPayoutExpense;

  res.json({
    month,
    income: {
      total: income,
      consumer_orders:    { amount: consumerIncome.s,  count: consumerIncome.c },
      manual:             { amount: manualIncome.s,    count: manualIncome.c },
      trader_payments:    { amount: traderPayments.s,  count: traderPayments.c },
      container_forfeits: { amount: containerForfeitedIncome.s, count: containerForfeitedIncome.c },
    },
    expense: {
      total: expense,
      restock:           restockExpense.s,
      commission:        commissionExpense.s,
      container_payouts: {
        amount:             containerPayoutExpense,
        driver_reimbursed:  { amount: driverReimbExpense.s,    count: driverReimbExpense.c },
        manual_refunds:     { amount: manualRefundExpense.s,   count: manualRefundExpense.c },
        store_credit:       { amount: storeCreditExpense.s,    count: storeCreditExpense.c },
      },
    },
    net: income - expense,
  });
});

/* ── 2. Consumer Orders (one month) ─────────────────────────────────────── */
router.get('/consumer-orders', (req, res) => {
  const month = parseMonth(req);
  const [start, end] = monthBounds(month);

  const orders = db.prepare(`
    SELECT co.id, co.order_number, co.total_amount, co.subtotal,
           co.container_costs_total, co.discount_amount, co.status,
           co.payment_status, co.created_at,
           c.name AS consumer_name, c.phone AS consumer_phone,
           u.name AS linked_dealer_name
    FROM consumer_orders co
    JOIN consumers c   ON c.id = co.consumer_id
    LEFT JOIN users u  ON u.id = co.linked_dealer_id
    WHERE co.created_at >= ? AND co.created_at < ?
      AND co.status != 'cancelled'
    ORDER BY co.created_at DESC
  `).all(start, end);

  res.json({ month, orders });
});

/* ── 3. Trader-wise sales (one month) ───────────────────────────────────── */
router.get('/trader-sales', (req, res) => {
  const month = parseMonth(req);
  const [start, end] = monthBounds(month);

  const rows = db.prepare(`
    SELECT
      u.id   AS trader_id,
      u.name AS trader_name,
      u.tier AS trader_tier,
      COUNT(DISTINCT co.id) AS order_count,
      COALESCE(SUM(co.total_amount), 0) AS gross_sales,
      (
        SELECT COALESCE(SUM(c.amount), 0)
        FROM commissions c
        WHERE c.trader_id = u.id
          AND c.created_at >= ? AND c.created_at < ?
      ) AS commission_earned
    FROM users u
    LEFT JOIN consumer_orders co
      ON co.linked_dealer_id = u.id
      AND co.status = 'delivered'
      AND co.created_at >= ? AND co.created_at < ?
    WHERE u.role = 'trader'
    GROUP BY u.id
    HAVING order_count > 0 OR commission_earned > 0
    ORDER BY gross_sales DESC, commission_earned DESC
  `).all(start, end, start, end);

  res.json({ month, traders: rows });
});

/* ── 4. Monthly trend (last N months) ───────────────────────────────────── */
router.get('/monthly', (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.months, 10) || 12, 1), 36);
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const series = months.map(month => {
    const [start, end] = monthBounds(month);
    const consumer = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) AS s FROM consumer_orders
      WHERE status='delivered' AND created_at >= ? AND created_at < ?
    `).get(start, end).s;
    const manual = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s FROM manual_income
      WHERE recorded_date >= ? AND recorded_date < ?
    `).get(start, end).s;
    const traderPay = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s FROM trader_payments
      WHERE payment_date >= ? AND payment_date < ?
    `).get(start, end).s;
    const restock = db.prepare(`
      SELECT COALESCE(SUM(it.quantity * COALESCE(p.cost_price, 0)), 0) AS s
      FROM inventory_transactions it
      JOIN products p ON p.id = it.product_id
      WHERE it.type='restock' AND it.created_at >= ? AND it.created_at < ?
    `).get(start, end).s;
    const commission = db.prepare(`
      SELECT COALESCE(SUM(cm.amount), 0) AS s FROM commissions cm
      LEFT JOIN consumer_orders co ON co.id = cm.consumer_order_id
      WHERE cm.created_at >= ? AND cm.created_at < ?
        AND (co.id IS NULL OR co.status != 'cancelled')
    `).get(start, end).s;

    const containerIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s FROM container_finance_log
      WHERE event_type='container_forfeited' AND created_at >= ? AND created_at < ?
    `).get(start, end).s;
    const containerExpense = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s FROM container_finance_log
      WHERE event_type IN ('driver_reimbursed','manual_refund_settled','store_credit_issued')
        AND created_at >= ? AND created_at < ?
    `).get(start, end).s;

    const income  = consumer + manual + traderPay + containerIncome;
    const expense = restock + commission + containerExpense;
    return {
      month,
      income_consumer:        consumer,
      income_manual:          manual,
      income_trader_payment:  traderPay,
      income_container:       containerIncome,
      expense_restock:        restock,
      expense_commission:     commission,
      expense_container:      containerExpense,
      income, expense, net: income - expense,
    };
  });

  res.json({ series });
});

/* ── 5. Restock expense per trader / product (one month) ────────────────── */
router.get('/restock-expense', (req, res) => {
  const month = parseMonth(req);
  const [start, end] = monthBounds(month);

  const rows = db.prepare(`
    SELECT
      it.dealer_id            AS trader_id,
      u.name                  AS trader_name,
      u.tier                  AS trader_tier,
      it.product_id,
      p.name                  AS product_name,
      p.sku,
      p.unit,
      COALESCE(p.cost_price, 0) AS cost_price,
      SUM(it.quantity)        AS total_qty,
      SUM(it.quantity * COALESCE(p.cost_price, 0)) AS expense
    FROM inventory_transactions it
    JOIN users u    ON u.id = it.dealer_id
    JOIN products p ON p.id = it.product_id
    WHERE it.type = 'restock'
      AND it.created_at >= ? AND it.created_at < ?
    GROUP BY it.dealer_id, it.product_id
    ORDER BY expense DESC
  `).all(start, end);

  res.json({ month, rows });
});

/* ── 6. Manual income CRUD ──────────────────────────────────────────────── */
router.get('/manual-income', (req, res) => {
  const month = parseMonth(req);
  const [start, end] = monthBounds(month);
  const rows = db.prepare(`
    SELECT * FROM manual_income
    WHERE recorded_date >= ? AND recorded_date < ?
    ORDER BY recorded_date DESC, id DESC
  `).all(start, end);
  res.json({ month, entries: rows });
});

router.post('/manual-income', (req, res) => {
  const { source, description, amount, recorded_date } = req.body || {};
  if (!source || !String(source).trim()) return res.status(400).json({ error: 'Source is required' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be > 0' });
  if (!recorded_date || !/^\d{4}-\d{2}-\d{2}$/.test(recorded_date))
    return res.status(400).json({ error: 'recorded_date must be YYYY-MM-DD' });

  const r = db.prepare(`
    INSERT INTO manual_income (source, description, amount, recorded_date, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(source).trim(), description ? String(description).trim() : null, amt, recorded_date, req.user.id);

  const entry = db.prepare('SELECT * FROM manual_income WHERE id=?').get(r.lastInsertRowid);
  res.json({ entry });
});

router.delete('/manual-income/:id', (req, res) => {
  const r = db.prepare('DELETE FROM manual_income WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

/* ── 7. Trader payment CRUD (first-distribution income) ─────────────────── */
router.get('/trader-payments', (req, res) => {
  const month = parseMonth(req);
  const [start, end] = monthBounds(month);
  const rows = db.prepare(`
    SELECT tp.*, u.name AS trader_name, u.tier AS trader_tier
    FROM trader_payments tp
    JOIN users u ON u.id = tp.trader_id
    WHERE tp.payment_date >= ? AND tp.payment_date < ?
    ORDER BY tp.payment_date DESC, tp.id DESC
  `).all(start, end);
  res.json({ month, payments: rows });
});

router.post('/trader-payments', (req, res) => {
  const { trader_id, amount, payment_date, notes } = req.body || {};
  const tid = Number(trader_id);
  const amt = Number(amount);
  if (!Number.isInteger(tid) || tid <= 0) return res.status(400).json({ error: 'trader_id required' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be > 0' });
  if (!payment_date || !/^\d{4}-\d{2}-\d{2}$/.test(payment_date))
    return res.status(400).json({ error: 'payment_date must be YYYY-MM-DD' });

  const trader = db.prepare(`SELECT id FROM users WHERE id=? AND role='trader'`).get(tid);
  if (!trader) return res.status(404).json({ error: 'Trader not found' });

  const r = db.prepare(`
    INSERT INTO trader_payments (trader_id, amount, payment_date, notes, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(tid, amt, payment_date, notes ? String(notes).trim() : null, req.user.id);

  const payment = db.prepare(`
    SELECT tp.*, u.name AS trader_name, u.tier AS trader_tier
    FROM trader_payments tp JOIN users u ON u.id = tp.trader_id
    WHERE tp.id = ?
  `).get(r.lastInsertRowid);
  res.json({ payment });
});

router.delete('/trader-payments/:id', (req, res) => {
  const r = db.prepare('DELETE FROM trader_payments WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

/* ── Active traders (for the payment form dropdown) ─────────────────────── */
router.get('/traders', (_req, res) => {
  const traders = db.prepare(`
    SELECT id, name, tier, phone FROM users
    WHERE role='trader' AND status='active'
    ORDER BY name
  `).all();
  res.json({ traders });
});

module.exports = router;
