/**
 * Push-notification registration for the ST Partner app.
 *
 *   POST   /api/devices   { token, platform?, app_version? }  register / refresh this phone
 *   DELETE /api/devices   { token }                             stop pushes to this phone (logout)
 */
const express = require('express');
const db = require('../database/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.post('/', (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (token.length < 20 || token.length > 4096) return res.status(400).json({ error: 'A valid push token is required' });
  const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
  const appVersion = req.body?.app_version ? String(req.body.app_version).slice(0, 40) : null;
  // A phone that changes hands moves to the new account.
  db.prepare(`
    INSERT INTO device_tokens (user_id, token, platform, app_version, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(token) DO UPDATE SET
      user_id = excluded.user_id, platform = excluded.platform,
      app_version = excluded.app_version, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, token, platform, appVersion);
  res.json({ success: true });
});

router.delete('/', (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (token) db.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?').run(token, req.user.id);
  res.json({ success: true });
});

module.exports = router;
