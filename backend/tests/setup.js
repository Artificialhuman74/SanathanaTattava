/**
 * Jest setup file — runs in EACH worker process before any test module is loaded.
 * Setting env vars here ensures db.js picks them up when it is first required.
 */
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

// Unique temp dir per worker so parallel suites never share state
const testId      = crypto.randomBytes(4).toString('hex');
const testDataDir = path.join(os.tmpdir(), `tradehub-test-${testId}`);
fs.mkdirSync(testDataDir, { recursive: true });

process.env.DATA_DIR    = testDataDir;
process.env.JWT_SECRET  = 'test-jwt-secret-min-32-chars-ok!!';
process.env.NODE_ENV    = 'test';
process.env.PORT        = '0';       // not used in tests (supertest handles port)
process.env.EMAIL_USER  = '';        // disable real email sending in tests
