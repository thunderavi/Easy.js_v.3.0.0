#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Parser = require('./parser/Parser');
const Compiler = require('./compiler/Compiler');
const RuntimeEngine = require('./runtime/RuntimeEngine');
const Logger = require('./core/logger');
const AppFactory = require('./app');
const DatabaseManager = require('./core/database');
const MigrationManager = require('./core/migrationManager');
const ApiToolkit = require('./core/apiToolkit');
const ComplianceManager = require('./core/compliance');
const QueryBuilder = require('./core/queryBuilder');
const BackupManager = require('./core/backupManager');
const Observability = require('./core/observability');
const WebhookManager = require('./core/webhookManager');
const MonitoringSystem = require('./core/monitoring');
const JobScheduler = require('./core/jobScheduler');
const PluginSystem = require('./core/plugins');
const GraphQLEnhancements = require('./core/graphqlEnhancements');
const WebSocketEnhancements = require('./core/websocketEnhancements');
const AnalyticsManager = require('./analytics/analyticsManager');
const ServiceRegistry = require('./microservices/serviceRegistry');
const CloudStorageManager = require('./storage/cloudStorageManager');
const AIProviderManager = require('./core/aiProviderManager');
const PaymentProcessor = require('./payments/paymentProcessor');
const EmailService = require('./email/emailService');
const { FormGenerator, CRUDGenerator } = require('./forms/formGenerator');
const Language = require('./language');

class EasyJS {
  constructor() {
    this.parser = new Parser();
    this.compiler = new Compiler();
    this.runtime = new RuntimeEngine();
  }

  async run(filePath) {
    try {
      const cwd = process.cwd();
      const fullPath = path.resolve(cwd, filePath);

      if (!fs.existsSync(fullPath)) {
        Logger.error(`File not found: ${filePath}`);
        process.exit(1);
      }

      const content = this.loadEasyFile(fullPath);
      Logger.info('Parsing easy.js DSL...');

      const ast = this.parser.parse(content);
      Logger.success('DSL parsed successfully');

      Logger.info('Compiling to Node.js/Express...');
      const config = this.compiler.compile(ast);
      Logger.success('Compilation completed');

      Logger.info('Starting runtime engine...');
      await this.runtime.initialize(config);
      Logger.success('Server running');
    } catch (error) {
      Logger.error(error.message);
      process.exit(1);
    }
  }

  loadEasyFile(filePath, seen = new Set()) {
    const fullPath = path.resolve(filePath);
    if (seen.has(fullPath)) {
      return '';
    }
    seen.add(fullPath);

    const dir = path.dirname(fullPath);
    const content = fs.readFileSync(fullPath, 'utf-8');

    return content.replace(/^\s*IMPORT\s+(.+)$/gim, (line, importPath) => {
      const cleanPath = importPath.trim().replace(/^['"]|['"]$/g, '');
      const resolvedPath = path.resolve(dir, cleanPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Imported file not found: ${cleanPath}`);
      }
      return this.loadEasyFile(resolvedPath, seen);
    });
  }
}

if (require.main === module) {
  const filePath = process.argv[2] || './app.easy';
  const easyjs = new EasyJS();
  easyjs.run(filePath);
}

module.exports = EasyJS;
module.exports.EasyJS = EasyJS;
module.exports.AppFactory = AppFactory;
module.exports.DatabaseManager = DatabaseManager;
module.exports.MigrationManager = MigrationManager;
module.exports.ApiToolkit = ApiToolkit;
module.exports.ComplianceManager = ComplianceManager;
module.exports.QueryBuilder = QueryBuilder;
module.exports.BackupManager = BackupManager;
module.exports.Observability = Observability;
module.exports.WebhookManager = WebhookManager;
module.exports.MonitoringSystem = MonitoringSystem;
module.exports.JobScheduler = JobScheduler;
module.exports.PluginSystem = PluginSystem;
module.exports.GraphQLEnhancements = GraphQLEnhancements;
module.exports.WebSocketEnhancements = WebSocketEnhancements;
module.exports.AnalyticsManager = AnalyticsManager;
module.exports.ServiceRegistry = ServiceRegistry;
module.exports.CloudStorageManager = CloudStorageManager;
module.exports.AIProviderManager = AIProviderManager;
module.exports.PaymentProcessor = PaymentProcessor;
module.exports.EmailService = EmailService;
module.exports.FormGenerator = FormGenerator;
module.exports.CRUDGenerator = CRUDGenerator;
module.exports.Language = Language;
module.exports.TypeChecker = Language.TypeChecker;
module.exports.EasyFormatter = Language.Formatter;
module.exports.EasyLinter = Language.Linter;
module.exports.EasyPlayground = Language.Playground;
module.exports.activate = function activate(context) {
  return require('./ide/vscode-extension').activate(context);
};
module.exports.deactivate = function deactivate() {
  return require('./ide/vscode-extension').deactivate();
};
