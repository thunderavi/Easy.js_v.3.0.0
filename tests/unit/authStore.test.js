'use strict';

const { MemoryAuthStore } = require('../../core/authStore');

// Helper: produce a Date that is N milliseconds from now.
const inMs = (ms) => new Date(Date.now() + ms);
const past = () => inMs(-100);
const future = () => inMs(60_000);

describe('MemoryAuthStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryAuthStore();
  });

  // ── Refresh Tokens ──────────────────────────────────────────────────────────

  describe('refresh tokens', () => {
    it('saves and retrieves a valid refresh token', async () => {
      await store.saveRefreshToken('tok-id-1', 'user-1', future());
      const record = await store.getRefreshToken('tok-id-1');
      expect(record).not.toBeNull();
      expect(record.userId).toBe('user-1');
    });

    it('returns null for an unknown token', async () => {
      expect(await store.getRefreshToken('unknown')).toBeNull();
    });

    it('returns null for an expired token', async () => {
      await store.saveRefreshToken('tok-exp', 'user-2', past());
      expect(await store.getRefreshToken('tok-exp')).toBeNull();
    });

    it('returns null after the token is revoked', async () => {
      await store.saveRefreshToken('tok-rev', 'user-3', future());
      await store.revokeRefreshToken('tok-rev');
      expect(await store.getRefreshToken('tok-rev')).toBeNull();
    });

    it('cleanupExpired removes expired and revoked tokens', async () => {
      await store.saveRefreshToken('good', 'u1', future());
      await store.saveRefreshToken('bad-exp', 'u2', past());
      await store.saveRefreshToken('bad-rev', 'u3', future());
      await store.revokeRefreshToken('bad-rev');

      const { removed } = await store.cleanupExpired();
      expect(removed).toBeGreaterThanOrEqual(2);

      expect(await store.getRefreshToken('good')).not.toBeNull();
      // expired + revoked gone
      expect(store._refreshTokens.size).toBe(1);
    });
  });

  // ── Password Reset Tokens ──────────────────────────────────────────────────

  describe('password reset tokens', () => {
    it('saves and retrieves a valid reset token', async () => {
      await store.savePasswordResetToken('raw-reset-1', 'user-1', future());
      const record = await store.getPasswordResetToken('raw-reset-1');
      expect(record).not.toBeNull();
      expect(record.userId).toBe('user-1');
    });

    it('returns null for unknown token', async () => {
      expect(await store.getPasswordResetToken('nope')).toBeNull();
    });

    it('returns null for expired token', async () => {
      await store.savePasswordResetToken('raw-exp', 'user-2', past());
      expect(await store.getPasswordResetToken('raw-exp')).toBeNull();
    });

    it('returns null after deletion (consumed)', async () => {
      await store.savePasswordResetToken('raw-del', 'user-3', future());
      await store.deletePasswordResetToken('raw-del');
      expect(await store.getPasswordResetToken('raw-del')).toBeNull();
    });
  });

  // ── Email Verification Tokens ─────────────────────────────────────────────

  describe('email verification tokens', () => {
    it('saves and retrieves a valid verification token', async () => {
      await store.saveEmailVerificationToken('raw-ver-1', 'user-1', 'a@example.com', future());
      const record = await store.getEmailVerificationToken('raw-ver-1');
      expect(record).not.toBeNull();
      expect(record.userId).toBe('user-1');
      expect(record.email).toBe('a@example.com');
    });

    it('returns null for expired token', async () => {
      await store.saveEmailVerificationToken('raw-ver-exp', 'user-2', 'b@example.com', past());
      expect(await store.getEmailVerificationToken('raw-ver-exp')).toBeNull();
    });

    it('returns null after deletion', async () => {
      await store.saveEmailVerificationToken('raw-ver-del', 'user-3', 'c@example.com', future());
      await store.deleteEmailVerificationToken('raw-ver-del');
      expect(await store.getEmailVerificationToken('raw-ver-del')).toBeNull();
    });
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  describe('sessions', () => {
    it('saves and retrieves a valid session', async () => {
      await store.saveSession('sess-1', 'user-1', { mfaVerified: true }, future());
      const session = await store.getSession('sess-1');
      expect(session).not.toBeNull();
      expect(session.userId).toBe('user-1');
      expect(session.data.mfaVerified).toBe(true);
    });

    it('returns null for unknown session', async () => {
      expect(await store.getSession('not-exist')).toBeNull();
    });

    it('returns null for expired session', async () => {
      await store.saveSession('sess-exp', 'user-2', {}, past());
      expect(await store.getSession('sess-exp')).toBeNull();
    });

    it('returns null after revocation', async () => {
      await store.saveSession('sess-rev', 'user-3', {}, future());
      await store.revokeSession('sess-rev');
      expect(await store.getSession('sess-rev')).toBeNull();
    });

    it('touchSession updates lastActivity on an active session', async () => {
      await store.saveSession('sess-touch', 'user-1', {}, future());
      const before = (await store.getSession('sess-touch')).lastActivity;
      await new Promise((r) => setTimeout(r, 5));
      await store.touchSession('sess-touch');
      const after = (await store.getSession('sess-touch')).lastActivity;
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  // ── MFA Secrets ──────────────────────────────────────────────────────────

  describe('MFA secrets', () => {
    it('saves and retrieves MFA secret data', async () => {
      const data = { secret: 'TOTP_SECRET', verified: false, backupCodes: ['AA', 'BB'] };
      await store.saveMfaSecret('user-1', data);
      const retrieved = await store.getMfaSecret('user-1');
      expect(retrieved.secret).toBe('TOTP_SECRET');
      expect(retrieved.backupCodes).toEqual(['AA', 'BB']);
    });

    it('returns null for unknown user', async () => {
      expect(await store.getMfaSecret('nobody')).toBeNull();
    });

    it('deletes MFA secret', async () => {
      await store.saveMfaSecret('user-2', { secret: 'S', verified: true, backupCodes: [] });
      await store.deleteMfaSecret('user-2');
      expect(await store.getMfaSecret('user-2')).toBeNull();
    });

    it('overwrites on second save', async () => {
      await store.saveMfaSecret('user-3', { secret: 'OLD', verified: false, backupCodes: [] });
      await store.saveMfaSecret('user-3', { secret: 'NEW', verified: true, backupCodes: [] });
      expect((await store.getMfaSecret('user-3')).secret).toBe('NEW');
    });
  });

  // ── OAuth State ──────────────────────────────────────────────────────────

  describe('OAuth state', () => {
    it('saves and retrieves valid OAuth state', async () => {
      await store.saveOAuthState('state-abc', { codeChallenge: 'cc1', provider: 'github' }, future());
      const data = await store.getOAuthState('state-abc');
      expect(data).not.toBeNull();
      expect(data.codeChallenge).toBe('cc1');
    });

    it('returns null for unknown state', async () => {
      expect(await store.getOAuthState('unknown-state')).toBeNull();
    });

    it('returns null for expired state', async () => {
      await store.saveOAuthState('state-exp', { provider: 'google' }, past());
      expect(await store.getOAuthState('state-exp')).toBeNull();
    });

    it('deletes OAuth state after callback', async () => {
      await store.saveOAuthState('state-del', { provider: 'github' }, future());
      await store.deleteOAuthState('state-del');
      expect(await store.getOAuthState('state-del')).toBeNull();
    });
  });

  // ── Login Attempts ────────────────────────────────────────────────────────

  describe('login attempts', () => {
    it('records and retrieves login attempts', async () => {
      await store.recordLoginAttempt('user-1', { count: 2, lockedUntil: null, lastAttemptAt: Date.now() });
      const attempts = await store.getLoginAttempts('user-1');
      expect(attempts.count).toBe(2);
      expect(attempts.lockedUntil).toBeNull();
    });

    it('returns null for unknown user', async () => {
      expect(await store.getLoginAttempts('nobody')).toBeNull();
    });

    it('clears login attempts', async () => {
      await store.recordLoginAttempt('user-2', { count: 3, lockedUntil: null, lastAttemptAt: Date.now() });
      await store.clearLoginAttempts('user-2');
      expect(await store.getLoginAttempts('user-2')).toBeNull();
    });

    it('records lockout correctly', async () => {
      const lockedUntil = Date.now() + 60_000;
      await store.recordLoginAttempt('user-3', { count: 5, lockedUntil, lastAttemptAt: Date.now() });
      const attempts = await store.getLoginAttempts('user-3');
      expect(attempts.lockedUntil).toBe(lockedUntil);
    });
  });

  // ── cleanupExpired ────────────────────────────────────────────────────────

  describe('cleanupExpired', () => {
    it('removes only expired records and reports count', async () => {
      // Active records
      await store.saveRefreshToken('r-good', 'u1', future());
      await store.savePasswordResetToken('p-good', 'u1', future());
      await store.saveEmailVerificationToken('e-good', 'u1', 'a@b.com', future());
      await store.saveSession('s-good', 'u1', {}, future());
      await store.saveOAuthState('o-good', {}, future());

      // Expired records
      await store.saveRefreshToken('r-bad', 'u2', past());
      await store.savePasswordResetToken('p-bad', 'u2', past());
      await store.saveEmailVerificationToken('e-bad', 'u2', 'b@c.com', past());
      await store.saveSession('s-bad', 'u2', {}, past());
      await store.saveOAuthState('o-bad', {}, past());

      const { removed } = await store.cleanupExpired();
      expect(removed).toBe(5); // exactly the 5 expired ones

      // Active records still accessible
      expect(await store.getRefreshToken('r-good')).not.toBeNull();
      expect(await store.getPasswordResetToken('p-good')).not.toBeNull();
      expect(await store.getEmailVerificationToken('e-good')).not.toBeNull();
      expect(await store.getSession('s-good')).not.toBeNull();
      expect(await store.getOAuthState('o-good')).not.toBeNull();
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('counts active sessions, MFA users, and locked accounts', async () => {
      await store.saveSession('s1', 'u1', {}, future());
      await store.saveSession('s2', 'u2', {}, past()); // expired, not active
      await store.saveMfaSecret('u1', { secret: 'S', verified: true, backupCodes: [] });
      await store.recordLoginAttempt('u3', { count: 5, lockedUntil: Date.now() + 60_000, lastAttemptAt: Date.now() });

      const stats = await store.getStats();
      expect(stats.activeSessions).toBe(1);
      expect(stats.mfaEnabledUsers).toBe(1);
      expect(stats.lockedAccounts).toBe(1);
    });
  });
});
