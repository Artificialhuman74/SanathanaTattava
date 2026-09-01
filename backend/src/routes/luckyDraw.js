/**
 * Lucky draw routes — consumer enrollment + trader/admin visibility.
 *
 * Deliberately one isolated file for the whole feature (see
 * LUCKY_DRAW_FEATURE_SPEC.md §10): consumer, trader, and admin endpoints
 * all live here rather than being scattered into consumer.js/trader.js/
 * admin.js, so removing the feature later means deleting this file (+ its
 * services/ folder, its migration block, and one mount line in index.js).
 *
 * Scope note: this pass is the "introduction" entry point for all three
 * roles (enroll, see who's enrolled, create a scheme). The monthly draw
 * job and the full admin control panel are a follow-up pass.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { authenticate, requireAdmin, requireTrader } = require('../middleware/auth');
const schemeService = require('../services/luckyDraw/schemeService');
const enrollmentService = require('../services/luckyDraw/enrollmentService');
const drawService = require('../services/luckyDraw/drawService');
const drawScheduler = require('../services/luckyDraw/drawScheduler');
const guaranteeService = require('../services/luckyDraw/guaranteeService');

const router = express.Router();

/* Same inline consumer-JWT pattern used by payments.js / notifications.js */
const authConsumer = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'consumer') return res.status(403).json({ error: 'Consumer access only' });
    const c = db.prepare('SELECT * FROM consumers WHERE id=? AND status=?').get(decoded.id, 'active');
    if (!c) return res.status(401).json({ error: 'Consumer not found' });
    req.consumer = c;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const handleServiceError = (err, res) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[lucky-draw]', err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
};

/* ── Consumer ─────────────────────────────────────────────────────────── */

/** Current status: open scheme(s) to join, or the consumer's own enrollment. */
router.get('/consumer/status', authConsumer, async (req, res) => {
  /* Before answering, finish any enrollment whose payment went through but
   * never got confirmed. This is the page a stuck consumer opens, so it is
   * the right place to notice their money was taken and act on it. */
  const stuck = enrollmentService.getActiveEnrollment(req.consumer.id);
  if (!stuck || stuck.status === 'pending_payment') {
    await enrollmentService.reconcilePendingEnrollment(req.consumer.id);
  }

  const active = enrollmentService.getActiveEnrollment(req.consumer.id);
  const openSchemes = active ? [] : schemeService.listOpenSchemes();
  const { day, time } = drawScheduler.getSchedule();
  res.json({
    active_enrollment: active || null,
    open_schemes: openSchemes,
    /* The rules a joiner reads have to match the day the draw actually runs,
     * which the admin can change. Sending it beats hard-coding "the 12th"
     * into the copy and quietly lying the first time it moves. */
    draw_schedule: { day, time },
    // Null until they're in a running scheme. The shop page reads this to
    // decide whether the draw takes over the front page this month.
    cycle: drawService.getConsumerCycle(req.consumer.id),
  });
});

/** Hand the reward container back and step out of the round. */
router.post('/consumer/leave', authConsumer, (req, res) => {
  try {
    res.json(drawService.leaveScheme(req.consumer.id));
  } catch (err) {
    handleServiceError(err, res);
  }
});

/** The winner's ₹0 order for this month (spec §3.12). */
router.post('/consumer/reward-order', authConsumer, (req, res) => {
  try {
    res.json(drawService.placeRewardOrder(req.consumer.id));
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get('/consumer/welcome-gifts', authConsumer, (_req, res) => {
  const products = enrollmentService.listWelcomeGiftProducts();
  res.json({ products, product: products[0] || null });
});

/** Visible to any logged-in consumer, not just winners — the "who won it" moment. */
router.get('/consumer/recent-winners', authConsumer, (_req, res) => {
  res.json({ winners: enrollmentService.listRecentWinners() });
});

router.post('/consumer/enroll', authConsumer, async (req, res) => {
  const { scheme_id, welcome_gift } = req.body;
  if (!scheme_id) return res.status(400).json({ error: 'scheme_id is required' });
  try {
    /* The gift is one fixed product now, so the body carries a yes/no rather
     * than a product id. An older client that still sends the id is saying
     * yes, and is treated that way. */
    const result = await enrollmentService.startEnrollment({
      consumerId: req.consumer.id,
      schemeId: scheme_id,
      wantsWelcomeGift: welcome_gift === undefined
        ? req.body.welcome_gift_product_id != null
        : welcome_gift !== false,
    });
    res.json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.post('/consumer/enroll/verify', authConsumer, (req, res) => {
  const { enrollment_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!enrollment_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const result = enrollmentService.verifyEnrollment({
      consumerId: req.consumer.id,
      enrollmentId: enrollment_id,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });
    res.json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

/* ── Trader ───────────────────────────────────────────────────────────── */

router.get('/trader/enrollments', authenticate, requireTrader, (req, res) => {
  res.json({ enrollments: enrollmentService.listEnrollmentsForDealer(req.user.id) });
});

/* ── Admin ────────────────────────────────────────────────────────────── */

/** The monthly draw schedule (spec §3.10 defaults: the 12th at 5PM IST). */
router.get('/admin/draw-schedule', authenticate, requireAdmin, (_req, res) => {
  res.json({ schedule: drawScheduler.getSchedule(), max_day: drawScheduler.MAX_DRAW_DAY });
});

router.put('/admin/draw-schedule', authenticate, requireAdmin, (req, res) => {
  try {
    const { enabled, day, time } = req.body;
    res.json({ schedule: drawScheduler.saveSchedule({ enabled, day, time }) });
  } catch (err) {
    handleServiceError(err, res);
  }
});

/** Manual scheme control (spec §9.2): start early, pause, resume, or end. */
router.post('/admin/schemes/:id/status', authenticate, requireAdmin, (req, res) => {
  try {
    const scheme = schemeService.setSchemeStatus(Number(req.params.id), req.body.action);
    res.json({ scheme });
  } catch (err) {
    handleServiceError(err, res);
  }
});

/** Send the 13th-month guarantee for a finished round, without waiting for
 *  the scheduler to notice it has ended (spec §3.14). */
router.post('/admin/schemes/:id/run-guarantee', authenticate, requireAdmin, (req, res) => {
  try {
    res.json(guaranteeService.runGuaranteeForScheme(Number(req.params.id)));
  } catch (err) {
    handleServiceError(err, res);
  }
});

/** Run every running scheme's draw now, without waiting for the schedule. */
router.post('/admin/run-draw-now', authenticate, requireAdmin, (_req, res) => {
  try {
    drawService.backfillCurrentMonthEntries();
    res.json(drawScheduler.runDueDraws());
  } catch (err) {
    handleServiceError(err, res);
  }
});


router.get('/admin/schemes', authenticate, requireAdmin, (_req, res) => {
  res.json({ schemes: schemeService.listSchemes() });
});

router.post('/admin/schemes', authenticate, requireAdmin, (req, res) => {
  const { name, joining_fee, enrollment_closes_at } = req.body;
  try {
    const scheme = schemeService.createScheme({
      name,
      joiningFee: joining_fee,
      enrollmentClosesAt: enrollment_closes_at,
      createdBy: req.user.id,
    });
    res.status(201).json({ scheme });
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get('/admin/enrollments', authenticate, requireAdmin, (_req, res) => {
  res.json({ enrollments: enrollmentService.listAllEnrollmentsByDealer() });
});

module.exports = router;
