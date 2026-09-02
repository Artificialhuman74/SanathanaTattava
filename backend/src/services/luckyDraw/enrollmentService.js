/**
 * Lucky draw — consumer enrollment (join a scheme, pick a 200ml welcome
 * gift, pay the joining fee via Razorpay, get the gift routed to your
 * dealer for delivery).
 *
 * Isolated on purpose (see schemeService.js header) — touches
 * consumer_orders only through a single insert, doesn't reach into
 * checkout.js/consumer.js logic.
 *
 * Scope note: the monthly qualifying-purchase draw itself is NOT built in
 * this pass (see LUCKY_DRAW_FEATURE_SPEC.md §9) — this file only covers
 * enrollment, which is the "introduction" entry point for consumers.
 */
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../../database/db');
const { createNotification } = require('../notificationService');
const { generateInvoiceForOrder } = require('../invoiceService');
const { LUCKY_DRAW_NAME } = require('../../config/luckyDraw');

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

/* Local-dev-only shortcut: skip the real Razorpay checkout and treat the
 * joining fee as paid the moment "Join" is clicked. Only ever set in a
 * developer's local .env — never in the testing or production Railway
 * environments, both of which should exercise the real (test-mode, in
 * testing's case) Razorpay flow. */
const DEV_MOCK_PAYMENTS = process.env.DEV_MOCK_PAYMENTS === 'true';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * The one enrollment (if any) currently occupying this consumer's single slot.
 *
 * 'pending_payment' is a slot-holder only while the round it points at can
 * still be joined. Nothing expires those rows, so someone who opened the
 * Razorpay sheet once and closed it was left holding a slot for ever: they
 * could never join anything again, and because the status endpoint stops
 * offering open schemes to anyone with a slot, the page told them
 * "Bhagya Chakra isn't running right now" — with money still in their pocket
 * and a round open in front of them. An unpaid intent is not an enrollment.
 */
function getActiveEnrollment(consumerId) {
  return db.prepare(`
    SELECT e.*, s.name AS scheme_name, s.status AS scheme_status, p.name AS reward_product_name
      FROM lucky_draw_enrollments e
      JOIN lucky_draw_schemes s ON s.id = e.scheme_id
      LEFT JOIN products p ON p.id = e.reward_product_id
     WHERE e.consumer_id = ?
       AND (
         e.status IN ('active','won')
         OR (e.status = 'pending_payment'
             AND s.status = 'enrollment_open'
             AND (s.enrollment_closes_at IS NULL
                  OR datetime(s.enrollment_closes_at) > datetime('now')))
       )
     ORDER BY CASE e.status WHEN 'pending_payment' THEN 1 ELSE 0 END, e.created_at DESC
     LIMIT 1
  `).get(consumerId);
}

/**
 * The welcome gift is one fixed product, not a choice of many: groundnut oil
 * 200ml, seeded by the migration and never sold in the shop. The only
 * decision left to the consumer is whether they want it at all.
 *
 * Stock is deliberately not consulted anywhere in this file. A 200ml pour
 * comes out of what the trader already has, and the platform has never
 * carried a 200ml SKU with a real count on it. Gating a paid enrolment on
 * that number would refuse money over an inventory figure nobody keeps.
 */
const WELCOME_GIFT_SKU = 'ST-BC-GIFT-GN-200';

function welcomeGiftProduct() {
  return db.prepare(`
    SELECT id, name, description, price, image_url, unit
      FROM products WHERE sku = ?
  `).get(WELCOME_GIFT_SKU) || null;
}

/** Kept as a list for the existing endpoint; it is one product or none. */
function listWelcomeGiftProducts() {
  const gift = welcomeGiftProduct();
  return gift ? [gift] : [];
}

function resolveDeliveryAddress(consumerId) {
  const saved = db.prepare(`
    SELECT name, phone, address, pincode, latitude, longitude, h3_index
      FROM consumer_addresses
     WHERE consumer_id = ?
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1
  `).get(consumerId);
  if (saved) return saved;

  const consumer = db.prepare(`SELECT name, phone, address, pincode FROM consumers WHERE id = ?`).get(consumerId);
  if (consumer?.address && consumer?.pincode) return { ...consumer, latitude: null, longitude: null, h3_index: null };
  return null;
}

