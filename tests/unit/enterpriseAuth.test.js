const EnterpriseAuth = require('../../core/enterpriseAuth');
const { DatabaseAuthStore, MemoryAuthStore } = require('../../core/authStore');

const JWT_SECRET = 'test-enterprise-access-secret-32-characters';
const REFRESH_SECRET = 'test-enterprise-refresh-secret-32-characters';

describe('EnterpriseAuth', () => {
  it('selects memory or database auth stores from constructor config', () => {
    const memoryAuth = new EnterpriseAuth({
      jwtSecret: JWT_SECRET,
      refreshTokenSecret: REFRESH_SECRET
    });
    expect(memoryAuth.store).toBeInstanceOf(MemoryAuthStore);

    const knex = jest.fn();
    const databaseAuth = new EnterpriseAuth({
      jwtSecret: JWT_SECRET,
      refreshTokenSecret: REFRESH_SECRET,
      knex
    });
    expect(databaseAuth.store).toBeInstanceOf(DatabaseAuthStore);
    expect(databaseAuth.store.knex).toBe(knex);
  });

  it('registers OAuth2 providers and generates authorization data', () => {
    const auth = new EnterpriseAuth();
    auth.registerOAuth2Provider('github', {
      clientId: 'client',
      clientSecret: 'secret',
      authorizationUrl: 'https://auth.example/authorize',
      tokenUrl: 'https://auth.example/token',
      userInfoUrl: 'https://auth.example/user',
      redirectUri: 'https://app.example/callback',
      scopes: ['openid', 'email']
    });

    const authUrl = auth.getOAuth2AuthUrl('github');

    expect(authUrl.url).toContain('client_id=client');
    expect(authUrl.url).toContain('scope=openid email');
    expect(authUrl.state).toHaveLength(64);
    expect(authUrl.codeChallenge).toHaveLength(64);
    expect(() => auth.getOAuth2AuthUrl('missing')).toThrow('not configured');
  });

  it('generates MFA secrets, verifies TOTP, and consumes backup codes once', async () => {
    const auth = new EnterpriseAuth();
    const mfa = await auth.generateMFASecret('u1');

    // Read secret data from the store to derive the TOTP token for verification
    const mfaData = await auth.store.getMfaSecret('u1');
    const decoder = new (require('base32.js').Decoder)();
    const secret = decoder.write(mfaData.secret).finalize();
    const token = auth.generateTOTPToken(secret, Math.floor(Date.now() / 1000 / auth.config.mfaWindow));

    expect(mfa.qrUrl).toContain('otpauth://totp/u1');
    expect(await auth.verifyTOTP('u1', token)).toBe(true);
    expect(await auth.enableMFA('u1', token)).toEqual({ success: true, backupCodes: mfa.backupCodes });

    const backupCode = mfa.backupCodes[0];
    expect(await auth.verifyBackupCode('u1', backupCode.toLowerCase())).toBe(true);
    expect(await auth.verifyBackupCode('u1', backupCode)).toBe(false); // already consumed
    await expect(auth.verifyTOTP('missing', token)).rejects.toThrow('MFA not configured');
  });

  it('creates, validates, expires, and logs out sessions', async () => {
    const store = new MemoryAuthStore();
    const auth = new EnterpriseAuth({ sessionTimeout: 10, store });
    const sessionId = await auth.createSession('u1', true);

    expect(await auth.validateSession(sessionId)).toEqual(expect.objectContaining({
      userId: 'u1',
      data: expect.objectContaining({
        mfaPending: true,
        mfaVerified: false
      })
    }));

    // Force the session to appear expired by saving it with a past expiresAt
    const session = await store.getSession(sessionId);
    await store.saveSession(
      sessionId,
      session.userId,
      session.data,
      new Date(Date.now() - 100) // already expired
    );
    // The original non-expired record is shadowed by overwriting — but Map keys are unique.
    // Re-save with the same key so getSession returns null.
    await expect(auth.validateSession(sessionId)).rejects.toThrow('Session expired');

    const nextSession = await auth.createSession('u1');
    await auth.logout(nextSession);
    // After logout the session is revoked (revokedAt set), so it's 'Session expired'
    await expect(auth.validateSession(nextSession)).rejects.toThrow('Session expired');
  });

  it('generates, verifies, refreshes, and rejects mismatched JWT token types', async () => {
    const auth = new EnterpriseAuth({
      jwtSecret: 'shared-test-secret',
      refreshTokenSecret: 'shared-test-secret',
      accessTokenExpiry: '1h',
      refreshTokenExpiry: '1h'
    });
    const sessionId = await auth.createSession('u1');
    const tokens = auth.generateTokens('u1', sessionId);

    expect(auth.verifyToken(tokens.accessToken)).toEqual(expect.objectContaining({
      userId: 'u1',
      sessionId,
      type: 'access'
    }));
    expect(auth.verifyToken(tokens.refreshToken, 'refresh')).toEqual(expect.objectContaining({
      type: 'refresh'
    }));
    expect(auth.verifyToken(auth.refreshAccessToken(tokens.refreshToken))).toEqual(expect.objectContaining({
      type: 'access'
    }));
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
    await auth.store.saveSession(
      sessionId,
      'u1',
      {},
      new Date(Date.now() - 100)
    );
    await auth.cleanupSessions();
    expect(await auth.getStats()).toEqual(expect.objectContaining({
      activeSessions: 0,
      oauth2Providers: 0
    }));
  });
});
