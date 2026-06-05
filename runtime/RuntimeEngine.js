const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const DatabaseManager = require('../core/database');
const AuthManager = require('../core/auth');
const RouterManager = require('../core/router');
const MiddlewareManager = require('../core/middleware');
const ValidationEngine = require('../core/validator');
const Logger = require('../core/logger');
const CacheEngine = require('../core/cache');
const QueryOptimizer = require('../core/queryOptimizer');
const ConnectionPool = require('../core/connectionPool');
const SecurityLayer = require('../core/security');
const MonitoringSystem = require('../core/monitoring');
const EnterpriseAuth = require('../core/enterpriseAuth');
const { buildLandingPayload, renderLandingPage, wantsJson } = require('../core/landingPage');

class RuntimeEngine {
  constructor() {
    this.app = express();
    this.config = null;
    this.db = null;
    this.auth = null;
    this.cache = null;
    this.queryOptimizer = null;
    this.connectionPool = null;
    this.security = null;
    this.monitoring = null;
    this.enterpriseAuth = null;
    this.server = null;
  }

  async initialize(config) {
    this.config = config;

    // Initialize monitoring system
    this.monitoring = new MonitoringSystem({
      enableMetrics: true,
      enableTracing: true,
      metricsInterval: 60000
    });

    // Initialize security layer
    this.security = new SecurityLayer({
      enableAuditLogging: true,
      enableFieldEncryption: true
    });

    // Initialize caching engine
    this.cache = new CacheEngine({
      enableCompression: true,
      enableMetrics: true,
      maxMemoryCache: 500
    });
    await this.cache.init();

    // Initialize query optimizer
    this.queryOptimizer = new QueryOptimizer({
      enableProfiling: true,
      slowQueryThreshold: 100,
      enableAutoJoin: true
    });

    // Initialize enterprise authentication
    this.enterpriseAuth = new EnterpriseAuth({
      enableMFA: true,
      enableOAuth2: true,
      enableSAML: config.auth?.enableSAML || false
    });

    // Setup security middleware
    this.setupSecurityMiddleware();

    // Setup basic middleware
    this.setupBasicMiddleware();
    this.setupTemplateUI();

    // Initialize database with connection pooling
    if (config.databases.length > 0) {
      this.db = new DatabaseManager();
      this.connectionPool = new ConnectionPool({
        minConnections: 5,
        maxConnections: 50,
        enableAutoScaling: true,
        enableMonitoring: true
      });
      try {
        await this.db.initialize(config.databases, config.models);
      } catch (error) {
        this.logDatabaseStartupFailure(config.databases[0], error);
        throw error;
      }
    }

    // Setup authentication
    if (config.auth) {
      this.auth = new AuthManager();
      this.auth.initialize(config.auth);
    }

    // Setup validation engine
    const validator = new ValidationEngine();
    validator.loadRules(config.validations);

    // Setup performance monitoring middleware
    this.setupMonitoringMiddleware();

    // Setup cache middleware
    this.setupCacheMiddleware();

    // Setup protected routes
    this.setupProtectedRoutes();

    // Setup routes
    const router = new RouterManager();
    router.registerRoutes(this.app, config.routes, this.db, validator);

    // Error handling middleware
    this.setupErrorHandling();

    // Start server
    await this.startServer();
  }

  setupSecurityMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(compression());

    // Add security headers
    this.app.use((req, res, next) => {
      const headers = this.security.getSecurityHeaders();
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
      next();
    });

