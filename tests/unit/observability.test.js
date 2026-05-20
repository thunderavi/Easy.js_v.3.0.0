jest.mock('@sentry/node', () => ({ init: jest.fn(), captureException: jest.fn() }));
jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(() => ({
      startActiveSpan: jest.fn((name, callback) => callback({
        end: jest.fn(),
        recordException: jest.fn()
      }))
    }))
  }
}));

const Observability = require('../../core/observability');
const Sentry = require('@sentry/node');
const otel = require('@opentelemetry/api');

describe('Observability', () => {
  it('tracks request and error metrics through middleware', () => {
    const observability = new Observability().initialize();
    const finishHandlers = [];
    const req = {};
    const res = {
      statusCode: 500,
      on: jest.fn((event, handler) => {
        if (event === 'finish') finishHandlers.push(handler);
      })
    };
    const next = jest.fn();

    observability.middleware()(req, res, next);
    finishHandlers[0]();

    expect(next).toHaveBeenCalled();
    expect(observability.metrics.requests).toBe(1);
    expect(observability.metrics.errors).toBe(1);
    expect(observability.prometheus()).toContain('easyjs_http_requests_total 1');
  });

  it('captures errors through logger and optional Sentry client', () => {
    const captureException = jest.fn();
    const observability = new Observability();
    observability.sentry = { captureException };

    observability.captureError(new Error('broken'), { phase: 'test' });

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { phase: 'test' }
    });
  });

  it('runs traced functions without a tracer', async () => {
    const observability = new Observability();
    await expect(observability.trace('work', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('initializes Sentry and OpenTelemetry and records successful request averages', () => {
    const observability = new Observability({ sentryDsn: 'https://example@sentry/1', serviceName: 'svc' }).initialize();
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://example@sentry/1',
      environment: process.env.NODE_ENV
    });
    expect(otel.trace.getTracer).toHaveBeenCalledWith('svc');

    const finishHandlers = [];
    observability.middleware()({}, {
      statusCode: 204,
      on: (event, handler) => finishHandlers.push(handler)
    }, jest.fn());
    finishHandlers[0]();

    const metrics = observability.prometheus();
    expect(metrics).toContain('easyjs_http_requests_total 1');
    expect(metrics).toContain('easyjs_http_errors_total 0');
  });

  it('traces success and failure spans', async () => {
    const span = { end: jest.fn(), recordException: jest.fn() };
    const tracer = {
      startActiveSpan: jest.fn((name, callback) => callback(span))
    };
    const observability = new Observability();
    observability.tracer = tracer;

    await expect(observability.trace('success', async receivedSpan => {
      expect(receivedSpan).toBe(span);
      return 'ok';
    })).resolves.toBe('ok');
    expect(span.end).toHaveBeenCalled();

    await expect(observability.trace('failure', async () => {
      throw new Error('trace failed');
    })).rejects.toThrow('trace failed');
    expect(span.recordException).toHaveBeenCalledWith(expect.any(Error));
  });
});
