// Global test setup
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Timeout for tests
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  generateId: () => Math.random().toString(36).substring(7),
  generateEmail: () => `test-${Math.random().toString(36).substring(7)}@example.com`
};

// Mock console methods to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn((msg) => {
    if (msg && msg.includes('EXPECTED_ERROR')) {
      process.stderr.write(`${msg}\n`);
    }
  })
};
