const jwt = require('jsonwebtoken');
const db = require('../database/db');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(decoded.id, 'active');
    if (!user) return res.status(401).json({ error: 'User not found or suspended' });
    delete user.password;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

const requireTrader = (req, res, next) => {
  if (req.user.role !== 'trader') return res.status(403).json({ error: 'Trader access required' });
  next();
};

module.exports = { authenticate, requireAdmin, requireTrader };