/**
 * Step 1 of enrolling: pick a scheme + welcome gift, get a Razorpay order
 * for the joining fee back. Nothing is committed as "active" until
 * verifyEnrollment() confirms payment — unless DEV_MOCK_PAYMENTS is on, in
 * which case this finalizes the enrollment immediately and there is no
 * step 2 for the frontend to run.
 */
function startEnrollment({ consumerId, schemeId, wantsWelcomeGift = true }) {
  const scheme = db.prepare(`SELECT * FROM lucky_draw_schemes WHERE id = ?`).get(schemeId);
  if (!scheme) throw httpError(404, 'Scheme not found');
  if (scheme.status !== 'enrollment_open') throw httpError(400, `${LUCKY_DRAW_NAME} isn't open for enrollment right now`);
  if (scheme.enrollment_closes_at && new Date(scheme.enrollment_closes_at) <= new Date()) {
    throw httpError(400, 'Enrollment for this round has closed');
  }

  const existing = getActiveEnrollment(consumerId);
  if (existing && existing.scheme_id !== schemeId) {
    throw httpError(409, `You're already in ${existing.scheme_name} — you can join a new round once that one ends`);
  }

  /* Declining is a real answer, not a failure to choose: someone who does not
   * want a trial bottle should still be able to join. */
  const gift = wantsWelcomeGift ? welcomeGiftProduct() : null;
  if (wantsWelcomeGift && !gift) throw httpError(503, 'The welcome gift is unavailable right now');

  if (!resolveDeliveryAddress(consumerId)) {
    throw httpError(400, 'Add a delivery address to your account before joining');
  }

  /* A round runs for twelve months of deliveries: the welcome gift, then a
   * winner's monthly reward or the 13th-month guarantee at the end. Every one
   * of those is routed to the consumer's linked trader. Without one there is
   * nobody to pack any of it, and the fallback to admin is a safety net for
   * the occasional order, not a way to run someone's whole round.
   *
   * The dev tools' force-enroll writes the row directly and so is not subject
   * to this, which is deliberate: testing must not need a real referral. */
  const linked = db.prepare(`SELECT linked_dealer_id FROM consumers WHERE id = ?`).get(consumerId);
  if (!linked || linked.linked_dealer_id == null) {
    throw httpError(400,
      'You need a trader linked to your account before joining. Enter your dealer\u2019s referral code at checkout on your next order, and you can join straight after.');
  }

  if (!DEV_MOCK_PAYMENTS && !razorpay) throw httpError(503, 'Payment gateway not configured');

  // Reuse the same pending_payment row on a retry instead of hitting the
  // UNIQUE(consumer_id, scheme_id) constraint.
  let enrollment = existing && existing.scheme_id === schemeId
    ? existing
    : db.prepare(`SELECT * FROM lucky_draw_enrollments WHERE consumer_id = ? AND scheme_id = ?`).get(consumerId, schemeId);

  if (enrollment && enrollment.status !== 'pending_payment') {
    /* 'withdrawn' is not 'enrolled', and telling someone who left that they
     * are already in it is both wrong and unhelpful. They cannot rejoin the
     * same round, because their months and their container went back when
     * they left, so say that instead. */
    throw httpError(409, enrollment.status === 'withdrawn'
      ? `You left ${scheme.name}, so this round is closed to you. You can join the next one when it opens.`
      : `You're already enrolled in ${scheme.name}`);
  }

  if (!enrollment) {
    const r = db.prepare(`
      INSERT INTO lucky_draw_enrollments (scheme_id, consumer_id, status, welcome_gift_product_id)
      VALUES (?, ?, 'pending_payment', ?)
    `).run(schemeId, consumerId, gift ? gift.id : null);
    enrollment = db.prepare(`SELECT * FROM lucky_draw_enrollments WHERE id = ?`).get(r.lastInsertRowid);
  } else if (enrollment.welcome_gift_product_id !== (gift ? gift.id : null)) {
    // They changed their mind on the retry: take the answer they gave last.
    db.prepare(`UPDATE lucky_draw_enrollments SET welcome_gift_product_id = ? WHERE id = ?`)
      .run(gift ? gift.id : null, enrollment.id);
  }

  if (DEV_MOCK_PAYMENTS) {
    const result = finalizeEnrollment({ enrollment, scheme, consumerId, paymentId: 'DEV_MOCK_PAYMENT' });
    return Promise.resolve({ mocked: true, ...result });
  }

  return razorpay.orders.create({
    amount:   Math.round(scheme.joining_fee * 100),
    currency: 'INR',
    receipt:  `bhagyachakra_${enrollment.id}`,
  }).then(rzpOrder => {
    db.prepare(`UPDATE lucky_draw_enrollments SET razorpay_order_id = ? WHERE id = ?`).run(rzpOrder.id, enrollment.id);
    return {
      enrollment_id: enrollment.id,
      razorpay_order_id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  });
}

/**
 * Shared by the real Razorpay path (verifyEnrollment) and the dev-mock
 * path (startEnrollment, when DEV_MOCK_PAYMENTS is on): marks the
 * enrollment active and places the ₹0 welcome-gift order routed to the
 * consumer's linked dealer (falls back to admin, same as a direct order
 * with no referring dealer — this skips the full H3 nearest-dealer search
 * on purpose, a small trial-size gift doesn't need it).
 */
function finalizeEnrollment({ enrollment, scheme, consumerId, paymentId }) {
  const consumer = db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(consumerId);
  const gift = enrollment.welcome_gift_product_id
    ? db.prepare(`SELECT * FROM products WHERE id = ?`).get(enrollment.welcome_gift_product_id)
    : null;
  const addr = resolveDeliveryAddress(consumerId);
  if (!addr) throw httpError(400, 'Add a delivery address to your account before joining');

  /* They turned the gift down. The money still bought them a place in the
   * round, so the enrolment goes active with no order attached and the
   * trader is told a name has joined under them rather than told to pack. */
  if (!gift) {
    db.prepare(`
      UPDATE lucky_draw_enrollments
         SET status='active', joining_fee_paid=?, razorpay_payment_id=?, enrolled_at=CURRENT_TIMESTAMP
       WHERE id=?
    `).run(scheme.joining_fee, paymentId, enrollment.id);

    const dealerId = consumer.linked_dealer_id ?? null;
    if (dealerId) {
      try {
        createNotification(
          'dealer', dealerId,
          `${consumer.name} joined ${scheme.name}`,
          `${consumer.name} is in ${LUCKY_DRAW_NAME} under you. They turned down the welcome gift, so there is nothing to pack today. Every free delivery they earn from here on comes to you.`,
          { scheme_id: scheme.id },
        );
      } catch { /* non-fatal */ }
    }
    return { success: true, order_number: null, scheme_name: scheme.name, welcome_gift: null };
  }

  const linkedDealerId = consumer.linked_dealer_id ?? null;
  const isDirect = linkedDealerId === null ? 1 : 0;
  let deliveryDealerId = linkedDealerId;
  let assignmentStatus = linkedDealerId ? 'assigned' : 'unassigned';
  if (!deliveryDealerId) {
    const admin = db.prepare(`SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1`).get();
    if (admin) { deliveryDealerId = admin.id; assignmentStatus = 'admin'; }
  }

  const orderNumber = `BCGIFT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const result = db.transaction(() => {
    const or = db.prepare(`
      INSERT INTO consumer_orders
        (order_number, consumer_id, linked_dealer_id, delivery_dealer_id, is_direct, status, payment_status,
         subtotal, total_amount, pincode, delivery_address, notes, confirmation_sent,
         delivery_latitude, delivery_longitude, delivery_h3_index, assignment_status)
      VALUES (?,?,?,?,?, 'pending', 'paid', 0, 0, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      orderNumber, consumerId, linkedDealerId, deliveryDealerId, isDirect,
      addr.pincode, addr.address, `${LUCKY_DRAW_NAME} welcome gift`,
      addr.latitude || null, addr.longitude || null, addr.h3_index || null, assignmentStatus,
    );
    db.prepare(`
      INSERT INTO consumer_order_items (order_id, product_id, quantity, price, total, container_cost, is_refill)
      VALUES (?, ?, 1, 0, 0, 0, 0)
    `).run(or.lastInsertRowid, gift.id);
    /* No stock movement. The 200ml gift is not a stocked SKU: the trader
     * pours it from what they hold, so there is no number here to decrement
     * and nothing to be short of. */

    db.prepare(`
      UPDATE lucky_draw_enrollments
         SET status='active', joining_fee_paid=?, razorpay_payment_id=?, enrolled_at=CURRENT_TIMESTAMP,
             welcome_gift_order_id=?
       WHERE id=?
    `).run(scheme.joining_fee, paymentId, or.lastInsertRowid, enrollment.id);

    return { orderId: or.lastInsertRowid, orderNumber };
  })();

  if (deliveryDealerId) {
    try {
      createNotification(
        'dealer', deliveryDealerId,
        `${LUCKY_DRAW_NAME} welcome gift to pack — ${consumer.name}`,
        `${consumer.name} joined ${scheme.name}. Their welcome gift is one ${gift.name} — pour it from your own stock and deliver, no charge.`,
        { order_id: result.orderId, order_number: result.orderNumber, scheme_id: scheme.id },
      );
    } catch { /* non-fatal */ }
  }

  /* The welcome gift is a free order too, and until now it was the one that
   * left with no receipt at all. Same treatment as the reward and the
   * guarantee: raise the ₹0 invoice, never let it break the enrollment. */
  generateInvoiceForOrder(result.orderId)
    .catch(err => console.error(`[lucky-draw] welcome-gift invoice for ${result.orderNumber} failed:`, err.message));

  return { success: true, order_number: result.orderNumber, scheme_name: scheme.name, welcome_gift: gift.name };
}

