const db = require('../database/db');

// Ensure audit_log table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id   INTEGER NOT NULL,
    action     TEXT    NOT NULL,
    target     TEXT,
    payload    TEXT,
    ip         TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function auditLog(action) {
  return (req, res, next) => {
    // Run after the handler by wrapping res.json
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) {
        try {
          db.prepare(`INSERT INTO audit_log (admin_id, action, target, payload, ip) VALUES (?,?,?,?,?)`)
            .run(
              req.user?.id || null,
              action,
              req.params?.id ? String(req.params.id) : null,
              JSON.stringify(req.body || {}),
              req.ip || null,
            );
        } catch { /* non-fatal */ }
      }
      return origJson(body);
    };
    next();
  };
}

module.exports = { auditLog };
