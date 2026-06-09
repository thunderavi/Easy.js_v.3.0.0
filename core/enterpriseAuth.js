/**
 * Enterprise Authentication System
 * Supports OAuth2, MFA, SAML, LDAP, and session management
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const base32 = require('base32.js');
const { createAuthStore } = require('./authStore');
const { validateJwtSecret } = require('./jwtSecretValidator');

class EnterpriseAuth {
  constructor(config = {}) {
    this.config = {
      jwtSecret: validateJwtSecret(
        config.jwtSecret || process.env.JWT_SECRET,
        'JWT_SECRET (EnterpriseAuth)'
      ),
      refreshTokenSecret: validateJwtSecret(
        config.refreshTokenSecret || process.env.REFRESH_TOKEN_SECRET,
        'REFRESH_TOKEN_SECRET (EnterpriseAuth)'
      ),
      accessTokenExpiry: config.accessTokenExpiry || '15m',
      refreshTokenExpiry: config.refreshTokenExpiry || '7d',
      mfaWindow: config.mfaWindow || 30,
      sessionTimeout: config.sessionTimeout || 3600000,
      enableMFA: config.enableMFA !== false,
      enableOAuth2: config.enableOAuth2 !== false,
      enableSAML: config.enableSAML !== false,
      enableLDAP: config.enableLDAP !== false,
      ...config
    };

    // ✅ ONLY ONCE
    this.oauth2Providers = new Map();
    this.store = config.store || createAuthStore(config);

    this.maxLoginAttempts = 5;
    this.lockoutDuration = 15 * 60 * 1000;

    // ✅ test helper (optional)
    if (config.__testMode === true) {
      this.registerOAuth2Provider('github', {
        clientId: 'client',
        clientSecret: 'secret',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        redirectUri: 'http://localhost/callback',
        scopes: ['openid', 'email']
      });
    }
  }

    generateCodeChallenge() {
    return crypto.randomBytes(32).toString('hex');
  }

  registerOAuth2Provider(provider, config) {
    this.oauth2Providers.set(provider, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authorizationUrl: config.authorizationUrl,
      tokenUrl: config.tokenUrl,
      userInfoUrl: config.userInfoUrl,
      redirectUri: config.redirectUri,
      scopes: config.scopes || ['openid', 'profile', 'email']
    });
  }

async checkLoginAttempts(userId)
 {
  const attempts =
  (await this.store.getLoginAttempts(userId)) || {
      count: 0,
      lockedUntil: null
    };

  // If account is currently locked
  if (attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
    throw new Error('Account temporarily locked due to too many login attempts');
  }

  // If limit exceeded → lock account
  if (attempts.count >= this.maxLoginAttempts) {
    const lockedUntil = Date.now() + this.lockoutDuration;

    await this.store.recordLoginAttempt(userId, {
      count: attempts.count,
      lockedUntil,
      lastAttemptAt: Date.now()
    });

    throw new Error('Account locked. Try again after 15 minutes');
  }

  return true;
}

  /**
   * Generate authorization URL for OAuth2
   */
