'use strict';

const { hashToken } = require('./tokenUtils');

/**
 * MemoryAuthStore — in-process auth state adapter backed by Map objects.
 *
 * Used automatically in development and test environments (NODE_ENV !== 'production').
 * All methods are async so the interface is identical to DatabaseAuthStore, allowing
 * callers to swap adapters without code changes.
 *
 * Token security: raw refresh tokens, password-reset tokens, email-verification
 * tokens, and OAuth state tokens are stored as SHA-256 hashes via hashToken().
 * Session IDs and MFA user keys are used as-is (they function as lookup keys, not
 * secrets that need hashing for storage protection in a memory context).
 */
class MemoryAuthStore {
  constructor() {
    // Map<tokenIdHash, { userId, expiresAt, revokedAt, createdAt }>
    this._refreshTokens = new Map();

    // Map<rawTokenHash, { userId, expiresAt, usedAt, createdAt }>
    this._passwordResetTokens = new Map();

    // Map<rawTokenHash, { userId, email, expiresAt, usedAt, createdAt }>
    this._emailVerificationTokens = new Map();

    // Map<sessionId, { userId, data, expiresAt, revokedAt, lastActivity, createdAt }>
    this._sessions = new Map();

    // Map<userId, secretData (plain object)>
    this._mfaSecrets = new Map();

    // Map<stateHash, { data, expiresAt, createdAt }>
    this._oauthState = new Map();

    // Map<userId, { count, lockedUntil, lastAttemptAt }>
    this._loginAttempts = new Map();
  }

  // ─── Refresh Tokens ────────────────────────────────────────────────────────

  /**
   * Persist a refresh token entry keyed by its tokenId (hashed).
   * @param {string} tokenId  - The tokenId embedded in the JWT payload.
   * @param {string} userId   - Owner of the token.
   * @param {Date}   expiresAt - Absolute expiry time.
   */
  async saveRefreshToken(tokenId, userId, expiresAt) {
    this._refreshTokens.set(hashToken(tokenId), {
      userId,
      expiresAt: new Date(expiresAt).getTime(),
      revokedAt: null,
      createdAt: Date.now()
    });
  }