    // CSRF protection
    this.app.use((req, res, next) => {
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const token = req.headers['x-csrf-token'];
        const sessionId = req.sessionID || req.headers['x-session-id'];
        
        if (sessionId && !this.security.verifyCSRFToken(sessionId, token)) {
          return res.status(403).json({ error: 'CSRF token invalid' });
        }
      }
      next();
    });
  }

  setupBasicMiddleware() {
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // Request logging
    this.app.use((req, res, next) => {
      Logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  setupTemplateUI() {
    const templateDir = path.resolve(process.cwd(), 'template');
    const indexPath = path.join(templateDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return;
    }

    const bootstrapDist = path.resolve(process.cwd(), 'node_modules', 'bootstrap', 'dist');
    if (fs.existsSync(bootstrapDist)) {
      this.app.use('/vendor/bootstrap', express.static(bootstrapDist));
    }

    this.app.use('/template', express.static(templateDir));
    this.app.get('/', (req, res, next) => {
      if (wantsJson(req)) {
        return next();
      }
      return res.sendFile(indexPath);
    });
  }

  setupMonitoringMiddleware() {
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.monitoring.recordRequest(req, res, duration);
        
        // Log slow requests
        if (duration > 1000) {
          Logger.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms`);
        }
      });

      next();
    });

    this.app.get('/', (req, res) => {
      const payload = buildLandingPayload({
        endpoints: {
          health: '/health',
          runtimeHealth: '/_health',
          metrics: '/_metrics',
          prometheus: '/_prometheus'
        },
        routes: (this.config.routes || []).map(route => ({
          method: route.method.toUpperCase(),
          path: route.path
        }))
      });
      if (wantsJson(req)) {
        return res.json(payload);
      }
      return res.type('html').send(renderLandingPage(payload));
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    this.app.get('/_health', (req, res) => {
      res.json(this.monitoring.getHealthStatus());
    });

    // Metrics endpoint
    this.app.get('/_metrics', (req, res) => {
      res.json(this.monitoring.generateReport());
    });

    // Prometheus metrics endpoint
    this.app.get('/_prometheus', (req, res) => {
      res.type('text/plain');
      res.send(this.monitoring.exportMetrics('prometheus'));
    });
  }

  setupCacheMiddleware() {
    // Cache GET requests
    this.app.use(async (req, res, next) => {
      if (req.method === 'GET') {
        const cacheKey = `${req.method}:${req.originalUrl}`;
        const cached = await this.cache.get('http', cacheKey);
        
        if (cached) {
          res.set('X-Cache', 'HIT');
          return res.json(cached);
        }
        
        res.set('X-Cache', 'MISS');
        
        // Intercept response
        const originalJson = res.json.bind(res);
        const cache = this.cache;
        res.json = function(data) {
          if (res.statusCode === 200) {
            cache.set('http', cacheKey, data, 3600).catch(error => {
              Logger.warn(`Cache set failed: ${error.message}`);
            });
          }
          return originalJson(data);
        };
      }
      
      next();
    });
  }

  setupProtectedRoutes() {
    if (!this.config.protections || !this.auth) return;

    for (const protection of this.config.protections) {
      this.app.use(protection.path, this.auth.jwtMiddleware());
    }
  }

  setupErrorHandling() {
    this.app.use((err, req, res, next) => {
      Logger.error(err.message);
      
      const status = err.status || 500;
      const message = err.message || 'Internal Server Error';
      
      res.status(status).json({
        success: false,
        error: message,
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path
      });
    });
  }

  async startServer() {
    const { port, host } = this.config.server;

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, host, async () => {
        await this.logStartupSummary(port, host);
        resolve(this.server);
      });
      this.server.on('error', reject);
    });
  }

  async logStartupSummary(port, host) {
    const localUrl = `http://${this.displayHost(host)}:${port}`;
    Logger.success('\nServer started');
    Logger.info(`Local: ${localUrl}`);
    if (host && host !== this.displayHost(host)) {
      Logger.info(`Bound address: http://${host}:${port}`);
    }

    await this.logDatabaseStatus();

    Logger.info(`\nAvailable routes:`);
    if (this.config.routes.length > 0) {
      this.config.routes.forEach(route => {
        Logger.info(`  ${route.method.toUpperCase()} ${route.path}`);
      });
    } else {
      Logger.info('  No model routes configured');
    }

    Logger.info('\nPress Ctrl+C to stop the server\n');
  }

  async logDatabaseStatus() {
    const databases = this.config.databases || [];
    if (!databases.length) {
      Logger.info('Database: none configured');
      return;
    }

    const health = this.db ? await this.db.healthCheck() : {};
    for (const dbConfig of databases) {
      const type = dbConfig.type.toLowerCase();
      const label = this.databaseLabel(type);
      const status = health[type]?.status || 'not connected';
      const connection = this.redactConnection(dbConfig.connection);
      Logger.info(`Database: ${label} ${status} (${connection})`);
    }
  }

  logDatabaseStartupFailure(dbConfig, error) {
    if (!dbConfig) return;
    const type = dbConfig.type.toLowerCase();
    const label = this.databaseLabel(type);
    Logger.error(`Database: ${label} not connected`);
    Logger.info(`Connection: ${this.redactConnection(dbConfig.connection)}`);
    Logger.info(`Reason: ${error.message}`);
    if (['mongodb', 'mongo'].includes(type)) {
      Logger.info('Start local MongoDB: docker run -d --name easyjs-mongo -p 27017:27017 mongo:7');
    }
  }

  databaseLabel(type) {
    const labels = {
      mongodb: 'MongoDB',
      mongo: 'MongoDB',
      postgres: 'PostgreSQL',
      postgresql: 'PostgreSQL',
      mysql: 'MySQL',
      sqlite: 'SQLite',
      redis: 'Redis',
      supabase: 'Supabase',
      firebase: 'Firebase',
      dynamodb: 'DynamoDB',
      elasticsearch: 'Elasticsearch',
      cassandra: 'Cassandra',
      neo4j: 'Neo4j'
    };
    return labels[type] || type.toUpperCase();
  }

  displayHost(host) {
    if (!host || host === '0.0.0.0' || host === '::') return 'localhost';
    return host;
  }

  redactConnection(connection) {
    if (!connection) return 'no connection string';
    if (typeof connection !== 'string') {
      const uri = connection.uri || connection.url || connection.connectionString;
      return uri ? this.redactConnection(uri) : 'configured';
    }
    try {
      const url = new URL(connection);
      if (url.password) url.password = '*****';
      return url.toString();
    } catch {
      return connection;
    }
  }
}

module.exports = RuntimeEngine;