/**
 * Step 2 (real Razorpay path only): verify the payment signature, then
 * hand off to finalizeEnrollment. Not called at all when DEV_MOCK_PAYMENTS
 * short-circuited everything in startEnrollment.
 */
function verifyEnrollment({ consumerId, enrollmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  if (expected !== razorpaySignature) throw httpError(400, 'Payment verification failed');

  const enrollment = db.prepare(`SELECT * FROM lucky_draw_enrollments WHERE id = ? AND consumer_id = ?`).get(enrollmentId, consumerId);
  if (!enrollment) throw httpError(404, 'Enrollment not found');
  if (enrollment.status !== 'pending_payment') return { alreadyProcessed: true, enrollment };
  if (enrollment.razorpay_order_id !== razorpayOrderId) throw httpError(400, 'Order mismatch');

  const scheme = db.prepare(`SELECT * FROM lucky_draw_schemes WHERE id = ?`).get(enrollment.scheme_id);
  return finalizeEnrollment({ enrollment, scheme, consumerId, paymentId: razorpayPaymentId });
}

/**
 * Rescue an enrollment whose payment went through but never got confirmed.
 *
 * Activation depends on the browser calling /enroll/verify after Razorpay's
 * checkout closes. If that call never happens — the tab is closed, the network
 * drops, the callback throws — the money is taken and the enrollment sits in
 * 'pending_payment' for ever. There was no webhook path and no reconciliation,
 * so nothing ever noticed.
 *
 * This asks Razorpay directly what happened to the order and finishes the job
 * if it was paid. Cheap: it only runs when a pending_payment enrollment
 * actually exists, and it is called from the status endpoint the consumer's
 * own page already hits, so the fix reaches them the next time they look.
 *
 * Never throws. A reconciliation failure must not take down the page it is
 * attached to.
 */
async function reconcilePendingEnrollment(consumerId) {
  try {
    const pending = db.prepare(`
      SELECT * FROM lucky_draw_enrollments
       WHERE consumer_id = ? AND status = 'pending_payment' AND razorpay_order_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1
    `).get(consumerId);
    if (!pending || !razorpay) return null;

    const order = await razorpay.orders.fetch(pending.razorpay_order_id);
    if (!order || order.status !== 'paid') return null;

    // Razorpay says it was paid, so take the payment id from the order's own
    // payment list rather than trusting anything the client sent.
    const payments = await razorpay.orders.fetchPayments(pending.razorpay_order_id);
    const captured = (payments?.items || []).find(p => p.status === 'captured');
    if (!captured) return null;

    const scheme = db.prepare(`SELECT * FROM lucky_draw_schemes WHERE id = ?`).get(pending.scheme_id);
    const result = finalizeEnrollment({
      enrollment: pending, scheme, consumerId, paymentId: captured.id,
    });
    console.log(`[lucky-draw] recovered a paid-but-unconfirmed enrollment for consumer ${consumerId} (${pending.razorpay_order_id})`);
    return result;
  } catch (err) {
    console.error(`[lucky-draw] enrollment reconciliation failed for consumer ${consumerId}:`, err.message);
    return null;
  }
}

/**
 * Trader/admin visibility (spec §8/§9 — introduction pass only, the fully
 * "visualized" grid promised there is a follow-up; this returns real data
 * in a plain shape a simple list can render honestly today).
 */
function listEnrollmentsForDealer(dealerId) {
  const rows = db.prepare(`
    SELECT e.id, e.status, e.enrolled_at, e.won_at_month,
           c.id AS consumer_id, c.name AS consumer_name,
           /* The delivery address lives in consumer_addresses, not on the
            * consumer row: c.address is null for everyone who added theirs
            * through the address book, which is everyone. Take the default
            * one, and prefer its phone since that is the number the agent
            * actually calls. */
           COALESCE(
             (SELECT ca.phone FROM consumer_addresses ca
               WHERE ca.consumer_id = c.id ORDER BY ca.is_default DESC, ca.created_at ASC LIMIT 1),
             c.phone
           ) AS consumer_phone,
           c.email AS consumer_email,
           COALESCE(
             (SELECT ca.address FROM consumer_addresses ca
               WHERE ca.consumer_id = c.id ORDER BY ca.is_default DESC, ca.created_at ASC LIMIT 1),
             c.address
           ) AS consumer_address,
           COALESCE(
             (SELECT ca.pincode FROM consumer_addresses ca
               WHERE ca.consumer_id = c.id ORDER BY ca.is_default DESC, ca.created_at ASC LIMIT 1),
             c.pincode
           ) AS consumer_pincode,
           s.id AS scheme_id, s.name AS scheme_name,
           g.name AS welcome_gift_name,
           -- The trader sees the same tree the admin does, pruned to their own
           -- branch, so the rows carry the same dealer columns.
           d.id AS dealer_id, d.name AS dealer_name, d.phone AS dealer_phone,
           (SELECT COUNT(*) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.qualified = 1) AS qualified_months,
           (SELECT COUNT(*) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.draw_run_at IS NOT NULL) AS months_drawn,
           (SELECT MAX(me.month_number) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.qualified = 1 AND me.draw_run_at IS NULL) AS pending_qualified_month
      FROM lucky_draw_enrollments e
      JOIN consumers c ON c.id = e.consumer_id
      JOIN lucky_draw_schemes s ON s.id = e.scheme_id
      LEFT JOIN products g ON g.id = e.welcome_gift_product_id
      LEFT JOIN users d ON d.id = c.linked_dealer_id
     WHERE c.linked_dealer_id = ? AND e.status IN ('active','won')
     ORDER BY e.enrolled_at DESC
  `).all(dealerId);
  return withEligibility(rows);
}

/** Same shape as listEnrollmentsForDealer, but every dealer at once (admin). */
function listAllEnrollmentsByDealer() {
  const rows = db.prepare(`
    SELECT e.id, e.status, e.enrolled_at, e.won_at_month,
           c.id AS consumer_id, c.name AS consumer_name,
           -- The tree's detail panel shows who this actually is; without the
           -- contact details a node is just a name with no way to act on it.
           /* The delivery address lives in consumer_addresses, not on the
            * consumer row: c.address is null for everyone who added theirs
            * through the address book, which is everyone. Take the default
            * one, and prefer its phone since that is the number the agent
            * actually calls. */
           COALESCE(
             (SELECT ca.phone FROM consumer_addresses ca
               WHERE ca.consumer_id = c.id ORDER BY ca.is_default DESC, ca.created_at ASC LIMIT 1),
             c.phone
           ) AS consumer_phone,
           c.email AS consumer_email,
           COALESCE(
             (SELECT ca.address FROM consumer_addresses ca
               WHERE ca.consumer_id = c.id ORDER BY ca.is_default DESC, ca.created_at ASC LIMIT 1),
             c.address
           ) AS consumer_address,
           COALESCE(
             (SELECT ca.pincode FROM consumer_addresses ca
               WHERE ca.consumer_id = c.id ORDER BY ca.is_default DESC, ca.created_at ASC LIMIT 1),
             c.pincode
           ) AS consumer_pincode,
           s.id AS scheme_id, s.name AS scheme_name,
           g.name AS welcome_gift_name,
           d.id AS dealer_id, d.name AS dealer_name, d.phone AS dealer_phone,
           (SELECT COUNT(*) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.qualified = 1) AS qualified_months,
           (SELECT COUNT(*) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.draw_run_at IS NOT NULL) AS months_drawn,
           (SELECT MAX(me.month_number) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.qualified = 1 AND me.draw_run_at IS NULL) AS pending_qualified_month
      FROM lucky_draw_enrollments e
      JOIN consumers c ON c.id = e.consumer_id
      JOIN lucky_draw_schemes s ON s.id = e.scheme_id
      LEFT JOIN products g ON g.id = e.welcome_gift_product_id
      LEFT JOIN users d ON d.id = c.linked_dealer_id
     WHERE e.status IN ('active','won')
     ORDER BY d.name IS NULL, d.name, e.enrolled_at DESC
  `).all();
  return withEligibility(rows);
}

/**
 * Add the this-month view §8.2 and §9.1 both want: is this consumer in the
 * current draw, and how far through the round are they.
 *
 * `pending_qualified_month` is the highest month they have qualified for that
 * has NOT yet been drawn, which is exactly "entered, waiting for the draw".
 */
function withEligibility(rows, totalMonths = 12) {
  return rows.map(r => ({
    ...r,
    total_months: totalMonths,
    entered_this_month: r.status === 'active' && r.pending_qualified_month != null,
    // 'won' outranks everything: they are out of the pool and receiving.
    standing: r.status === 'won' ? 'winning'
      : r.status === 'completed' ? 'completed'
      : r.pending_qualified_month != null ? 'entered'
      : 'not_entered',
  }));
}

/** "First L." — never expose a winner's full name to the whole consumer base. */
function privacyName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || 'A consumer';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * Public-facing (to any logged-in consumer, not just the winner) recent
 * winners feed — the "who won it" moment for everyone else. Privacy-safe:
 * first name + last initial, no email/phone/exact address.
 */
function listRecentWinners(limit = 8) {
  /* Ordered by when they actually WON, which is the draw that stamped their
   * winning entry. It used to order by enrollment id — i.e. by who signed up
   * most recently — so "recent winners" listed a stranger who joined last
   * week above the person who won yesterday, and the order never changed
   * again no matter who won next. */
  const rows = db.prepare(`
    SELECT e.id, c.name AS consumer_name, s.name AS scheme_name, p.name AS reward_product_name,
           (SELECT MAX(me.draw_run_at) FROM lucky_draw_monthly_entries me
             WHERE me.enrollment_id = e.id AND me.is_winner = 1) AS won_at
      FROM lucky_draw_enrollments e
      JOIN consumers c ON c.id = e.consumer_id
      JOIN lucky_draw_schemes s ON s.id = e.scheme_id
      LEFT JOIN products p ON p.id = e.reward_product_id
     WHERE e.status = 'won'
     ORDER BY won_at IS NULL, won_at DESC, e.id DESC
     LIMIT ?
  `).all(limit);
  return rows.map(r => ({
    id: r.id,
    display_name: privacyName(r.consumer_name),
    scheme_name: r.scheme_name,
    reward_product_name: r.reward_product_name,
  }));
}

module.exports = {
  getActiveEnrollment,
  listWelcomeGiftProducts,
  startEnrollment,
  verifyEnrollment,
  finalizeEnrollment,
  reconcilePendingEnrollment,
  listEnrollmentsForDealer,
  listAllEnrollmentsByDealer,
  listRecentWinners,
};
