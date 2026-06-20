const EnterpriseAuth = require('../../core/enterpriseAuth');
const { DatabaseAuthStore, MemoryAuthStore } = require('../../core/authStore');

const JWT_SECRET = 'test-enterprise-access-secret-32-characters';
const REFRESH_SECRET = 'test-enterprise-refresh-secret-32-characters';

describe('EnterpriseAuth', () => {
  it('selects memory or database auth stores from constructor config', () => {
    const memoryAuth = new EnterpriseAuth({
      jwtSecret: JWT_SECRET,
      refreshTokenSecret: REFRESH_SECRET,
    });
    expect(memoryAuth.store).toBeInstanceOf(MemoryAuthStore);

    const knex = jest.fn();
    const databaseAuth = new EnterpriseAuth({
      jwtSecret: JWT_SECRET,
      refreshTokenSecret: REFRESH_SECRET,
      knex,
    });
    expect(databaseAuth.store).toBeInstanceOf(DatabaseAuthStore);
    expect(databaseAuth.store.knex).toBe(knex);
  });

  it('registers OAuth2 providers and generates authorization data', async () => {
    const auth = new EnterpriseAuth();
    auth.registerOAuth2Provider('github', {
      clientId: 'client',
      clientSecret: 'secret',
      authorizationUrl: 'https://auth.example/authorize',
      tokenUrl: 'https://auth.example/token',
      userInfoUrl: 'https://auth.example/user',
      redirectUri: 'https://app.example/callback',
      scopes: ['openid', 'email'],
    });

    const authUrl = await auth.getOAuth2AuthUrl('github');
    const parsedUrl = new URL(authUrl.url);

    expect(parsedUrl.searchParams.get('client_id')).toBe('client');
    expect(parsedUrl.searchParams.get('scope')).toBe('openid email');
    expect(authUrl.state).toHaveLength(64);

    // Updated assertions from main branch for PKCE
    expect(authUrl.codeChallenge).toHaveLength(43);
    expect(authUrl.codeVerifier).toBeDefined();
    expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');

    await expect(auth.getOAuth2AuthUrl('missing')).rejects.toThrow('not configured');
  });

  it('generates PKCE verifier/challenge pair compliant with RFC 7636', () => {
    const auth = new EnterpriseAuth();
    const pair = auth.generatePKCEPair();

    expect(pair.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);

    expect(pair.codeChallenge).toHaveLength(43);
    expect(pair.codeChallenge).toMatch(/^[A-Za-z0-9\-._~]+$/);

    const expectedChallenge = require('crypto')
      .createHash('sha256')
      .update(pair.codeVerifier)
      .digest('base64url');
    expect(pair.codeChallenge).toBe(expectedChallenge);
  });

  it('includes correct PKCE params in the authorization URL', async () => {
    const auth = new EnterpriseAuth();
    auth.registerOAuth2Provider('google', {
      clientId: 'cid',
      clientSecret: 'cs',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      redirectUri: 'https://app.example/callback',
      scopes: ['openid', 'email', 'profile'],
    });

    const authUrl = await auth.getOAuth2AuthUrl('google');
    const parsedUrl = new URL(authUrl.url);

    expect(parsedUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsedUrl.searchParams.get('code_challenge')).toBeTruthy();

    const expectedChallenge = require('crypto')
      .createHash('sha256')
      .update(authUrl.codeVerifier)
      .digest('base64url');
    expect(authUrl.codeChallenge).toBe(expectedChallenge);
  });

  it('generates MFA secrets, verifies TOTP, and consumes backup codes once', async () => {
    const auth = new EnterpriseAuth();
    const mfa = await auth.generateMFASecret('u1');

    // Read secret data from the store to derive the TOTP token for verification
    const mfaData = await auth.store.getMfaSecret('u1');
    const decoder = new (require('base32.js').Decoder)();
    const secret = decoder.write(mfaData.secret).finalize();
    const token = auth.generateTOTPToken(
      secret,
      Math.floor(Date.now() / 1000 / auth.config.mfaWindow)
    );

    expect(mfa.qrUrl).toContain('otpauth://totp/u1');
    expect(await auth.verifyTOTP('u1', token)).toBe(true);
    expect(await auth.enableMFA('u1', token)).toEqual({
      success: true,
      backupCodes: mfa.backupCodes,
    });

    const backupCode = mfa.backupCodes[0];
    expect(await auth.verifyBackupCode('u1', backupCode.toLowerCase())).toBe(true);
    expect(await auth.verifyBackupCode('u1', backupCode)).toBe(false); // already consumed
    await expect(auth.verifyTOTP('missing', token)).rejects.toThrow('MFA not configured');
  });

  it('creates, validates, expires, and logs out sessions', async () => {
    const store = new MemoryAuthStore();
    const auth = new EnterpriseAuth({ sessionTimeout: 10, store });
    const sessionId = await auth.createSession('u1', true);

    expect(await auth.validateSession(sessionId)).toEqual(
      expect.objectContaining({
        userId: 'u1',
        data: expect.objectContaining({
          mfaPending: true,
          mfaVerified: false,
        }),
      })
    );

    // Force the session to appear expired by saving it with a past expiresAt
    const session = await store.getSession(sessionId);
    await store.saveSession(
      sessionId,
      session.userId,
      session.data,
      new Date(Date.now() - 100) // already expired
    );
    await expect(auth.validateSession(sessionId)).rejects.toThrow('Session expired');

    const nextSession = await auth.createSession('u1');
    await auth.logout(nextSession);
    await expect(auth.validateSession(nextSession)).rejects.toThrow('Session expired');
  });

  it('generates, verifies, refreshes, and rejects mismatched JWT token types', async () => {
    const auth = new EnterpriseAuth({
      jwtSecret: 'shared-test-secret',
      refreshTokenSecret: 'shared-test-secret',
      accessTokenExpiry: '1h',
      refreshTokenExpiry: '1h',
    });
    const sessionId = await auth.createSession('u1');
    const tokens = auth.generateTokens('u1', sessionId);

    expect(auth.verifyToken(tokens.accessToken)).toEqual(
      expect.objectContaining({
        userId: 'u1',
        sessionId,
        type: 'access',
      })
    );
    expect(auth.verifyToken(tokens.refreshToken, 'refresh')).toEqual(
      expect.objectContaining({
        type: 'refresh',
      })
    );
    expect(auth.verifyToken(auth.refreshAccessToken(tokens.refreshToken))).toEqual(
      expect.objectContaining({
        type: 'access',
      })
    );
    expect(() => auth.verifyToken(tokens.refreshToken)).toThrow('Invalid token type');
    expect(() => auth.refreshAccessToken(tokens.accessToken)).toThrow('Failed to refresh token');
  });

  it('tracks lockouts, cleanup, and authentication statistics', async () => {
    const auth = new EnterpriseAuth({ sessionTimeout: 10 });
    await auth.checkLoginAttempts('u1');
    for (let i = 0; i < auth.maxLoginAttempts; i++) {
      await auth.recordFailedAttempt('u1');
    }

    await expect(auth.checkLoginAttempts('u1')).rejects.toThrow('Account locked');
    expect((await auth.getStats()).lockedAccounts).toBe(1);

    await auth.clearLoginAttempts('u1');
    expect(await auth.checkLoginAttempts('u1')).toBe(true);

    const sessionId = await auth.createSession('u1');
    // Force expiry via the store
    await auth.store.saveSession(sessionId, 'u1', {}, new Date(Date.now() - 100));
    await auth.cleanupSessions();
    expect(await auth.getStats()).toEqual(
      expect.objectContaining({
        activeSessions: 0,
        oauth2Providers: 0,
      })
    );
  });

  it('exchanges OAuth2 authorization code successfully', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    });

    const auth = new EnterpriseAuth({
      fetch: mockFetch,
    });

    auth.registerOAuth2Provider('github', {
      clientId: 'client',
      clientSecret: 'secret',
      authorizationUrl: 'https://auth.example/authorize',
      tokenUrl: 'https://auth.example/token',
      userInfoUrl: 'https://auth.example/user',
      redirectUri: 'https://app.example/callback',
    });

    const authUrl = await auth.getOAuth2AuthUrl('github');

    const result = await auth.exchangeOAuth2Code(
      'github',
      'auth-code',
      authUrl.codeVerifier,
      authUrl.state,
      'https://app.example/callback'
    );

    expect(result.access_token).toBe('access-token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends correct OAuth2 token exchange payload including PKCE verifier', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'token',
      }),
    });

    const auth = new EnterpriseAuth({
      fetch: mockFetch,
    });

    auth.registerOAuth2Provider('github', {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authorizationUrl: 'https://auth.example/authorize',
      tokenUrl: 'https://auth.example/token',
      userInfoUrl: 'https://auth.example/user',
      redirectUri: 'https://app.example/callback',
    });

    const authUrl = await auth.getOAuth2AuthUrl('github');

    await auth.exchangeOAuth2Code(
      'github',
      'oauth-code',
      authUrl.codeVerifier,
      authUrl.state,
      'https://app.example/callback'
    );

    const [url, options] = mockFetch.mock.calls[0];

    expect(url).toBe('https://auth.example/token');
    expect(options.method).toBe('POST');

    const body = options.body.toString();

    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('client_id=client-id');
    expect(body).toContain('client_secret=client-secret');
    expect(body).toContain('code=oauth-code');
    expect(body).toContain('code_verifier=');
  });

  it('handles OAuth provider error responses', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'invalid_grant',
      }),
    });

    const auth = new EnterpriseAuth({
      fetch: mockFetch,
    });

    auth.registerOAuth2Provider('github', {
      clientId: 'client',
      clientSecret: 'secret',
      authorizationUrl: 'https://auth.example/authorize',
      tokenUrl: 'https://auth.example/token',
      userInfoUrl: 'https://auth.example/user',
      redirectUri: 'https://app.example/callback',
    });

    const authUrl = await auth.getOAuth2AuthUrl('github');

    await expect(
      auth.exchangeOAuth2Code(
        'github',
        'bad-code',
        authUrl.codeVerifier,
        authUrl.state,
        'https://app.example/callback'
      )
    ).rejects.toThrow('invalid_grant');
  });

  it('handles OAuth token exchange network failures', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('network unavailable'));

    const auth = new EnterpriseAuth({
      fetch: mockFetch,
    });

    auth.registerOAuth2Provider('github', {
      clientId: 'client',
      clientSecret: 'secret',
      authorizationUrl: 'https://auth.example/authorize',
      tokenUrl: 'https://auth.example/token',
      userInfoUrl: 'https://auth.example/user',
      redirectUri: 'https://app.example/callback',
    });

    const authUrl = await auth.getOAuth2AuthUrl('github');

    await expect(
      auth.exchangeOAuth2Code(
        'github',
        'auth-code',
        authUrl.codeVerifier,
        authUrl.state,
        'https://app.example/callback'
      )
    ).rejects.toThrow('network unavailable');
  });
});
