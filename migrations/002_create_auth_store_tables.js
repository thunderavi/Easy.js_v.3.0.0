/**
 * Migration: Create auth store tables
 *
 * Creates four tables required by DatabaseAuthStore:
 *   - auth_tokens          : refresh, password-reset, email-verification, oauth-state tokens
 *   - auth_sessions        : enterprise sessions
 *   - auth_mfa_secrets     : per-user TOTP secrets and backup codes
 *   - auth_login_attempts  : brute-force tracking per user
 *
 * Token hashing: raw token values are never stored. Callers (DatabaseAuthStore)
 * always hash with SHA-256 before INSERT/SELECT on token_hash.
 */

exports.up = async (knex) => {
  // auth_tokens: covers refresh, password-reset, email-verification, oauth_state
  await knex.schema.createTable('auth_tokens', (table) => {
    table.string('id').primary();
    table.string('token_type').notNullable()
      .comment('refresh_token | password_reset | email_verification | oauth_state');
    table.string('token_hash', 64).notNullable().unique()
      .comment('SHA-256 hex of the raw token. Raw values are never stored.');
    table.string('user_id').nullable()
      .comment('Null for oauth_state rows where the user is not yet known.');
    table.text('metadata').nullable()
      .comment('JSON: email for email_verification, arbitrary data for oauth_state.');
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at').nullable()
      .comment('Set when the token is consumed (password-reset, email-verification).');
    table.timestamp('revoked_at').nullable()
      .comment('Set when the token is explicitly revoked (refresh tokens).');
    table.timestamps(true, true);  // created_at, updated_at

    table.index(['token_type', 'expires_at'], 'idx_auth_tokens_type_expiry');
    table.index(['user_id'], 'idx_auth_tokens_user');
  });

  // auth_sessions: enterprise session records
  await knex.schema.createTable('auth_sessions', (table) => {
    table.string('id').primary()
      .comment('The session ID (random hex, not hashed — used as lookup key).');
    table.string('user_id').notNullable();
    table.text('data').nullable()
      .comment('JSON: mfaVerified, mfaPending, ip, userAgent, device, etc.');
    table.timestamp('expires_at').notNullable();
    table.timestamp('last_activity').nullable();
    table.timestamp('revoked_at').nullable()
      .comment('Set on logout.');
    table.timestamps(true, true);

    table.index(['user_id', 'expires_at'], 'idx_auth_sessions_user_expiry');
    table.index(['expires_at'], 'idx_auth_sessions_expiry');
  });

  // auth_mfa_secrets: one row per user, replaced on re-enrolment
  await knex.schema.createTable('auth_mfa_secrets', (table) => {
    table.string('user_id').primary();
    table.text('secret_data').notNullable()
      .comment('JSON-encoded { secret, verified, backupCodes }. Encrypt at rest in production.');
    table.timestamps(true, true);
  });

  // auth_login_attempts: brute-force tracking
  await knex.schema.createTable('auth_login_attempts', (table) => {
    table.string('user_id').primary();
    table.integer('count').defaultTo(0).notNullable();
    table.timestamp('locked_until').nullable();
    table.timestamp('last_attempt').nullable();
    table.timestamps(true, true);

    table.index(['locked_until'], 'idx_auth_login_locked_until');
  });
};

exports.down = async (knex) => {
  // Drop in reverse dependency order
  await knex.schema.dropTableIfExists('auth_login_attempts');
  await knex.schema.dropTableIfExists('auth_mfa_secrets');
  await knex.schema.dropTableIfExists('auth_sessions');
  await knex.schema.dropTableIfExists('auth_tokens');
};
