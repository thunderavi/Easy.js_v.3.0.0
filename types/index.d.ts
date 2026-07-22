/**
 * EasyJS - A developer-friendly backend DSL and framework for Node.js
 */

// Core EasyJS class
export class EasyJS {
  constructor();
  parser: Parser;
  compiler: Compiler;
  runtime: RuntimeEngine;
  run(filePath: string): Promise<void>;
  loadEasyFile(filePath: string, seen?: Set<string>): string;
}

// Parser for .easy DSL files
export class Parser {
  parse(content: string): AST;
}

// Compiler to transform AST to Node.js/Express config
export class Compiler {
  compile(ast: AST): CompilerConfig;
}

// Runtime engine for executing compiled configurations
export class RuntimeEngine {
  initialize(config: CompilerConfig): Promise<void>;
}

// Abstract syntax tree representation
export interface AST {
  [key: string]: unknown;
}

// Compiled configuration for the framework
export interface CompilerConfig {
  [key: string]: unknown;
}

// Logger utility for consistent logging
export namespace Logger {
  function info(message: string): void;
  function error(message: string): void;
  function success(message: string): void;
  function warn(message: string): void;
  function debug(message: string): void;
}

// AppFactory for creating Express-compatible applications
export class AppFactory {
  createApp(config: AppConfig): Express.Application;
}

export interface AppConfig {
  [key: string]: unknown;
}

// Database management
export class DatabaseManager {
  constructor(config: DatabaseConfig);
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<unknown>;
  transaction<T>(callback: (trx: unknown) => Promise<T>): Promise<T>;
}

export interface DatabaseConfig {
  [key: string]: unknown;
}

// Migration management for database schema evolution
export class MigrationManager {
  migrate(direction: 'up' | 'down'): Promise<void>;
  rollback(): Promise<void>;
  status(): Promise<MigrationStatus>;
}

export interface MigrationStatus {
  completed: string[];
  pending: string[];
}

// API toolkit for building RESTful/GraphQL APIs
export class ApiToolkit {
  buildRestApi(schema: unknown): unknown;
  buildGraphQLApi(schema: unknown): unknown;
  addMiddleware(middleware: Function): void;
}

// Compliance and security manager
export class ComplianceManager {
  enableGDPR(options: ComplianceOptions): void;
  enableHIPAA(options: ComplianceOptions): void;
  generateAuditLog(action: string, details: Record<string, unknown>): void;
}

export interface ComplianceOptions {
  [key: string]: unknown;
}

// Query builder for type-safe database queries
export class QueryBuilder {
  select(...columns: string[]): QueryBuilder;
  from(table: string): QueryBuilder;
  where(condition: string, params?: unknown[]): QueryBuilder;
  orderBy(column: string, direction?: 'ASC' | 'DESC'): QueryBuilder;
  limit(count: number): QueryBuilder;
  execute(): Promise<unknown[]>;
}

// Backup and disaster recovery
export class BackupManager {
  createBackup(options: BackupOptions): Promise<string>;
  restoreBackup(backupId: string): Promise<void>;
  listBackups(): Promise<BackupInfo[]>;
}

export interface BackupOptions {
  [key: string]: unknown;
}

export interface BackupInfo {
  id: string;
  timestamp: Date;
  size: number;
}

// Observability and monitoring
export class Observability {
  addMetric(name: string, value: number, tags?: Record<string, string>): void;
  addTrace(name: string, duration: number): void;
  addLog(level: string, message: string): void;
}

// Webhook management for event-driven architecture
export class WebhookManager {
  register(event: string, url: string, options?: WebhookOptions): void;
  trigger(event: string, payload: Record<string, unknown>): Promise<void>;
  unregister(event: string, url: string): void;
}

export interface WebhookOptions {
  retries?: number;
  timeout?: number;
}

// Real-time monitoring system
export class MonitoringSystem {
  startMonitoring(): void;
  stopMonitoring(): void;
  getMetrics(): MonitoringMetrics;
}

export interface MonitoringMetrics {
  uptime: number;
  cpu: number;
  memory: number;
  requestCount: number;
}

// Job scheduler for background tasks
export class JobScheduler {
  schedule(cron: string, callback: () => Promise<void>): string;
  cancel(jobId: string): void;
  list(): ScheduledJob[];
}

export interface ScheduledJob {
  id: string;
  cron: string;
  lastRun?: Date;
  nextRun: Date;
}

// Plugin system for extensibility
export class PluginSystem {
  register(plugin: EasyJSPlugin): void;
  use(pluginName: string, options?: Record<string, unknown>): void;
  list(): string[];
}

