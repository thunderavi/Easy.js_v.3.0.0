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

  // Parameterized tests to ensure OAuth logic holds up regardless of the storage backend
  describe.each([
    ['MemoryAuthStore', () => new MemoryAuthStore()],
    [
      'DatabaseAuthStore',
      () => {
        const mockKnex = jest.fn();
        const store = new DatabaseAuthStore({ knex: mockKnex });

        // Stubbing the DB methods with an in-memory map so the unit tests can execute
        // without requiring a live database connection during the test suite run.
        const mockDb = new Map();
        store.saveOAuthState = jest.fn(async (state, data, expiresAt) => {
          mockDb.set(state, { ...data, expiresAt });
        });
        store.getOAuthState = jest.fn(async (state) => {
          const record = mockDb.get(state);
          if (!record || (record.expiresAt && record.expiresAt < new Date())) return null;
          return record;
        });
        store.deleteOAuthState = jest.fn(async (state) => {
          mockDb.delete(state);
        });

        return store;
      },
    ],
  ])('OAuth state flows with %s', (storeName, createStore) => {
    it('validates OAuth state, prevents replays, and rejects mismatched/expired state', async () => {
      const store = createStore();
      const auth = new EnterpriseAuth({ store });
      const validRedirectUri = 'https://app.example/callback';

      auth.registerOAuth2Provider('google', {
        clientId: 'client',
        clientSecret: 'secret',
        authorizationUrl: 'https://auth.example/authorize',
        tokenUrl: 'https://auth.example/token',
        userInfoUrl: 'https://auth.example/user',
        redirectUri: validRedirectUri,
        scopes: ['openid'],
      });

      // Generate valid state
      const authUrl = await auth.getOAuth2AuthUrl('google');
      const validState = authUrl.state;
      // Extracting verifier from the new object returned by the merged code
      const validVerifier = authUrl.codeVerifier;

      // 1. Valid State Verification & Replay Prevention
      const successResponse = await auth.exchangeOAuth2Code(
        'google',
        'mock-code',
        validVerifier,
        validState,
        validRedirectUri
      );
      expect(successResponse).toHaveProperty('access_token');

      // The second exchange with the exact same state MUST fail (consumed/replay attack)
      await expect(
        auth.exchangeOAuth2Code('google', 'mock-code', validVerifier, validState, validRedirectUri)
      ).rejects.toThrow('Invalid, missing, or expired OAuth state');

      // 2. Missing State Verification
      await expect(
        auth.exchangeOAuth2Code(
          'google',
          'mock-code',
          validVerifier,
          'non-existent-state',
          validRedirectUri
        )
      ).rejects.toThrow('Invalid, missing, or expired OAuth state');

      // 3. Provider Mismatch Verification
      auth.registerOAuth2Provider('github', {
        clientId: 'github-client',
        authorizationUrl: 'https://github.example/authorize',
        redirectUri: '...',
        scopes: [],
      });
      const githubUrl = await auth.getOAuth2AuthUrl('github');

      // Try to use a valid github state on the google provider
      await expect(
        auth.exchangeOAuth2Code(
          'google',
          'mock-code',
          githubUrl.codeVerifier,
          githubUrl.state,
          '...'
        )
      ).rejects.toThrow('OAuth state provider mismatch');

      // 4. Redirect URI Mismatch Verification
      const uriAuthUrl = await auth.getOAuth2AuthUrl('google');
      await expect(
        auth.exchangeOAuth2Code(
          'google',
          'mock-code',
          uriAuthUrl.codeVerifier,
          uriAuthUrl.state,
          'https://wrong-uri.example/'
        )
      ).rejects.toThrow('Redirect URI mismatch');

      // 5. PKCE Mismatch Verification
      const pkceAuthUrl = await auth.getOAuth2AuthUrl('google');
      await expect(
        auth.exchangeOAuth2Code(
          'google',
          'mock-code',
          'invalid-verifier',
          pkceAuthUrl.state,
          validRedirectUri
        )
      ).rejects.toThrow('PKCE verification failed');

      // 6. Expired State Verification
      const expiredState = 'expired-state-hash';
      // Manually force an expired state directly into the store to simulate a timeout
      await auth.store.saveOAuthState(
        expiredState,
        { provider: 'google', codeChallenge: 'mock-challenge' },
        new Date(Date.now() - 1000)
      );

      await expect(
        auth.exchangeOAuth2Code(
          'google',
          'mock-code',
          'mock-challenge',
          expiredState,
          validRedirectUri
        )
      ).rejects.toThrow('Invalid, missing, or expired OAuth state');
    });
  });
});
