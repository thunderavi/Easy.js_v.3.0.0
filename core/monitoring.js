/**
 * Advanced Monitoring & Metrics System
 * Real-time performance monitoring, alerting, and analytics
 */

class MonitoringSystem {
  constructor(config = {}) {
    this.config = {
      enableMetrics: config.enableMetrics !== false,
      enableTracing: config.enableTracing !== false,
      metricsInterval: config.metricsInterval || 60000, // 1 minute
      retentionPeriod: config.retentionPeriod || 7 * 24 * 60 * 60 * 1000, // 7 days
      alertThresholds: config.alertThresholds || {
        responseTime: 1000, // ms
        errorRate: 0.05, // 5%
        memoryUsage: 0.8, // 80%
        cpuUsage: 0.9, // 90%
        dbConnections: 40 // out of 50
      },
      ...config
    };

    this.metrics = new Map();
    this.traces = [];
    this.alerts = [];
    this.performanceData = [];
    this.startTime = Date.now();
  }

  /**
   * Record request metric
   */
  recordRequest(req, res, duration) {
    const metric = {
      timestamp: Date.now(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      size: res.get('content-length') || 0,
      userId: req.user?.id || 'anonymous'
    };

    this.performanceData.push(metric);
    this.updateMetrics(metric);

    // Cleanup old data
    if (this.performanceData.length > 100000) {
      this.performanceData = this.performanceData.slice(-50000);
    }
  }

  /**
   * Update metrics aggregates
   */
  updateMetrics(metric) {
    const key = `${metric.method}:${metric.path}`;
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        errorCount: 0,
        lastUpdated: Date.now()
      });
    }

    const stats = this.metrics.get(key);
    stats.count++;
    stats.totalDuration += metric.duration;
    stats.minDuration = Math.min(stats.minDuration, metric.duration);
    stats.maxDuration = Math.max(stats.maxDuration, metric.duration);
    if (metric.status >= 400) stats.errorCount++;
    stats.lastUpdated = Date.now();

    // Check thresholds
    this.checkThresholds(key, stats, metric);
  }

  /**
   * Check alert thresholds
   */
  checkThresholds(key, stats, metric) {
    const avgDuration = stats.totalDuration / stats.count;
    const errorRate = stats.errorCount / stats.count;

    if (avgDuration > this.config.alertThresholds.responseTime) {
      this.createAlert('SLOW_RESPONSE', `${key} averaging ${avgDuration.toFixed(2)}ms`, 'warning');
    }

    if (errorRate > this.config.alertThresholds.errorRate) {
      this.createAlert('HIGH_ERROR_RATE', `${key} has ${(errorRate * 100).toFixed(2)}% error rate`, 'critical');
    }
  }

  /**
   * Record database metric
   */
  recordDatabaseMetric(operation, duration, success = true, query = null) {
    const metric = {
      timestamp: Date.now(),
      type: 'database',
      operation,
      duration,
      success,
      query: query ? query.substring(0, 100) : null
    };

    this.performanceData.push(metric);
  }

  /**
   * Record cache metric
   */
  recordCacheMetric(operation, hit = false, duration = 0) {
    const metric = {
      timestamp: Date.now(),
      type: 'cache',
      operation,
      hit,
      duration
    };

    this.performanceData.push(metric);
  }

  /**
   * Start request trace
   */
  startTrace(traceId, operation) {
    return {
      traceId,
      operation,
      startTime: Date.now(),
      events: [],
      addEvent: function(eventName, metadata = {}) {
        this.events.push({
          name: eventName,
          timestamp: Date.now(),
          duration: Date.now() - this.startTime,
          metadata
        });
      }
    };
  }

  /**
   * End trace and record
   */
  endTrace(trace) {
    trace.duration = Date.now() - trace.startTime;
    this.traces.push(trace);

    if (this.traces.length > 10000) {
      this.traces = this.traces.slice(-5000);
    }

    return trace;
  }

  /**
   * Create alert
   */
  createAlert(type, message, severity = 'info') {
    const alert = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      type,
      message,
      severity,
      resolved: false
    };

    this.alerts.push(alert);
    console.warn(`[Monitoring] ${severity.toUpperCase()}: ${message}`);

    return alert;
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(period = 'hour') {
    const now = Date.now();
    let startTime;

    switch (period) {
      case 'minute': startTime = now - 60 * 1000; break;
      case 'hour': startTime = now - 60 * 60 * 1000; break;
      case 'day': startTime = now - 24 * 60 * 60 * 1000; break;
      default: startTime = now - 60 * 60 * 1000;
    }

    const recentMetrics = this.performanceData.filter(m => m.timestamp > startTime);

    if (recentMetrics.length === 0) {
      return {
        period,
        dataPoints: 0,
        avgResponseTime: '0.00ms',
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        errorRate: '0.00%',
        requestsPerSecond: '0.00',
        totalRequests: 0
      };
    }

    return {
      period,
      dataPoints: recentMetrics.length,
      avgResponseTime: (recentMetrics.reduce((sum, m) => sum + (m.duration || 0), 0) / recentMetrics.length).toFixed(2) + 'ms',
      p95ResponseTime: this.calculatePercentile(recentMetrics, 0.95),
      p99ResponseTime: this.calculatePercentile(recentMetrics, 0.99),
      minResponseTime: Math.min(...recentMetrics.map(m => m.duration || 0)),
      maxResponseTime: Math.max(...recentMetrics.map(m => m.duration || 0)),
      errorRate: ((recentMetrics.filter(m => m.status >= 400).length / recentMetrics.length) * 100).toFixed(2) + '%',
      requestsPerSecond: (recentMetrics.length / ((now - startTime) / 1000)).toFixed(2),
      totalRequests: recentMetrics.length
    };
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(data, percentile) {
    const sorted = data
      .map(m => m.duration || 0)
      .sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index] ? sorted[index].toFixed(2) + 'ms' : '0ms';
  }

  /**
   * Get endpoint metrics
   */
  getEndpointMetrics() {
    const endpoints = [];

    for (const [key, stats] of this.metrics.entries()) {
      endpoints.push({
        endpoint: key,
        requests: stats.count,
        avgDuration: (stats.totalDuration / stats.count).toFixed(2),
        minDuration: stats.minDuration,
        maxDuration: stats.maxDuration,
        errorCount: stats.errorCount,
        errorRate: ((stats.errorCount / stats.count) * 100).toFixed(2) + '%'
      });
    }

    return endpoints.sort((a, b) => b.requests - a.requests);
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    const stats = this.getPerformanceStats('hour');
    const uptime = Date.now() - this.startTime;

    return {
      status: this.getOverallStatus(),
      uptime: (uptime / 1000 / 60).toFixed(2) + ' minutes',
      performance: stats,
      activeAlerts: this.alerts.filter(a => !a.resolved).length,
      totalAlerts: this.alerts.length,
      endpoints: this.metrics.size
    };
  }

  /**
   * Determine overall status
   */
  getOverallStatus() {
    const activeAlerts = this.alerts.filter(a => !a.resolved);
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');

    if (criticalAlerts.length > 0) return 'critical';
    if (activeAlerts.filter(a => a.severity === 'warning').length > 3) return 'degraded';
    return 'healthy';
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit = 20) {
    return this.alerts
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get trace information
   */
  getTraceInfo(traceId) {
    return this.traces.find(t => t.traceId === traceId);
  }

  /**
   * Generate performance report
   */
  generateReport() {
    return {
      generatedAt: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000 + ' seconds',
      health: this.getHealthStatus(),
      performance: this.getPerformanceStats('hour'),
      topEndpoints: this.getEndpointMetrics().slice(0, 10),
      recentAlerts: this.getRecentAlerts(10),
      systemMetrics: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }

  /**
   * Export metrics
   */
  exportMetrics(format = 'json') {
    if (format === 'prometheus') {
      return this.exportPrometheus();
    }
    return {
      metrics: Array.from(this.metrics.entries()),
      performanceData: this.performanceData.slice(-1000),
      alerts: this.alerts,
      traces: this.traces.slice(-100)
    };
  }

  /**
   * Export in Prometheus format
   */
  exportPrometheus() {
    let prometheus = '';

    for (const [key, stats] of this.metrics.entries()) {
      prometheus += `# HELP http_requests_total Total HTTP requests\n`;
      prometheus += `http_requests_total{endpoint="${key}"} ${stats.count}\n`;
      prometheus += `http_request_duration_ms{endpoint="${key}",quantile="0.5"} ${(stats.totalDuration / stats.count).toFixed(2)}\n`;
      prometheus += `http_request_errors_total{endpoint="${key}"} ${stats.errorCount}\n`;
    }

    return prometheus;
  }
}

module.exports = MonitoringSystem;