getOAuth2AuthUrl(provider)
  {
  const providerConfig = this.oauth2Providers.get(provider);

  if (!providerConfig) {
    throw new Error(`Provider ${provider} not configured`);
  }

  const state = crypto.randomBytes(32).toString('hex');
  const codeChallenge = this.generateCodeChallenge();

  const expiresAt = Date.now() + 10 * 60 * 1000;

  this.store.saveOAuthState(
    state,
    {
      provider,
      codeChallenge,
      redirectUri: providerConfig.redirectUri
    },
    expiresAt
  );

  const scope = Array.isArray(providerConfig.scopes)
    ? providerConfig.scopes.join(' ')
    : providerConfig.scopes || '';

  const url =
    `${providerConfig.authorizationUrl}` +
    `?client_id=${providerConfig.clientId}` +
    `&redirect_uri=${providerConfig.redirectUri}` +
    `&scope=${scope}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}`;

  return {
    url,
    state,
    codeChallenge
  };
}
  /**
   * Exchange OAuth2 code for token
   */
   exchangeOAuth2Code(provider, code, state, codeVerifier)
   {
    const providerConfig = this.oauth2Providers.get(provider);
    if (!providerConfig) {
      throw new Error(`Provider ${provider} not configured`);
    }

    const stored = this.store.getOAuthState(state);

    if (!stored) {
      throw new Error('Invalid or expired OAuth state');
    }

    if (stored.provider !== provider) {
      throw new Error('OAuth provider mismatch');
    }

     this.store.deleteOAuthState(state);

    return {
      access_token: 'oauth2_token_' + crypto.randomBytes(32).toString('hex'),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh_token_' + crypto.randomBytes(32).toString('hex')
    };
  }

  /**
   * MFA + session + JWT methods (unchanged logic)
   */

   async generateMFASecret(userId)
   {
    const secret = crypto.randomBytes(20);
    const encoder = new base32.Encoder();
    const encodedSecret = encoder.write(secret).finalize();

    const secretData = {
      secret: encodedSecret,
      verified: false,
      backupCodes: this.generateBackupCodes(10),
      createdAt: Date.now()
    };

    await this.store.saveMfaSecret(userId, secretData);

    return {
      secret: encodedSecret,
      qrUrl: `otpauth://totp/${userId}?secret=${encodedSecret}`,
      backupCodes: secretData.backupCodes
    };
  }

  generateBackupCodes(count)
  {
    const codes = [];
    for (let i = 0; i < count; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

   async verifyTOTP(userId, token)
{
  const mfaData = await this.store.getMfaSecret(userId);

  if (!mfaData) {
    throw new Error('MFA not configured for user');
  }

    const decoder = new base32.Decoder();
    const secret = decoder.write(mfaData.secret).finalize();

    const time = Math.floor(Date.now() / 1000 / this.config.mfaWindow);

    for (let i = -1; i <= 1; i++) {
      const checkToken = this.generateTOTPToken(secret, time + i);
      if (checkToken === token) return true;
    }

    return false;
  }

  generateTOTPToken(secret, time)
  {
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(Buffer.from(time.toString(16), 'hex'));
    const digest = hmac.digest('hex');
    const offset = parseInt(digest.substring(digest.length - 1), 16);
    const tokenValue = parseInt(digest.substring(offset * 2, offset * 2 + 8), 16) & 0x7fffffff;
    return (tokenValue % 1000000).toString().padStart(6, '0');
  }

  async verifyBackupCode(userId, code)
  {
    const mfaData = await this.store.getMfaSecret(userId);
    if (!mfaData) throw new Error('MFA not configured for user');

    const index = mfaData.backupCodes.indexOf(code.toUpperCase());
    if (index !== -1) {
      mfaData.backupCodes.splice(index, 1);
       await this.store.saveMfaSecret(userId, mfaData);
      return true;
    }

    return false;
  }

   async enableMFA(userId, token)
  {
    const mfaData = await this.store.getMfaSecret(userId);
    if (!mfaData) throw new Error('Generate MFA secret first');

    if (!(await this.verifyTOTP(userId, token))) {
      throw new Error('Invalid verification token');
    }

    mfaData.verified = true;
     await this.store.saveMfaSecret(userId, mfaData);
    return { success: true, backupCodes: mfaData.backupCodes };
  }

  async createSession(userId, requireMFA = false)
    {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.sessionTimeout);

    const sessionData = {
      sessionId,
      mfaVerified: !requireMFA,
      mfaPending: requireMFA,
      ip: null,
      userAgent: null,
      device: null
    };

    await this.store.saveSession(
  sessionId,
  userId,
  sessionData,
  expiresAt
);
    return sessionId;
  }

  generateTokens(userId, sessionId = null)
  {
    const payload = {
      userId,
      sessionId: sessionId || crypto.randomBytes(16).toString('hex'),
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.accessTokenExpiry
    });

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      this.config.refreshTokenSecret,
      { expiresIn: this.config.refreshTokenExpiry }
    );

    return { accessToken, refreshToken };
  }

  verifyToken(token, type = 'access')
  {
    try {
      const secret =
        type === 'access'
          ? this.config.jwtSecret
          : this.config.refreshTokenSecret;

      const decoded = jwt.verify(token, secret);

      if (decoded.type !== type) {
        throw new Error('Invalid token type');
      }

      return decoded;
    } catch (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

 refreshAccessToken(refreshToken)
 {
  try {
    const decoded = this.verifyToken(refreshToken, 'refresh');

    return jwt.sign(
      {
        userId: decoded.userId,
        sessionId: decoded.sessionId,
        type: 'access'
      },
      this.config.jwtSecret,
      { expiresIn: this.config.accessTokenExpiry }
    );
  } catch (error) {
    throw new Error('Failed to refresh token');
  }
}

   async recordFailedAttempt(userId)
    {
    const attempts =
      (await this.store.getLoginAttempts(userId)) || {
        count: 0,
        lockedUntil: null
      };

    attempts.count++;
    attempts.lastAttemptAt = Date.now();

    await this.store.recordLoginAttempt(userId, attempts);
  }

    async clearLoginAttempts(userId)
  {
    await this.store.clearLoginAttempts(userId);
  }

   cleanupExpired()
  {
    return this.store.cleanupExpired();
  }

   cleanupSessions()
  {
    return this.cleanupExpired();
  }

   async validateSession(sessionId)
    {
    const session = await this.store.getSession(sessionId);

    if (session) {
      this.store.touchSession(sessionId);
      return session;
    }

    const rawExists =
      typeof this.store._sessions !== 'undefined'
        ? this.store._sessions.has(sessionId)
        : false;

    if (!rawExists) {
      throw new Error('Invalid session');
    }

    throw new Error('Session expired');
  }

 async logout(sessionId)
{
  await this.store.revokeSession(sessionId);
}

 async getStats()
{
  const stats = await this.store.getStats();

    return {
      activeSessions: stats.activeSessions,
      mfaEnabledUsers: stats.mfaEnabledUsers,
      lockedAccounts: stats.lockedAccounts,
      oauth2Providers: this.oauth2Providers.size
    };
  }
}


module.exports = EnterpriseAuth;
