'use strict';

const { hashToken } = require('./tokenUtils');

/**
 * DatabaseAuthStore — knex-backed persistent auth state adapter.
 *
 * Suitable for production deployments and horizontal scaling. Two instances
 * pointing at the same database connection share all auth state, which proves
 * correctness for multi-process/multi-server setups.
 *
 * Token security: raw tokens are hashed with SHA-256 via hashToken() before
 * any INSERT or SELECT. Raw tokens are never written to the database.
 *
 * MFA secret encryption: if encryptSecret/decryptSecret hooks are provided in
 * the constructor options, MFA secrets are encrypted before INSERT and decrypted
 * after SELECT. Without hooks, secrets are stored as plaintext — acceptable for
 * development but not recommended for production.
 *
 * @param {{ knex: import('knex').Knex, encryptSecret?: Function, decryptSecret?: Function }} options
 */
class DatabaseAuthStore {
  constructor(options = {}) {
    if (!options.knex) {
      throw new Error('DatabaseAuthStore requires a knex instance');
    }
    this.knex = options.knex;
    this._encrypt = options.encryptSecret || ((s) => s);
    this._decrypt = options.decryptSecret || ((s) => s);
  }

  // ─── Schema Bootstrap ─────────────────────────────────────────────────────

  /**
   * Create all required tables if they do not yet exist.
   * Idempotent — safe to call on every startup.
   * In production, prefer running the migration instead of calling this directly.
   */
  async ensureTables() {
    const knex = this.knex;
    const has = (t) => knex.schema.hasTable(t);

    if (!(await has('auth_tokens'))) {
      await knex.schema.createTable('auth_tokens', (t) => {
        t.string('id').primary();
        t.string('token_type').notNullable();
        t.string('token_hash').notNullable().unique();
        t.string('user_id');
        t.text('metadata');
        t.timestamp('expires_at').notNullable();
        t.timestamp('used_at').nullable();
        t.timestamp('revoked_at').nullable();
        t.timestamps(true, true);
        t.index(['token_type', 'expires_at']);
      });
    }

    if (!(await has('auth_sessions'))) {
      await knex.schema.createTable('auth_sessions', (t) => {
        t.string('id').primary();
        t.string('user_id').notNullable();
        t.text('data');
        t.timestamp('expires_at').notNullable();
        t.timestamp('last_activity');
        t.timestamp('revoked_at').nullable();
        t.timestamps(true, true);
        t.index(['user_id', 'expires_at']);
      });
    }

    if (!(await has('auth_mfa_secrets'))) {
      await knex.schema.createTable('auth_mfa_secrets', (t) => {
        t.string('user_id').primary();
        t.text('secret_data').notNullable();
        t.timestamps(true, true);
      });
    }

    if (!(await has('auth_login_attempts'))) {
      await knex.schema.createTable('auth_login_attempts', (t) => {
        t.string('user_id').primary();
        t.integer('count').defaultTo(0);
        t.timestamp('locked_until').nullable();
        t.timestamp('last_attempt');
        t.timestamps(true, true);
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** @param {string} id */
  _newId() {
    // Reuse Node.js built-in — no extra deps.
    return require('crypto').randomUUID ? require('crypto').randomUUID()
      : require('crypto').randomBytes(16).toString('hex');
  }

  _now() {
    return new Date();
  }

  _toMs(dateOrMs) {
    if (!dateOrMs) return null;
    return new Date(dateOrMs).getTime();
  }

  // ─── Refresh Tokens ────────────────────────────────────────────────────────

  async saveRefreshToken(tokenId, userId, expiresAt) {
    await this.knex('auth_tokens')
      .insert({
        id: this._newId(),
        token_type: 'refresh_token',
        token_hash: hashToken(tokenId),
        user_id: userId,
        metadata: null,
        expires_at: new Date(expiresAt),
        used_at: null,
        revoked_at: null,
        created_at: this._now(),
        updated_at: this._now()
      });
  }

  async getRefreshToken(tokenId) {
    const row = await this.knex('auth_tokens')
      .where({ token_hash: hashToken(tokenId), token_type: 'refresh_token' })
      .first();
    if (!row) return null;
    if (row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return {
      userId: row.user_id,
      expiresAt: this._toMs(row.expires_at),
      createdAt: this._toMs(row.created_at)
    };
  }

  async revokeRefreshToken(tokenId) {
    await this.knex('auth_tokens')
      .where({ token_hash: hashToken(tokenId), token_type: 'refresh_token' })
      .update({ revoked_at: this._now(), updated_at: this._now() });
  }

  // ─── Password Reset Tokens ─────────────────────────────────────────────────

  async savePasswordResetToken(rawToken, userId, expiresAt) {
    await this.knex('auth_tokens')
      .insert({
        id: this._newId(),
        token_type: 'password_reset',
        token_hash: hashToken(rawToken),
        user_id: userId,
        metadata: null,
        expires_at: new Date(expiresAt),
        used_at: null,
        revoked_at: null,
        created_at: this._now(),
        updated_at: this._now()
      });
  }

  async getPasswordResetToken(rawToken) {
    const row = await this.knex('auth_tokens')
      .where({ token_hash: hashToken(rawToken), token_type: 'password_reset' })
      .first();
    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return {
      userId: row.user_id,
      expiresAt: this._toMs(row.expires_at),
      createdAt: this._toMs(row.created_at)
    };
  }

  async deletePasswordResetToken(rawToken) {
    await this.knex('auth_tokens')
      .where({ token_hash: hashToken(rawToken), token_type: 'password_reset' })
      .update({ used_at: this._now(), updated_at: this._now() });
  }

  // ─── Email Verification Tokens ─────────────────────────────────────────────

  async saveEmailVerificationToken(rawToken, userId, email, expiresAt) {
    await this.knex('auth_tokens')
      .insert({
        id: this._newId(),
        token_type: 'email_verification',
        token_hash: hashToken(rawToken),
        user_id: userId,
        metadata: JSON.stringify({ email }),
        expires_at: new Date(expiresAt),
        used_at: null,
        revoked_at: null,
        created_at: this._now(),
        updated_at: this._now()
      });
  }

  async getEmailVerificationToken(rawToken) {
    const row = await this.knex('auth_tokens')
      .where({ token_hash: hashToken(rawToken), token_type: 'email_verification' })
      .first();
    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    return {
      userId: row.user_id,
      email: meta.email,
      expiresAt: this._toMs(row.expires_at),
      createdAt: this._toMs(row.created_at)
    };
  }

  async deleteEmailVerificationToken(rawToken) {
    await this.knex('auth_tokens')
      .where({ token_hash: hashToken(rawToken), token_type: 'email_verification' })
      .update({ used_at: this._now(), updated_at: this._now() });
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  async saveSession(sessionId, userId, data, expiresAt) {
    const now = this._now();
    await this.knex('auth_sessions')
      .insert({
        id: sessionId,
        user_id: userId,
        data: JSON.stringify(data || {}),
        expires_at: new Date(expiresAt),
        last_activity: now,
        revoked_at: null,
        created_at: now,
        updated_at: now
      });
  }

  async getSession(sessionId) {
    const row = await this.knex('auth_sessions').where({ id: sessionId }).first();
    if (!row) return null;
    if (row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return {
      userId: row.user_id,
      data: row.data ? JSON.parse(row.data) : {},
      expiresAt: this._toMs(row.expires_at),
      lastActivity: this._toMs(row.last_activity),
      createdAt: this._toMs(row.created_at)
    };
  }

  async revokeSession(sessionId) {
    await this.knex('auth_sessions')
      .where({ id: sessionId })
      .update({ revoked_at: this._now(), updated_at: this._now() });
  }

  async touchSession(sessionId) {
    await this.knex('auth_sessions')
      .where({ id: sessionId })
      .whereNull('revoked_at')
      .where('expires_at', '>', this._now())
      .update({ last_activity: this._now(), updated_at: this._now() });
  }

  // ─── MFA Secrets ──────────────────────────────────────────────────────────

  /**
   * Save or replace MFA secret data for a user.
   * SECURITY NOTE: if encryptSecret/decryptSecret hooks are not configured,
   * the TOTP secret is stored as plaintext. Configure encryption hooks for
   * production deployments.
   */
  async saveMfaSecret(userId, secretData) {
    const raw = JSON.stringify(secretData);
    const stored = this._encrypt(raw);
    const now = this._now();

    const exists = await this.knex('auth_mfa_secrets').where({ user_id: userId }).first();
    if (exists) {
      await this.knex('auth_mfa_secrets')
        .where({ user_id: userId })
        .update({ secret_data: stored, updated_at: now });
    } else {
      await this.knex('auth_mfa_secrets')
        .insert({ user_id: userId, secret_data: stored, created_at: now, updated_at: now });
    }
  }

  async getMfaSecret(userId) {
    const row = await this.knex('auth_mfa_secrets').where({ user_id: userId }).first();
    if (!row) return null;
    const raw = this._decrypt(row.secret_data);
    return JSON.parse(raw);
  }

  async deleteMfaSecret(userId) {
    await this.knex('auth_mfa_secrets').where({ user_id: userId }).delete();
  }

  // ─── OAuth State ──────────────────────────────────────────────────────────

  async saveOAuthState(state, data, expiresAt) {
    await this.knex('auth_tokens')
      .insert({
        id: this._newId(),
        token_type: 'oauth_state',
        token_hash: hashToken(state),
        user_id: null,
        metadata: JSON.stringify(data || {}),
        expires_at: new Date(expiresAt),
        used_at: null,
        revoked_at: null,
        created_at: this._now(),
        updated_at: this._now()
      });
  }

  async getOAuthState(state) {
    const row = await this.knex('auth_tokens')
      .where({ token_hash: hashToken(state), token_type: 'oauth_state' })
      .first();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row.metadata ? JSON.parse(row.metadata) : {};
  }

  async deleteOAuthState(state) {
    await this.knex('auth_tokens')
      .where({ token_hash: hashToken(state), token_type: 'oauth_state' })
      .delete();
  }

  // ─── Login Attempts ───────────────────────────────────────────────────────

  async recordLoginAttempt(userId, attempts) {
    const now = this._now();
    const exists = await this.knex('auth_login_attempts').where({ user_id: userId }).first();
    if (exists) {
      await this.knex('auth_login_attempts')
        .where({ user_id: userId })
        .update({
          count: attempts.count,
          locked_until: attempts.lockedUntil ? new Date(attempts.lockedUntil) : null,
          last_attempt: attempts.lastAttemptAt ? new Date(attempts.lastAttemptAt) : now,
          updated_at: now
        });
    } else {
      await this.knex('auth_login_attempts')
        .insert({
          user_id: userId,
          count: attempts.count,
          locked_until: attempts.lockedUntil ? new Date(attempts.lockedUntil) : null,
          last_attempt: attempts.lastAttemptAt ? new Date(attempts.lastAttemptAt) : now,
          created_at: now,
          updated_at: now
        });
    }
  }

  async getLoginAttempts(userId) {
    const row = await this.knex('auth_login_attempts').where({ user_id: userId }).first();
    if (!row) return null;
    return {
      count: row.count,
      lockedUntil: this._toMs(row.locked_until),
      lastAttemptAt: this._toMs(row.last_attempt)
    };
  }

  async clearLoginAttempts(userId) {
    await this.knex('auth_login_attempts').where({ user_id: userId }).delete();
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats() {
    const now = this._now();

    const [{ count: activeSessions }] = await this.knex('auth_sessions')
      .whereNull('revoked_at')
      .where('expires_at', '>', now)
      .count('id as count');

    const [{ count: mfaEnabledUsers }] = await this.knex('auth_mfa_secrets')
      .count('user_id as count');

    const [{ count: lockedAccounts }] = await this.knex('auth_login_attempts')
      .where('locked_until', '>', now)
      .count('user_id as count');

    return {
      activeSessions: Number(activeSessions),
      mfaEnabledUsers: Number(mfaEnabledUsers),
      lockedAccounts: Number(lockedAccounts)
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  /**
   * Delete expired rows from auth_tokens and auth_sessions.
   * Call on-demand — this store never starts background timers.
   * @returns {{ removed: number }}
   */
  async cleanupExpired() {
    const now = this._now();

    const tokenCount = await this.knex('auth_tokens')
      .where('expires_at', '<', now)
      .delete();

    const sessionCount = await this.knex('auth_sessions')
      .where('expires_at', '<', now)
      .delete();

    return { removed: (tokenCount || 0) + (sessionCount || 0) };
  }
}

module.exports = DatabaseAuthStore;
