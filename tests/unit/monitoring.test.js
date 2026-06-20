const MonitoringSystem = require('../../core/monitoring');

describe('MonitoringSystem', () => {
  it('records request metrics, creates alerts, and exports endpoint metrics', () => {
    const monitoring = new MonitoringSystem({
      alertThresholds: {
        responseTime: 10,
        errorRate: 0.1
      }
    });
    const req = { method: 'GET', path: '/slow', user: { id: 'u1' } };
    const res = { statusCode: 500, get: jest.fn().mockReturnValue('123') };

    monitoring.recordRequest(req, res, 50);

    expect(monitoring.performanceData).toHaveLength(1);
    expect(monitoring.alerts.map(alert => alert.type)).toEqual(['SLOW_RESPONSE', 'HIGH_ERROR_RATE']);
    expect(monitoring.getEndpointMetrics()[0]).toEqual(expect.objectContaining({
      endpoint: 'GET:/slow',
      requests: 1,
      errorCount: 1
    }));
    expect(monitoring.getOverallStatus()).toBe('critical');
  });

  it('records database/cache metrics and traces', () => {
    const monitoring = new MonitoringSystem();
    monitoring.recordDatabaseMetric('select', 12, true, 'select * from very_long_query');
    monitoring.recordCacheMetric('get', true, 2);
    const trace = monitoring.startTrace('trace-1', 'request');
    trace.addEvent('db', { table: 'posts' });
    const ended = monitoring.endTrace(trace);

    expect(ended.duration).toEqual(expect.any(Number));
    expect(monitoring.getTraceInfo('trace-1')).toBe(trace);
    expect(monitoring.performanceData).toHaveLength(2);
  });

  it('returns performance, health, report, and export payloads', () => {
    const monitoring = new MonitoringSystem();
    monitoring.recordRequest(
      { method: 'GET', path: '/items', user: null },
      { statusCode: 200, get: jest.fn().mockReturnValue(0) },
      20
    );
    const alert = monitoring.createAlert('TEST', 'message', 'warning');
    monitoring.resolveAlert(alert.id);

    expect(monitoring.getPerformanceStats('minute')).toEqual(expect.objectContaining({
      period: 'minute',
      totalRequests: 1
    }));
    expect(monitoring.calculatePercentile([{ duration: 10 }, { duration: 30 }], 0.95)).toBe('30.00ms');
    expect(monitoring.getHealthStatus()).toEqual(expect.objectContaining({
      status: 'healthy',
      totalAlerts: 1,
      endpoints: 1
    }));
    expect(monitoring.getRecentAlerts(1)).toHaveLength(1);
    expect(monitoring.generateReport()).toEqual(expect.objectContaining({
      health: expect.any(Object),
      topEndpoints: expect.any(Array)
    }));
    expect(monitoring.exportMetrics()).toEqual(expect.objectContaining({
      metrics: expect.any(Array),
      performanceData: expect.any(Array)
    }));
    expect(monitoring.exportMetrics('prometheus')).toContain('http_requests_total');
  });

  it('covers degraded health, empty percentiles, retention trimming, and period defaults', () => {
    const monitoring = new MonitoringSystem({
      alertThresholds: {
        responseTime: 1000,
        errorRate: 1
      }
    });

    monitoring.performanceData = Array.from({ length: 100001 }, (_, index) => ({
      timestamp: Date.now(),
      method: 'GET',
      path: `/items/${index}`,
      status: 200,
      duration: index % 5
    }));
    monitoring.recordRequest(
      { method: 'GET', path: '/trimmed', user: null },
      { statusCode: 200, get: jest.fn().mockReturnValue(undefined) },
      5
    );
    expect(monitoring.performanceData).toHaveLength(50000);

    expect(monitoring.calculatePercentile([], 0.95)).toBe('0ms');
    expect(monitoring.getPerformanceStats('day')).toEqual(expect.objectContaining({ period: 'day' }));
    expect(monitoring.getPerformanceStats('unknown')).toEqual(expect.objectContaining({ period: 'unknown' }));
    expect(monitoring.recordDatabaseMetric('insert', 4, false)).toBeUndefined();

    for (let index = 0; index < 4; index++) {
      monitoring.createAlert('WARN', `warning-${index}`, 'warning');
    }
    expect(monitoring.getOverallStatus()).toBe('degraded');
    monitoring.createAlert('INFO', 'info-only');
    monitoring.resolveAlert('missing-alert');
    expect(monitoring.getRecentAlerts()).toHaveLength(5);

    const trace = monitoring.startTrace('trace-trim', 'op');
    monitoring.traces = Array.from({ length: 10001 }, (_, index) => ({ traceId: `old-${index}` }));
    monitoring.endTrace(trace);
    expect(monitoring.traces).toHaveLength(5000);
    expect(monitoring.getTraceInfo('missing')).toBeUndefined();

    const empty = new MonitoringSystem();
    for (const period of ['minute', 'hour', 'day']) {
      expect(empty.getPerformanceStats(period)).toEqual(expect.objectContaining({
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
      }));
    }
    expect(empty.exportMetrics('json')).toEqual(expect.objectContaining({
      metrics: [],
      performanceData: []
    }));
    expect(empty.exportPrometheus()).toBe('');
  });
});
