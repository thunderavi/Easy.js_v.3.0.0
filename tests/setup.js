// Global test setup
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Timeout for tests
jest.setTimeout(30000);

// Global virtual mocks for optional peer dependencies to prevent module resolution crashes
const peerDeps = [
  '@anthropic-ai/sdk',
  '@aws-sdk/client-dynamodb',
  '@aws-sdk/client-s3',
  '@aws-sdk/lib-dynamodb',
  '@aws-sdk/lib-storage',
  '@aws-sdk/s3-request-presigner',
  '@azure/storage-blob',
  '@elastic/elasticsearch',
  '@google-cloud/storage',
  '@google/genai',
  '@libsql/client',
  '@opentelemetry/api',
  '@sendgrid/mail',
  '@sentry/node',
  '@supabase/supabase-js',
  '@tensorflow/tfjs',
  'cassandra-driver',
  'firebase-admin',
  'mailgun.js',
  'mongoose',
  'mssql',
  'mysql2',
  'mysql2/promise',
  'neo4j-driver',
  'nodemailer',
  'openai',
  'pg',
  'redis',
  'stripe',
  'vscode-languageclient',
  'vscode-languageserver',
  'vscode-languageserver-textdocument'
];

peerDeps.forEach(dep => {
  jest.mock(dep, () => ({}), { virtual: true });
});

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
