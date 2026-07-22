/**
 * Minimal type-check test to verify TypeScript declarations work correctly.
 * Run with: tsc --noEmit types/test.ts
 */

import EasyJS, {
  AppFactory,
  DatabaseManager,
  QueryBuilder,
  Logger,
  EmailService,
  PaymentProcessor,
  ServiceRegistry,
  Language,
} from './index';

// Test EasyJS class instantiation and methods
const easyjs = new EasyJS();
const runPromise: Promise<void> = easyjs.run('./app.easy');

// Test Parser and Compiler access
const ast = easyjs.parser.parse('MODEL User { id Int }');
const config = easyjs.compiler.compile(ast);

// Test Logger
Logger.info('Test log');
Logger.error('Error message');
Logger.success('Success message');

// Test AppFactory
const appFactory = new AppFactory();
const appConfig = { port: 3000 };
const app = appFactory.createApp(appConfig);

// Test DatabaseManager
const dbConfig = { host: 'localhost', database: 'test' };
const db = new DatabaseManager(dbConfig);
const connectPromise: Promise<void> = db.connect();
const queryPromise: Promise<unknown> = db.query('SELECT * FROM users');

// Test QueryBuilder
const results: Promise<unknown[]> = new QueryBuilder()
  .select('id', 'email')
  .from('users')
  .where('active = ?', [true])
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();

// Test EmailService
const emailService = new EmailService();
const sendPromise: Promise<string> = emailService.send({
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<p>Hello</p>',
});

// Test PaymentProcessor
const paymentProcessor = new PaymentProcessor();
const chargePromise = paymentProcessor.charge(100, 'USD', {
  method: 'card',
  token: 'tok_test',
});

// Test ServiceRegistry
const registry = new ServiceRegistry();
const registerPromise = registry.register({
  name: 'user-service',
  version: '1.0.0',
  port: 3001,
});

const discoverPromise = registry.discover('user-service');

// Test Language TypeChecker
const typeChecker = new Language.TypeChecker();
const checkResult = typeChecker.check('MODEL User { id Int name String }');
const isValid: boolean = checkResult.valid;

// Test Language Formatter
const formatter = new Language.Formatter();
const formatted: string = formatter.format('MODEL User{id Int}', { indent: 2 });

// Test Language Linter
const linter = new Language.Linter();
const lintResults = linter.lint('MODEL User { id Int }');
const errorCount: number = lintResults.filter((r) => r.severity === 'error').length;

// Verify types compile without errors
console.log('Type definitions validated successfully');
