const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Logger = require('./logger');
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
    this.refreshTokens = new Map();
    this.passwordResetTokens = new Map();
    this.emailVerificationTokens = new Map();
  }

  initialize(authConfig) {
    this.config = authConfig;
    Logger.debug(`Auth initialized for model: ${authConfig.model}, type: ${authConfig.type}`);
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

  generateRefreshToken(userId, payload = {}) {
    const tokenId = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign(
      { userId, tokenId, ...payload },
      this.refreshSecret,
      { expiresIn: this.refreshExpiry }
    );
    this.refreshTokens.set(tokenId, {
      userId,
      revoked: false,
      createdAt: Date.now()
    });
    return token;
  }

  issueTokenPair(userId, payload = {}) {
    return {
      accessToken: this.generateToken(userId, payload),
      refreshToken: this.generateRefreshToken(userId, payload),
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

  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshSecret);
      const record = this.refreshTokens.get(decoded.tokenId);
      if (!record || record.revoked) {
        throw new Error('Refresh token revoked');
      }
      return decoded;
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error.message}`);
    }
  }

  rotateRefreshToken(refreshToken, payload = {}) {
    const decoded = this.verifyRefreshToken(refreshToken);
    this.revokeRefreshToken(decoded.tokenId);
    return this.issueTokenPair(decoded.userId, payload);
  }

  revokeRefreshToken(tokenOrId) {
    let tokenId = tokenOrId;
    try {
      tokenId = jwt.decode(tokenOrId)?.tokenId || tokenOrId;
    } catch {
      tokenId = tokenOrId;
    }
    const record = this.refreshTokens.get(tokenId);
    if (record) {
      record.revoked = true;
      record.revokedAt = Date.now();
    }
    return Boolean(record);
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
      const tokens = this.issueTokenPair(userId, { email: user.email, role: user.role });

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
      const tokens = this.issueTokenPair(userId, { email: user.email, role: user.role });

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

  createPasswordResetToken(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    this.passwordResetTokens.set(token, {
      userId,
      expiresAt: Date.now() + this.resetTokenExpiryMs,
      used: false
    });
    return token;
  }

  async resetPassword(token, newPassword, db = null) {
    const record = this.passwordResetTokens.get(token);
    if (!record || record.used || record.expiresAt < Date.now()) {
      throw new Error('Password reset token is invalid or expired');
    }

    const hashedPassword = await this.hashPassword(newPassword);
    record.used = true;
    record.usedAt = Date.now();

    if (db && this.config?.model) {
      await db.query(this.config.model, 'update', {
        id: record.userId,
        password: hashedPassword
      });
    }

    return { success: true, userId: record.userId };
  }

  createEmailVerificationToken(userId, email) {
    const token = crypto.randomBytes(32).toString('hex');
    this.emailVerificationTokens.set(token, {
      userId,
      email,
      expiresAt: Date.now() + this.verificationTokenExpiryMs,
      used: false
    });
    return token;
  }

  async verifyEmail(token, db = null) {
    const record = this.emailVerificationTokens.get(token);
    if (!record || record.used || record.expiresAt < Date.now()) {
      throw new Error('Email verification token is invalid or expired');
    }

    record.used = true;
    record.usedAt = Date.now();

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
