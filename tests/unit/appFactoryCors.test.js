const request = require('supertest');
const AppFactory = require('../../app');

function createApp(config = {}) {
  const factory = new AppFactory({
    enableLogging: false,
    enableRateLimit: false,
    enableSwagger: false,
    enableAdmin: false,
    enableHealthChecks: false,
    ...config
  });

  factory.setupSecurityMiddleware();
  factory.app.get('/ok', (req, res) => res.json({ ok: true }));
  return factory.app;
}

describe('AppFactory CORS configuration', () => {
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  const originalCorsOrigins = process.env.CORS_ORIGINS;
  const originalCorsCredentials = process.env.CORS_CREDENTIALS;

  afterEach(() => {
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }

    if (originalCorsOrigins === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = originalCorsOrigins;
    }

    if (originalCorsCredentials === undefined) {
      delete process.env.CORS_CREDENTIALS;
    } else {
      process.env.CORS_CREDENTIALS = originalCorsCredentials;
    }
  });

  it('uses wildcard CORS without credentials by default', async () => {
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_CREDENTIALS;

    const response = await request(createApp())
      .get('/ok')
      .set('Origin', 'https://client.example');

    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('reflects an allowed origin when credentials are explicitly enabled', async () => {
    const response = await request(createApp({
      corsOrigin: ['https://app.example', 'https://admin.example'],
      corsCredentials: true
    }))
      .get('/ok')
      .set('Origin', 'https://app.example');

    expect(response.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not send credentialed CORS headers for denied origins', async () => {
    const response = await request(createApp({
      corsOrigin: 'https://app.example',
      corsCredentials: true
    }))
      .get('/ok')
      .set('Origin', 'https://blocked.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('ignores wildcard origins when credentials are enabled', async () => {
    const response = await request(createApp({
      corsOrigin: '*',
      corsCredentials: true
    }))
      .get('/ok')
      .set('Origin', 'https://client.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('handles allowed credentialed OPTIONS preflight requests from env allowlist', async () => {
    process.env.CORS_ORIGIN = 'https://app.example, https://admin.example';
    process.env.CORS_CREDENTIALS = 'true';

    const response = await request(createApp())
      .options('/ok')
      .set('Origin', 'https://admin.example')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://admin.example');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
