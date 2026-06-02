const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const loggerWinston = require('./core/loggerWinston');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { requestLogger, errorRequestLogger } = require('./middleware/requestLogger');
const JobScheduler = require('./core/jobScheduler');
const SwaggerGenerator = require('./docs/swaggerGenerator');
const AdminDashboardGenerator = require('./admin/dashboardGenerator');
const healthRoutes = require('./routes/health');
const ApiToolkit = require('./core/apiToolkit');
const Observability = require('./core/observability');
const WebhookManager = require('./core/webhookManager');
const PluginSystem = require('./core/plugins');
const ComplianceManager = require('./core/compliance');
const AIProviderManager = require('./core/aiProviderManager');

class AppFactory {
  constructor(config = {}) {
    this.config = {
      port: config.port || 3000,
      env: config.env || process.env.NODE_ENV || 'development',
      enableLogging: config.enableLogging !== false,
      enableSwagger: config.enableSwagger !== false,
      enableAdmin: config.enableAdmin !== false,
      enableHealthChecks: config.enableHealthChecks !== false,
      enableRateLimit: config.enableRateLimit !== false,
      ...config
    };

    this.app = express();
    this.jobScheduler = null;
    this.databases = null;
    this.redis = null;
    this.apiToolkit = config.apiToolkit || new ApiToolkit(config.api || {});
    this.observability = config.observability || new Observability(config.observabilityConfig || {}).initialize();
    this.webhooks = config.webhooks || new WebhookManager(config.webhookConfig || {});
    this.plugins = config.plugins || new PluginSystem(config.pluginConfig || {});
    this.compliance = config.compliance || new ComplianceManager(config.complianceConfig || {});
    this.ai = config.ai || new AIProviderManager(config.aiConfig || {});
  }

  /**
   * Initialize application
   */
  async initialize(databases = null, redis = null) {
    try {
      this.databases = databases;
      this.redis = redis;

      // Setup middleware
      this.setupSecurityMiddleware();
      this.setupCoreMiddleware();
      this.setupLoggingMiddleware();
      this.app.use(this.observability.middleware());
      this.app.use(this.apiToolkit.interceptorMiddleware());
      this.app.use(this.plugins.executeMiddleware.bind(this.plugins));
      if (this.config.enableAI !== false) {
        this.app.use(this.ai.middleware({ path: this.config.aiPath || '/ai/complete' }));
      }

      if (this.config.enableRateLimit) {
        this.setupRateLimiting();
      }

      // Setup databases
      if (this.databases) {
        this.app.set('database', this.databases);
      }
      if (this.redis) {
        this.app.set('redis', this.redis);
      }
      this.app.set('compliance', this.compliance);
      this.app.set('ai', this.ai);

      // Setup job scheduler
      this.jobScheduler = new JobScheduler(this.config.redisUrl || 'redis://localhost:6379');

      // Setup routes
      if (this.config.enableHealthChecks) {
        this.app.use('/', healthRoutes);
        this.app.get('/metrics/prometheus', (req, res) => {
          res.type('text/plain').send(this.observability.prometheus());
        });
      }

      if (this.config.enableWebhooks !== false) {
        this.app.use(this.config.webhookPath || '/webhooks', this.webhooks.router());
      }

      // Setup documentation
      if (this.config.enableSwagger) {
        SwaggerGenerator.setupSwagger(this.app, this.config.models || []);
      }

      // Setup admin dashboard
      if (this.config.enableAdmin && this.databases) {
        const adminGen = new AdminDashboardGenerator(this.databases, this.config.models || []);
        this.app.use('/admin', adminGen.generate());
      }

      // Error handling (must be last)
      this.app.use(notFoundHandler);
      this.app.use(errorHandler);

      loggerWinston.info('✓ Application initialized', {
        env: this.config.env,
        port: this.config.port,
        features: {
          logging: this.config.enableLogging,
          swagger: this.config.enableSwagger,
          admin: this.config.enableAdmin,
          healthChecks: this.config.enableHealthChecks,
          rateLimit: this.config.enableRateLimit
        }
      });

      return this.app;
    } catch (error) {
      loggerWinston.fatal('Failed to initialize application', {
        error: error.message,
        stack: error.stack
      });
      this.observability.captureError(error, { phase: 'initialize' });
      throw error;
    }
  }

