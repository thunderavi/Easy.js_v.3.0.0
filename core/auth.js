const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Logger = require('./logger');
const { createAuthStore } = require('./authStore');
const { validateJwtSecret } = require('./jwtSecretValidator');

class AuthManager {
  constructor(options = {}) {
    this.config = null;
    this.jwtSecret = validateJwtSecret(
      options.jwtSecret || process.env.JWT_SECRET,
      'JWT_SECRET'
    );
    this.jwtExpiry = options.jwtExpiry || process.env.JWT_EXPIRY || '15m';
    this.refreshSecret = validateJwtSecret(
      options.refreshSecret || process.env.JWT_REFRESH_SECRET,
      'JWT_REFRESH_SECRET'
    );
    this.refreshExpiry = options.refreshExpiry || process.env.JWT_REFRESH_EXPIRY || '7d';
    this.resetTokenExpiryMs = options.resetTokenExpiryMs || 60 * 60 * 1000;
    this.verificationTokenExpiryMs = options.verificationTokenExpiryMs || 24 * 60 * 60 * 1000;
    // Pluggable auth store — defaults to MemoryAuthStore for dev/tests.
    // Pass options.store = new DatabaseAuthStore({ knex }) for production.
    this.store = options.store || createAuthStore(options);

    this.cleanupIntervalMs = options.cleanupIntervalMs !== undefined ? options.cleanupIntervalMs : 3600000; // default 1 hour
    this._cleanupTimer = null;
    if (this.cleanupIntervalMs > 0) {
      this.startCleanup();
    }
  }

  initialize(authConfig) {
    this.config = authConfig;
    Logger.debug(`Auth initialized for model: ${authConfig.model}, type: ${authConfig.type}`);
  }

  /**
   * Perform cleanup of expired/revoked tokens and sessions.
   * Delegates to the underlying auth store.
   */
  async cleanupExpired() {
    if (this.store && typeof this.store.cleanupExpired === 'function') {
      try {
        return await this.store.cleanupExpired();
      } catch (error) {
        Logger.error(`Error during token cleanup: ${error.message}`);
      }
    }
    return { removed: 0 };
  }

  /**
   * Starts the background interval to clean up expired tokens.
   */
  startCleanup() {
    if (this._cleanupTimer) {
      this.stopCleanup();
    }
    if (this.cleanupIntervalMs > 0) {
      this._cleanupTimer = setInterval(() => {
        this.cleanupExpired().catch(err => {
          Logger.error(`Unhandled error in auth cleanup interval: ${err.message}`);
        });
      }, this.cleanupIntervalMs);
      
      // Prevent the timer from keeping the Node process alive indefinitely
      if (this._cleanupTimer.unref) {
        this._cleanupTimer.unref();
      }
    }
  }

  /**
   * Stops the background interval for cleaning up expired tokens.
   */
  stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  async hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  generateToken(userId, payload = {}) {
    return jwt.sign(
      { userId, ...payload },
      this.jwtSecret,
      { expiresIn: this.jwtExpiry }
    );
  }