  /**
   * Retrieve a refresh token record. Returns null if not found, expired, or revoked.
   * @param {string} tokenId
   * @returns {{ userId: string, expiresAt: number, createdAt: number } | null}
   */
  async getRefreshToken(tokenId) {
    const record = this._refreshTokens.get(hashToken(tokenId));
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  /**
   * Mark a refresh token as revoked. Does not delete — preserves audit trail.
   * @param {string} tokenId
   */
  async revokeRefreshToken(tokenId) {
    const record = this._refreshTokens.get(hashToken(tokenId));
    if (record) {
      record.revokedAt = Date.now();
    }
  }

  // ─── Password Reset Tokens ─────────────────────────────────────────────────

  /**
   * @param {string} rawToken
   * @param {string} userId
   * @param {Date}   expiresAt
   */
  async savePasswordResetToken(rawToken, userId, expiresAt) {
    this._passwordResetTokens.set(hashToken(rawToken), {
      userId,
      expiresAt: new Date(expiresAt).getTime(),
      usedAt: null,
      createdAt: Date.now()
    });
  }

  /**
   * Returns null if not found, expired, or already used.
   * @param {string} rawToken
   * @returns {{ userId: string, expiresAt: number } | null}
   */
  async getPasswordResetToken(rawToken) {
    const record = this._passwordResetTokens.get(hashToken(rawToken));
    if (!record) return null;
    if (record.usedAt !== null) return null;
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  /**
   * Mark a password reset token as used (consumed). Does not physically delete.
   * @param {string} rawToken
   */
  async deletePasswordResetToken(rawToken) {
    const record = this._passwordResetTokens.get(hashToken(rawToken));
    if (record) {
      record.usedAt = Date.now();
    }
  }

  // ─── Email Verification Tokens ─────────────────────────────────────────────

  /**
   * @param {string} rawToken
   * @param {string} userId
   * @param {string} email
   * @param {Date}   expiresAt
   */
  async saveEmailVerificationToken(rawToken, userId, email, expiresAt) {
    this._emailVerificationTokens.set(hashToken(rawToken), {
      userId,
      email,
      expiresAt: new Date(expiresAt).getTime(),
      usedAt: null,
      createdAt: Date.now()
    });
  }

  /**
   * Returns null if not found, expired, or already used.
   * @param {string} rawToken
   * @returns {{ userId: string, email: string, expiresAt: number } | null}
   */
  async getEmailVerificationToken(rawToken) {
    const record = this._emailVerificationTokens.get(hashToken(rawToken));
    if (!record) return null;
    if (record.usedAt !== null) return null;
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  /**
   * Mark an email verification token as used.
   * @param {string} rawToken
   */
  async deleteEmailVerificationToken(rawToken) {
    const record = this._emailVerificationTokens.get(hashToken(rawToken));
    if (record) {
      record.usedAt = Date.now();
    }
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  /**
   * @param {string} sessionId
   * @param {string} userId
   * @param {object} data       - Additional session metadata (mfaVerified, ip, etc.)
   * @param {Date}   expiresAt
   */
  async saveSession(sessionId, userId, data, expiresAt) {
    this._sessions.set(sessionId, {
      userId,
      data: { ...data },
      expiresAt: new Date(expiresAt).getTime(),
      revokedAt: null,
      lastActivity: Date.now(),
      createdAt: Date.now()
    });
  }

  /**
   * Retrieve a session. Returns null if not found, expired, or revoked.
   * @param {string} sessionId
   * @returns {{ userId: string, data: object, lastActivity: number } | null}
   */
  async getSession(sessionId) {
    const record = this._sessions.get(sessionId);
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  /**
   * Mark a session as revoked (logged out). Preserves the entry for audit.
   * @param {string} sessionId
   */
  async revokeSession(sessionId) {
    const record = this._sessions.get(sessionId);
    if (record) {
      record.revokedAt = Date.now();
    }
  }

  /**
   * Update the lastActivity timestamp on an active session.
   * @param {string} sessionId
   */
  async touchSession(sessionId) {
    const record = this._sessions.get(sessionId);
    if (record && record.revokedAt === null && record.expiresAt >= Date.now()) {
      record.lastActivity = Date.now();
    }
  }

  // ─── MFA Secrets ──────────────────────────────────────────────────────────

  /**
   * Save or overwrite MFA secret data for a user.
   * @param {string} userId
   * @param {object} secretData - { secret, verified, backupCodes, createdAt }
   */
  async saveMfaSecret(userId, secretData) {
    this._mfaSecrets.set(userId, { ...secretData, updatedAt: Date.now() });
  }

  /**
   * @param {string} userId
   * @returns {object | null}
   */
  async getMfaSecret(userId) {
    return this._mfaSecrets.get(userId) || null;
  }

  /**
   * @param {string} userId
   */
  async deleteMfaSecret(userId) {
    this._mfaSecrets.delete(userId);
  }

  // ─── OAuth State ──────────────────────────────────────────────────────────

  /**
   * Persist an OAuth state/challenge pair for later callback validation.
   * @param {string} state     - The raw state string generated during auth URL construction.
   * @param {object} data      - Any associated data (codeChallenge, provider, etc.)
   * @param {Date}   expiresAt - Short TTL (e.g. 10 minutes).
   */
  async saveOAuthState(state, data, expiresAt) {
    this._oauthState.set(hashToken(state), {
      data: { ...data },
      expiresAt: new Date(expiresAt).getTime(),
      createdAt: Date.now()
    });
  }

  /**
   * Returns null if not found or expired.
   * @param {string} state
   * @returns {object | null}
   */
  async getOAuthState(state) {
    const record = this._oauthState.get(hashToken(state));
    if (!record) return null;
    if (record.expiresAt < Date.now()) return null;
    return record.data;
  }

  /**
   * Delete OAuth state after it has been consumed by a callback.
   * @param {string} state
   */
  async deleteOAuthState(state) {
    this._oauthState.delete(hashToken(state));
  }

  // ─── Login Attempts ───────────────────────────────────────────────────────

  /**
   * Persist the current login attempt state for a user.
   * @param {string} userId
   * @param {{ count: number, lockedUntil: number|null, lastAttemptAt: number }} attempts
   */
  async recordLoginAttempt(userId, attempts) {
    this._loginAttempts.set(userId, { ...attempts });
  }

  /**
   * @param {string} userId
   * @returns {{ count: number, lockedUntil: number|null, lastAttemptAt: number } | null}
   */
  async getLoginAttempts(userId) {
    return this._loginAttempts.get(userId) || null;
  }

  /**
   * @param {string} userId
   */
  async clearLoginAttempts(userId) {
    this._loginAttempts.delete(userId);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  /**
   * Return aggregate statistics useful for monitoring and admin dashboards.
   * @returns {{ activeSessions: number, mfaEnabledUsers: number, lockedAccounts: number }}
   */
  async getStats() {
    const now = Date.now();
    let activeSessions = 0;
    for (const s of this._sessions.values()) {
      if (s.revokedAt === null && s.expiresAt >= now) activeSessions++;
    }
    let lockedAccounts = 0;
    for (const a of this._loginAttempts.values()) {
      if (a.lockedUntil && a.lockedUntil > now) lockedAccounts++;
    }
    return {
      activeSessions,
      mfaEnabledUsers: this._mfaSecrets.size,
      lockedAccounts
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  /**
   * Remove all expired records from every internal map.
   * Call on-demand — this store never starts background timers.
   *
   * @returns {{ removed: number }} Count of removed entries.
   */
  async cleanupExpired() {
    const now = Date.now();
    let removed = 0;

    for (const [k, v] of this._refreshTokens.entries()) {
      if (v.expiresAt < now || v.revokedAt !== null) {
        this._refreshTokens.delete(k);
        removed++;
      }
    }
    for (const [k, v] of this._passwordResetTokens.entries()) {
      if (v.expiresAt < now || v.usedAt !== null) {
        this._passwordResetTokens.delete(k);
        removed++;
      }
    }
    for (const [k, v] of this._emailVerificationTokens.entries()) {
      if (v.expiresAt < now || v.usedAt !== null) {
        this._emailVerificationTokens.delete(k);
        removed++;
      }
    }
    for (const [k, v] of this._sessions.entries()) {
      if (v.expiresAt < now || v.revokedAt !== null) {
        this._sessions.delete(k);
        removed++;
      }
    }
    for (const [k, v] of this._oauthState.entries()) {
      if (v.expiresAt < now) {
        this._oauthState.delete(k);
        removed++;
      }
    }

    return { removed };
  }
}

module.exports = MemoryAuthStore;