export interface EasyJSPlugin {
  name: string;
  version: string;
  initialize(easyjs: EasyJS): Promise<void>;
}

// GraphQL enhancements
export class GraphQLEnhancements {
  addDirective(name: string, implementation: unknown): void;
  enableCaching(options: CacheOptions): void;
  enableDataLoaders(): void;
}

export interface CacheOptions {
  ttl?: number;
  strategy?: 'LRU' | 'LFU';
}

// WebSocket enhancements for real-time communication
export class WebSocketEnhancements {
  enableAutoSubscribe(): void;
  addChannel(name: string, options?: ChannelOptions): void;
  broadcast(channel: string, message: unknown): Promise<void>;
}

export interface ChannelOptions {
  auth?: boolean;
  rateLimit?: number;
}

// Analytics management
export class AnalyticsManager {
  track(event: string, properties?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  getMetrics(filter?: AnalyticsFilter): Promise<AnalyticsMetrics>;
}

export interface AnalyticsFilter {
  startDate?: Date;
  endDate?: Date;
  eventName?: string;
}

export interface AnalyticsMetrics {
  totalEvents: number;
  uniqueUsers: number;
  topEvents: Array<{ name: string; count: number }>;
}

// Microservices service registry
export class ServiceRegistry {
  register(service: ServiceDefinition): Promise<void>;
  deregister(serviceName: string): Promise<void>;
  discover(serviceName: string): Promise<ServiceInstance[]>;
  call(serviceName: string, method: string, args?: unknown): Promise<unknown>;
}

export interface ServiceDefinition {
  name: string;
  version: string;
  port: number;
  health?: string;
}

export interface ServiceInstance {
  host: string;
  port: number;
  healthy: boolean;
}

// Cloud storage management
export class CloudStorageManager {
  upload(file: Buffer, options: UploadOptions): Promise<string>;
  download(url: string): Promise<Buffer>;
  delete(url: string): Promise<void>;
  list(prefix?: string): Promise<StorageObject[]>;
}

export interface UploadOptions {
  filename: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StorageObject {
  name: string;
  size: number;
  lastModified: Date;
  url: string;
}

// AI provider integration management
export class AIProviderManager {
  setProvider(provider: 'openai' | 'anthropic' | 'google', apiKey: string): void;
  generateText(prompt: string, options?: AIGenerationOptions): Promise<string>;
  generateEmbedding(text: string): Promise<number[]>;
}

export interface AIGenerationOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Payment processing
export class PaymentProcessor {
  charge(amount: number, currency: string, payment: PaymentDetails): Promise<PaymentResult>;
  refund(transactionId: string, amount?: number): Promise<RefundResult>;
  getTransaction(transactionId: string): Promise<Transaction>;
}

export interface PaymentDetails {
  method: 'card' | 'paypal' | 'crypto';
  token: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentResult {
  transactionId: string;
  status: 'success' | 'failed' | 'pending';
  timestamp: Date;
}

export interface RefundResult {
  refundId: string;
  status: 'success' | 'failed';
  amount: number;
}

export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  status: 'completed' | 'pending' | 'failed';
  timestamp: Date;
}

// Email service
export class EmailService {
  send(email: EmailMessage): Promise<string>;
  sendBatch(emails: EmailMessage[]): Promise<string[]>;
  getTemplate(templateId: string): Promise<EmailTemplate>;
}

export interface EmailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

// Form and CRUD code generation
export class FormGenerator {
  generateForm(schema: unknown, options?: FormOptions): string;
}

export interface FormOptions {
  framework?: 'react' | 'vue' | 'html';
  theme?: string;
}

export class CRUDGenerator {
  generateCRUD(schema: unknown, options?: CRUDOptions): GeneratedCRUD;
}

export interface CRUDOptions {
  database?: string;
  auth?: boolean;
}

export interface GeneratedCRUD {
  routes: string;
  models: string;
  controllers: string;
}

// Easy language support
export namespace Language {
  class TypeChecker {
    check(code: string): TypeCheckResult;
  }

  class Formatter {
    format(code: string, options?: FormatterOptions): string;
  }

  class Linter {
    lint(code: string): LintResult[];
  }

  class Playground {
    execute(code: string): Promise<unknown>;
  }

  interface TypeCheckResult {
    valid: boolean;
    errors: TypeCheckError[];
  }

  interface TypeCheckError {
    line: number;
    column: number;
    message: string;
  }

  interface FormatterOptions {
    indent?: number;
    lineWidth?: number;
  }

  interface LintResult {
    line: number;
    column: number;
    rule: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }
}

// VSCode extension activation
export function activate(context: any): void;
export function deactivate(): void;

// Type exports for convenience
export { EasyJS as default };