  /**
   * Generate a signed refresh JWT and persist its tokenId in the auth store.
   * NOW ASYNC — callers must await.
   */
  async generateRefreshToken(userId, payload = {}) {
    const tokenId = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign(
      { userId, tokenId, ...payload },
      this.refreshSecret,
      { expiresIn: this.refreshExpiry }
    );
    // Derive expiresAt from the JWT itself so the store and the token agree.
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000);
    await this.store.saveRefreshToken(tokenId, userId, expiresAt);
    return token;
  }

  /**
   * Issue an access + refresh token pair.
   * NOW ASYNC — callers must await.
   */
  async issueTokenPair(userId, payload = {}) {
    return {
      accessToken: this.generateToken(userId, payload),
      refreshToken: await this.generateRefreshToken(userId, payload),
      tokenType: 'Bearer',
      expiresIn: this.jwtExpiry
    };
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error(`Invalid token: ${error.message}`);
    }
  }

  /**
   * Verify a refresh JWT and confirm it has not been revoked via the store.
   * NOW ASYNC — callers must await.
   */
  async verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshSecret);
      const record = await this.store.getRefreshToken(decoded.tokenId);
      if (!record) {
        throw new Error('Refresh token revoked');
      }
      return decoded;
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error.message}`);
    }
  }

  /**
   * Rotate a refresh token: revoke the old one and issue a fresh pair.
   * NOW ASYNC — callers must await.
   */
  async rotateRefreshToken(refreshToken, payload = {}) {
    const decoded = await this.verifyRefreshToken(refreshToken);
    await this.revokeRefreshToken(decoded.tokenId);
    return this.issueTokenPair(decoded.userId, payload);
  }

  /**
   * Revoke a refresh token by its tokenId or by decoding a full JWT.
   * NOW ASYNC — callers must await.
   */
  async revokeRefreshToken(tokenOrId) {
    let tokenId = tokenOrId;
    try {
      tokenId = jwt.decode(tokenOrId)?.tokenId || tokenOrId;
    } catch {
      tokenId = tokenOrId;
    }
    await this.store.revokeRefreshToken(tokenId);
    return true;
  }

  jwtMiddleware() {
    return (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Missing or invalid authorization header'
        });
      }

      const token = authHeader.slice(7);

      try {
        const decoded = this.verifyToken(token);
        req.user = decoded;
        next();
      } catch (error) {
        return res.status(403).json({
          success: false,
          error: 'Unauthorized: Invalid token'
        });
      }
    };
  }

  async loginUser(email, password, db) {
    if (!db) {
      throw new Error('Database not configured for authentication');
    }

    try {
      const user = await db.query(this.config.model, 'findOne', null, {
        filter: { email }
      });

      if (!user) {
        throw new Error('User not found');
      }

      const isValid = await this.comparePassword(password, user.password);

      if (!isValid) {
        throw new Error('Invalid password');
      }

      const userId = user.id || user._id;
      const tokens = await this.issueTokenPair(userId, { email: user.email, role: user.role });

      return {
        success: true,
        token: tokens.accessToken,
        tokens,
        user: {
          id: userId,
          email: user.email,
          name: user.name || undefined,
          role: user.role || undefined
        }
      };
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  async registerUser(userData, db) {
    if (!db) {
      throw new Error('Database not configured for authentication');
    }

    try {
      // Hash password
      userData.password = await this.hashPassword(userData.password);

      const user = await db.query(this.config.model, 'create', userData);

      const userId = user.id || user._id;
      const tokens = await this.issueTokenPair(userId, { email: user.email, role: user.role });

      return {
        success: true,
        token: tokens.accessToken,
        tokens,
        user: {
          id: userId,
          email: user.email,
          name: user.name || undefined,
          role: user.role || undefined
        }
      };
    } catch (error) {
      throw new Error(`Registration failed: ${error.message}`);
    }
  }

  /**
   * Generate a password reset token and persist it in the auth store.
   * NOW ASYNC — callers must await.
   * @returns {Promise<string>} The raw token to send to the user via email.
   */
  async createPasswordResetToken(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.resetTokenExpiryMs);
    await this.store.savePasswordResetToken(token, userId, expiresAt);
    return token;
  }

  async resetPassword(token, newPassword, db = null) {
    const record = await this.store.getPasswordResetToken(token);
    if (!record) {
      throw new Error('Password reset token is invalid or expired');
    }

    const hashedPassword = await this.hashPassword(newPassword);
    // Mark token as consumed
    await this.store.deletePasswordResetToken(token);

    if (db && this.config?.model) {
      await db.query(this.config.model, 'update', {
        id: record.userId,
        password: hashedPassword
      });
    }

    return { success: true, userId: record.userId };
  }

  /**
   * Generate an email verification token and persist it in the auth store.
   * NOW ASYNC — callers must await.
   * @returns {Promise<string>} The raw token to send to the user via email.
   */
  async createEmailVerificationToken(userId, email) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.verificationTokenExpiryMs);
    await this.store.saveEmailVerificationToken(token, userId, email, expiresAt);
    return token;
  }

  async verifyEmail(token, db = null) {
    const record = await this.store.getEmailVerificationToken(token);
    if (!record) {
      throw new Error('Email verification token is invalid or expired');
    }

    // Mark token as consumed
    await this.store.deleteEmailVerificationToken(token);

    if (db && this.config?.model) {
      await db.query(this.config.model, 'update', {
        id: record.userId,
        emailVerified: true,
        verifiedAt: new Date()
      });
    }

    return { success: true, userId: record.userId, email: record.email };
  }

  requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient role'
        });
      }
      next();
    };
  }
}

module.exports = AuthManager;
