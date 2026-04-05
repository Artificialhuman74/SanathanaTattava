require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../database/db');

const email    = 'ravigbb@gmail.com';
const password = 'Bangalore@2114.';
const name     = 'Admin';

const hash = bcrypt.hashSync(password, 10);

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  db.prepare('UPDATE users SET password = ?, role = ? WHERE email = ?').run(hash, 'admin', email);
  console.log('Admin user updated:', email);
} else {
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(name, email, hash, 'admin');
  console.log('Admin user created:', email);
}

process.exit(0);
