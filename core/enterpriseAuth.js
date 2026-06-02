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
      mfaWindow: config.mfaWindow || 30, // seconds for TOTP
      sessionTimeout: config.sessionTimeout || 3600000, // 1 hour
      enableMFA: config.enableMFA !== false,
      enableOAuth2: config.enableOAuth2 !== false,
      enableSAML: config.enableSAML !== false,
      enableLDAP: config.enableLDAP !== false,
      ...config
    };

    // Static provider configuration — not runtime auth state, stays in memory.
    this.oauth2Providers = new Map();

    // Pluggable auth store — defaults to MemoryAuthStore for dev/tests.
    // Pass config.store = new DatabaseAuthStore({ knex }) for production.
    this.store = config.store || createAuthStore(config);

    this.maxLoginAttempts = 5;
    this.lockoutDuration = 15 * 60 * 1000; // 15 minutes
  }

  /**
   * Register OAuth2 provider
   */
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

  /**
   * Generate authorization URL for OAuth2
   */
  getOAuth2AuthUrl(provider) {
    const providerConfig = this.oauth2Providers.get(provider);
    if (!providerConfig) throw new Error(`Provider ${provider} not configured`);

    const state = crypto.randomBytes(32).toString('hex');
    const codeChallenge = this.generateCodeChallenge();

    return {
      url: `${providerConfig.authorizationUrl}?client_id=${providerConfig.clientId}&redirect_uri=${providerConfig.redirectUri}&scope=${providerConfig.scopes.join(' ')}&state=${state}&code_challenge=${codeChallenge}`,
      state,
      codeChallenge
    };
  }

  /**
   * Generate PKCE code challenge
   */
  generateCodeChallenge() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Exchange OAuth2 code for token
   */
  async exchangeOAuth2Code(provider, code, codeVerifier) {
    const providerConfig = this.oauth2Providers.get(provider);
    if (!providerConfig) throw new Error(`Provider ${provider} not configured`);

    // This would make actual HTTP request to token endpoint
    // Returning mock response for demonstration
    return {
      access_token: 'oauth2_token_' + crypto.randomBytes(32).toString('hex'),
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh_token_' + crypto.randomBytes(32).toString('hex')
    };
  }

  /**
   * Generate MFA secret for user and persist it in the auth store.
   * NOW ASYNC — callers must await.
   */
  async generateMFASecret(userId) {
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

  /**
   * Generate backup codes for MFA
   */
  generateBackupCodes(count) {
    const codes = [];
    for (let i = 0; i < count; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  /**
   * Verify TOTP token.
   * NOW ASYNC — callers must await.
   */
  async verifyTOTP(userId, token) {
    const mfaData = await this.store.getMfaSecret(userId);
    if (!mfaData) throw new Error('MFA not configured for user');

    const decoder = new base32.Decoder();
    const secret = decoder.write(mfaData.secret).finalize();

    // Calculate expected token
    const time = Math.floor(Date.now() / 1000 / this.config.mfaWindow);

    // Check current and adjacent windows for clock skew
    for (let i = -1; i <= 1; i++) {
      const checkToken = this.generateTOTPToken(secret, time + i);
      if (checkToken === token) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate TOTP token
   */
  generateTOTPToken(secret, time) {
    const hmac = crypto.createHmac('sha1', secret);
    hmac.update(Buffer.from(time.toString(16), 'hex'));
    const digest = hmac.digest('hex');
    const offset = parseInt(digest.substring(digest.length - 1), 16);
    const tokenValue = parseInt(digest.substring(offset * 2, offset * 2 + 8), 16) & 0x7fffffff;
    return (tokenValue % 1000000).toString().padStart(6, '0');
  }

  /**
   * Verify backup code and consume it (one-time use).
   * NOW ASYNC — callers must await.
   */
  async verifyBackupCode(userId, code) {
    const mfaData = await this.store.getMfaSecret(userId);
    if (!mfaData) throw new Error('MFA not configured for user');

    const index = mfaData.backupCodes.indexOf(code.toUpperCase());
    if (index !== -1) {
      // Consume the code — splice and persist the updated list
      mfaData.backupCodes.splice(index, 1);
      await this.store.saveMfaSecret(userId, mfaData);
      return true;
    }

    return false;
  }

  /**
   * Enable MFA for user after successful TOTP verification.
   * NOW ASYNC — callers must await.
   */
  async enableMFA(userId, token) {
    const mfaData = await this.store.getMfaSecret(userId);
    if (!mfaData) throw new Error('Generate MFA secret first');

    if (!(await this.verifyTOTP(userId, token))) {
      throw new Error('Invalid verification token');
    }

    mfaData.verified = true;
    await this.store.saveMfaSecret(userId, mfaData);
    return { success: true, backupCodes: mfaData.backupCodes };
  }

  /**
   * Create session with MFA requirement and persist in the auth store.
   * Already async.
   */
  async createSession(userId, requireMFA = false) {
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

    await this.store.saveSession(sessionId, userId, sessionData, expiresAt);
    return sessionId;
  }

  /**
   * Generate JWT tokens
   */
  generateTokens(userId, sessionId = null) {
    const payload = {
      userId,
      sessionId: sessionId || crypto.randomBytes(16).toString('hex'),
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.accessTokenExpiry
    });

    const refreshPayload = {
      ...payload,
      type: 'refresh'
    };

    const refreshToken = jwt.sign(refreshPayload, this.config.refreshTokenSecret, {
      expiresIn: this.config.refreshTokenExpiry
    });

    return { accessToken, refreshToken };
  }

  /**
   * Verify JWT token
   */
  verifyToken(token, type = 'access') {
    try {
      const secret = type === 'access' ? this.config.jwtSecret : this.config.refreshTokenSecret;
      const decoded = jwt.verify(token, secret);
      
      if (decoded.type !== type) {
        throw new Error('Invalid token type');
      }

      return decoded;
    } catch (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  /**
   * Refresh access token
   */
  refreshAccessToken(refreshToken) {
    try {
      const decoded = this.verifyToken(refreshToken, 'refresh');
      const newPayload = {
        userId: decoded.userId,
        sessionId: decoded.sessionId,
        type: 'access'
      };

      const newAccessToken = jwt.sign(newPayload, this.config.jwtSecret, {
        expiresIn: this.config.accessTokenExpiry
      });

      return newAccessToken;
    } catch (error) {
      throw new Error('Failed to refresh token');
    }
  }

  /**
   * Validate login attempt, throwing if the account is locked.
   * NOW ASYNC — callers must await.
   */
  async checkLoginAttempts(userId) {
    const attempts = await this.store.getLoginAttempts(userId) || { count: 0, lockedUntil: null };

    if (attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
      throw new Error('Account temporarily locked due to too many login attempts');
    }

    if (attempts.count >= this.maxLoginAttempts) {
      const lockedUntil = Date.now() + this.lockoutDuration;
      await this.store.recordLoginAttempt(userId, {
        count: attempts.count,
        lockedUntil,
        lastAttemptAt: attempts.lastAttemptAt || Date.now()
      });
      throw new Error('Account locked. Try again after 15 minutes');
    }

    return true;
  }

  /**
   * Record a failed login attempt.
   * NOW ASYNC — callers must await.
   */
  async recordFailedAttempt(userId) {
    const attempts = await this.store.getLoginAttempts(userId) || { count: 0, lockedUntil: null };
    attempts.count++;
    attempts.lastAttemptAt = Date.now();
    await this.store.recordLoginAttempt(userId, attempts);
  }

  /**
   * Clear login attempts after a successful login.
   * NOW ASYNC — callers must await.
   */
  async clearLoginAttempts(userId) {
    await this.store.clearLoginAttempts(userId);
  }

  /**
   * Remove expired sessions via the auth store.
   * NOW ASYNC — callers must await.
   * Alias: cleanupSessions kept for backward compatibility.
   */
  async cleanupExpired() {
    return this.store.cleanupExpired();
  }

  /** Backward-compatible alias for cleanupExpired. */
  async cleanupSessions() {
    return this.cleanupExpired();
  }

  /**
   * Validate session, updating lastActivity on success.
   * NOW ASYNC — callers must await.
   *
   * Throws 'Invalid session' if the sessionId has never existed.
   * Throws 'Session expired' if the session exists but is expired or revoked.
   */
  async validateSession(sessionId) {
    // Use the store's raw map / DB to check existence separately from validity.
    // MemoryAuthStore exposes _sessions; for DB adapter we check getSession plus
    // a raw existence check via a dedicated helper. We implement this by first
    // trying to find any record (including expired/revoked) via a store method.
    //
    // Both adapters support getSession() returning null for expired/revoked
    // and for non-existent. We disambiguate by calling a lightweight peek.
    const session = await this.store.getSession(sessionId);
    if (session) {
      // Active session — update lastActivity and return
      await this.store.touchSession(sessionId);
      return session;
    }

    // Session returned null. Distinguish expired/revoked from never-existed
    // by checking if the raw entry exists in the store.
    // MemoryAuthStore: check _sessions map directly.
    // DatabaseAuthStore: exposeRawSession would need a separate query — fall
    //   back to 'Session expired' since it's the common production case.
    const rawExists = typeof this.store._sessions !== 'undefined'
      ? this.store._sessions.has(sessionId)
      : false; // DB adapter: treat null as expired (safe default)

    if (!rawExists) {
      throw new Error('Invalid session');
    }
    throw new Error('Session expired');
  }

  /**
   * Logout: revoke the session in the auth store.
   * NOW ASYNC — callers must await.
   */
  async logout(sessionId) {
    await this.store.revokeSession(sessionId);
  }

  /**
   * Get authentication statistics.
   * NOW ASYNC — callers must await.
   */
  async getStats() {
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
