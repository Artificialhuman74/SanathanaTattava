module.exports = {
  testEnvironment: 'node',

  // Runs in each worker process before any test file — sets env vars
  setupFiles: ['./tests/setup.js'],

  // Runs after the test framework is installed (for global mocks/matchers)
  setupFilesAfterFramework: [],

  // Where to find tests
  testMatch: ['**/tests/**/*.test.js'],

  // Always replace these heavy modules with lightweight fakes
  moduleNameMapper: {
    '.*/websocket/socketServer$':    '<rootDir>/tests/__mocks__/socketServer.js',
    '.*/services/emailService$':     '<rootDir>/tests/__mocks__/emailService.js',
    '.*/services/geocodingService$': '<rootDir>/tests/__mocks__/geocodingService.js',
    '.*/services/notificationService$': '<rootDir>/tests/__mocks__/notificationService.js',
  },

  // Each test file runs in isolation (own worker + module registry)
  // This is the default but worth being explicit about
  resetModules: false,

  verbose: true,
  forceExit: true,          // kill hanging handles (DB, timers) after tests
  detectOpenHandles: true,

  // Coverage (run with: npx jest --coverage)
  collectCoverageFrom: [
    'src/routes/**/*.js',
    'src/middleware/**/*.js',
    '!src/database/seed.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};
