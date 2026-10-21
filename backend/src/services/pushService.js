/**
 * Push notifications to partners' phones (ST Partner app) via Firebase Cloud Messaging.
 *
 * Never throws: a failed push must not fail the request that triggered it
 * (an admin approving a rider still succeeds if FCM is down). Tokens that FCM
 * reports as dead are removed so we stop sending to uninstalled apps.
 */
const db = require('../database/db');
const { messaging } = require('./firebaseAdmin');

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

let warnedUnconfigured = false;

/**
 * @param {number} userId
 * @param {{ title: string, body: string, data?: Record<string,string>, channelId?: string }} message
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendToUser(userId, { title, body, data = {}, channelId = 'account_updates' }) {
  const tokens = db.prepare('SELECT token FROM device_tokens WHERE user_id = ?').all(userId).map((r) => r.token);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  let client;
  try {
    client = messaging();
  } catch (err) {
    if (!warnedUnconfigured) {
      console.warn('[push] Firebase Admin not configured, push skipped:', err.message);
      warnedUnconfigured = true;
    }
    return { sent: 0, failed: tokens.length };
  }

  try {
    const res = await client.sendEachForMulticast({
      tokens,
      notification: { title, body },
      // Strings only: FCM data values must be strings.
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', notification: { channelId } },
    });
    res.responses.forEach((r, i) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        db.prepare('DELETE FROM device_tokens WHERE token = ?').run(tokens[i]);
      }
    });
    return { sent: res.successCount, failed: res.failureCount };
  } catch (err) {
    console.error('[push] send failed:', err.message);
    return { sent: 0, failed: tokens.length };
  }
}

/**
 * Data-only, high-priority push: the app decides how to show it (order offers become a
 * full-screen ring the app builds itself, which a plain notification message can't do).
 */
async function sendDataToUser(userId, data, { ttlMs = 120 * 1000 } = {}) {
  const tokens = db.prepare('SELECT token FROM device_tokens WHERE user_id = ?').all(userId).map((r) => r.token);
  if (tokens.length === 0) return { sent: 0, failed: 0 };
  let client;
  try {
    client = messaging();
  } catch (err) {
    if (!warnedUnconfigured) {
      console.warn('[push] Firebase Admin not configured, push skipped:', err.message);
      warnedUnconfigured = true;
    }
    return { sent: 0, failed: tokens.length };
  }
  try {
    const res = await client.sendEachForMulticast({
      tokens,
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', ttl: ttlMs },
    });
    res.responses.forEach((r, i) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        db.prepare('DELETE FROM device_tokens WHERE token = ?').run(tokens[i]);
      }
    });
    return { sent: res.successCount, failed: res.failureCount };
  } catch (err) {
    console.error('[push] data send failed:', err.message);
    return { sent: 0, failed: tokens.length };
  }
}

module.exports = { sendToUser, sendDataToUser };
