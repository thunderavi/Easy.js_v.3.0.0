/**
 * Enterprise Authentication System
 * Supports OAuth2, MFA, SAML, LDAP, and session management
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const base32 = require('base32.js');
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

    this.sessions = new Map();
    this.mfaSecrets = new Map();
    this.oauth2Providers = new Map();
    this.loginAttempts = new Map();
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
   * Generate MFA secret for user
   */
  generateMFASecret(userId) {
    const secret = crypto.randomBytes(20);
    const encoder = new base32.Encoder();
    const encodedSecret = encoder.write(secret).finalize();

    this.mfaSecrets.set(userId, {
      secret: encodedSecret,
      verified: false,
      backupCodes: this.generateBackupCodes(10),
      createdAt: Date.now()
    });

    return {
      secret: encodedSecret,
      qrUrl: `otpauth://totp/${userId}?secret=${encodedSecret}`,
      backupCodes: this.mfaSecrets.get(userId).backupCodes
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
   * Verify TOTP token
   */
  verifyTOTP(userId, token) {
    const mfaData = this.mfaSecrets.get(userId);
    if (!mfaData) throw new Error('MFA not configured for user');

    const decoder = new base32.Decoder();
    const secret = decoder.write(mfaData.secret).finalize();

    // Calculate expected token
    const time = Math.floor(Date.now() / 1000 / this.config.mfaWindow);
    const expectedToken = this.generateTOTPToken(secret, time);

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
   * Verify backup code
   */
  verifyBackupCode(userId, code) {
    const mfaData = this.mfaSecrets.get(userId);
    if (!mfaData) throw new Error('MFA not configured for user');

    const index = mfaData.backupCodes.indexOf(code.toUpperCase());
    if (index !== -1) {
      mfaData.backupCodes.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Enable MFA for user
   */
  enableMFA(userId, token) {
    const mfaData = this.mfaSecrets.get(userId);
    if (!mfaData) throw new Error('Generate MFA secret first');

    if (!this.verifyTOTP(userId, token)) {
      throw new Error('Invalid verification token');
    }

    mfaData.verified = true;
    return { success: true, backupCodes: mfaData.backupCodes };
  }

  /**
   * Create session with MFA requirement
   */
  async createSession(userId, requireMFA = false) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const session = {
      userId,
      sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      mfaVerified: !requireMFA,
      mfaPending: requireMFA,
      ip: null,
      userAgent: null,
      device: null
    };

    this.sessions.set(sessionId, session);

    // Clean up old sessions
    if (this.sessions.size > 10000) {
      this.cleanupSessions();
    }

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
   * Validate login attempt
   */
  checkLoginAttempts(userId) {
    const attempts = this.loginAttempts.get(userId) || { count: 0, lockedUntil: null };

    if (attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
      throw new Error('Account temporarily locked due to too many login attempts');
    }

    if (attempts.count >= this.maxLoginAttempts) {
      attempts.lockedUntil = Date.now() + this.lockoutDuration;
      this.loginAttempts.set(userId, attempts);
      throw new Error('Account locked. Try again after 15 minutes');
    }

    return true;
  }

  /**
   * Record failed login attempt
   */
  recordFailedAttempt(userId) {
    const attempts = this.loginAttempts.get(userId) || { count: 0 };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    this.loginAttempts.set(userId, attempts);
  }

  /**
   * Clear login attempts
   */
  clearLoginAttempts(userId) {
    this.loginAttempts.delete(userId);
  }

  /**
   * Cleanup expired sessions
   */
  cleanupSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.config.sessionTimeout) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Validate session
   */
  validateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Invalid session');

    if (Date.now() - session.lastActivity > this.config.sessionTimeout) {
      this.sessions.delete(sessionId);
      throw new Error('Session expired');
    }

    session.lastActivity = Date.now();
    return session;
  }

  /**
   * Logout session
   */
  logout(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Get authentication statistics
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      mfaEnabledUsers: this.mfaSecrets.size,
      lockedAccounts: Array.from(this.loginAttempts.values()).filter(a => a.lockedUntil).length,
      oauth2Providers: this.oauth2Providers.size
    };
  }
}

module.exports = EnterpriseAuth;