  setupSecurityMiddleware() {
    // Helmet for security headers
    this.app.use(helmet());

    // CORS
    this.app.use(cors(this.getCorsOptions()));

    // Trust proxy
    this.app.set('trust proxy', 1);
  }

  getCorsOptions() {
    const origins = this.getCorsOrigins();
    const credentials = this.getCorsCredentials();
    const hasWildcard = origins.includes('*');

    if (!credentials && hasWildcard) {
      return {
        origin: '*',
        credentials: false,
        optionsSuccessStatus: 200
      };
    }

    return {
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }

        if (origins.includes(origin)) {
          return callback(null, true);
        }

        return callback(null, false);
      },
      credentials,
      optionsSuccessStatus: 200
    };
  }

  getCorsOrigins() {
    const configuredOrigin = this.config.corsOrigin ?? process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? '*';
    const origins = Array.isArray(configuredOrigin)
      ? configuredOrigin
      : String(configuredOrigin).split(',');

    const normalizedOrigins = origins
      .map(origin => String(origin).trim())
      .filter(Boolean);

    return normalizedOrigins.length > 0 ? normalizedOrigins : ['*'];
  }

  getCorsCredentials() {
    if (typeof this.config.corsCredentials === 'boolean') {
      return this.config.corsCredentials;
    }

    return AppFactory.parseBoolean(process.env.CORS_CREDENTIALS, false);
  }

  static parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  setupCoreMiddleware() {
    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ limit: '10mb', extended: true }));

    // Error request logger
    this.app.use(errorRequestLogger);
  }

  setupLoggingMiddleware() {
    if (this.config.enableLogging) {
      if (this.config.env === 'production') {
        const { morganProduction } = require('./middleware/requestLogger');
        this.app.use(morganProduction);
      } else {
        const { morganDevelopment } = require('./middleware/requestLogger');
        this.app.use(morganDevelopment);
      }
      this.app.use(require('./middleware/requestLogger').requestLogger);
    }
  }

  setupRateLimiting() {
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // requests per window
      message: 'Too many requests from this IP',
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip health checks
        return req.path === '/health' || req.path === '/ready';
      }
    });

    this.app.use(limiter);
  }

  /**
   * Register routes
   */
  registerRoutes(routes) {
    if (Array.isArray(routes)) {
      routes.forEach(route => {
        if (route.path && route.router) {
          this.app.use(route.path, route.router);
        }
      });
    }
    return this.app;
  }

  /**
   * Register models for admin/swagger
   */
  registerModels(models) {
    this.config.models = models;
    return this;
  }

  /**
   * Get job scheduler
   */
  getJobScheduler() {
    return this.jobScheduler;
  }

  getApiToolkit() {
    return this.apiToolkit;
  }

  getObservability() {
    return this.observability;
  }

  getWebhooks() {
    return this.webhooks;
  }

  getPlugins() {
    return this.plugins;
  }

  getCompliance() {
    return this.compliance;
  }

  getAI() {
    return this.ai;
  }

  /**
   * Start server
   */
  async start(port = null) {
    port = port || this.config.port;

    return new Promise((resolve, reject) => {
      try {
        const server = this.app.listen(port, () => {
          loggerWinston.info(`✓ Server started on port ${port}`, {
            env: this.config.env,
            url: `http://localhost:${port}`
          });

          resolve(server);
        });

        // Graceful shutdown
        process.on('SIGTERM', async () => {
          loggerWinston.info('SIGTERM received, shutting down gracefully...');
          server.close(async () => {
            await this.shutdown();
            process.exit(0);
          });
        });

        process.on('SIGINT', async () => {
          loggerWinston.info('SIGINT received, shutting down gracefully...');
          server.close(async () => {
            await this.shutdown();
            process.exit(0);
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Shutdown application
   */
  async shutdown() {
    try {
      loggerWinston.info('Shutting down application...');

      // Close job scheduler
      if (this.jobScheduler) {
        await this.jobScheduler.closeQueues();
      }

      // Close databases
      if (this.databases && this.databases.close) {
        await this.databases.close();
      }

      // Close Redis
      if (this.redis && this.redis.quit) {
        await this.redis.quit();
      }

      loggerWinston.info('✓ Application shutdown complete');
    } catch (error) {
      loggerWinston.error('Error during shutdown', { error: error.message });
    }
  }

  /**
   * Get Express app
   */
  getApp() {
    return this.app;
  }
}

module.exports = AppFactory;
