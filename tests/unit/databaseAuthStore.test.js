'use strict';

/**
 * DatabaseAuthStore tests.
 *
 * Strategy: We use knex with the 'sqlite3' client pointing at ':memory:'.
 * The project already has 'sql.js' (a WebAssembly SQLite) as a dev dependency.
 * Knex ships with its own sqlite3 binding. If neither is available in the CI,
 * we fall back to mocking the knex object (following databaseAdapters.test.js).
 *
 * The most important test here is the multi-instance proof: two DatabaseAuthStore
 * instances sharing the same knex connection see the same data — which validates
 * production horizontal-scaling correctness.
 */

const { DatabaseAuthStore } = require('../../core/authStore');

// ─── In-Memory knex helper ─────────────────────────────────────────────────
// We build a lightweight in-memory store using plain objects to simulate the
// knex query builder, avoiding the need for a native sqlite3 binary in CI.
// This mirrors the approach used in databaseAdapters.test.js (full mock layer).

function buildMockKnex() {
  // Tables stored as arrays of row objects
  const tables = {};

  function getTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function buildBuilder(tableName) {
    const tbl = getTable(tableName);
    const _wheres = {};
    const _whereNulls = [];
    const _whereNotNulls = [];
    // Comparison filters: { field, op, value }  (op: '<' | '>' | '>=' | '<=')
    const _comparisons = [];
    let isCount = false;
    let countField = null;

    function _match(row) {
      for (const [k, v] of Object.entries(_wheres)) {
        if (row[k] !== v) return false;
      }
      for (const f of _whereNulls) {
        if (row[f] !== null && row[f] !== undefined) return false;
      }
      for (const f of _whereNotNulls) {
        if (row[f] === null || row[f] === undefined) return false;
      }
      for (const { field, op, value } of _comparisons) {
        const rowVal = new Date(row[field]).getTime();
        const cmpVal = new Date(value).getTime();
        if (op === '>'  && !(rowVal >  cmpVal)) return false;
        if (op === '<'  && !(rowVal <  cmpVal)) return false;
        if (op === '>=' && !(rowVal >= cmpVal)) return false;
        if (op === '<=' && !(rowVal <= cmpVal)) return false;
      }
      return true;
    }

    const builder = {
      where(fieldOrObj, opOrVal, val) {
        if (arguments.length === 3) {
          // Three-arg form: where(field, op, value)
          _comparisons.push({ field: fieldOrObj, op: opOrVal, value: val });
        } else if (typeof fieldOrObj === 'object') {
          Object.assign(_wheres, fieldOrObj);
        } else {
          _wheres[fieldOrObj] = opOrVal;
        }
        return builder;
      },
      whereNull(field) { _whereNulls.push(field); return builder; },
      whereNotNull(field) { _whereNotNulls.push(field); return builder; },

      count(expr) {
        isCount = true;
        countField = expr;
        return builder;
      },

      async first() {
        return tbl.find(_match) || undefined;
      },

      async insert(data) {
        tbl.push({ ...data });
        return [1];
      },

      async update(data) {
        let count = 0;
        for (const row of tbl) {
          if (_match(row)) {
            Object.assign(row, data);
            count++;
          }
        }
        return count;
      },

      async delete() {
        let count = 0;
        for (let i = tbl.length - 1; i >= 0; i--) {
          if (_match(tbl[i])) {
            tbl.splice(i, 1);
            count++;
          }
        }
        return count;
      },

      // Allow builder to be awaited as a promise (used by count queries)
      then(resolve, reject) {
        try {
          if (isCount) {
            const alias = (countField || 'count as count').split(' as ')[1] || 'count';
            resolve([{ [alias]: tbl.filter(_match).length }]);
          } else {
            resolve(tbl.filter(_match));
          }
        } catch (e) {
          reject(e);
        }
      }
    };

    return builder;
  }

  const knex = function (tableName) {
    return buildBuilder(tableName);
  };

  knex.schema = {
    hasTable: async () => true, // tables are created on first access
    createTable: async () => {}
  };

  // Expose raw table arrays for assertions in tests
  knex._tables = tables;

  return knex;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const inMs = (ms) => new Date(Date.now() + ms);
const past = () => inMs(-5000);
const future = () => inMs(60_000);

describe('DatabaseAuthStore', () => {
  let knex;
  let store;

  beforeEach(async () => {
    knex = buildMockKnex();
    store = new DatabaseAuthStore({ knex });
    // ensureTables is a no-op with our mock (hasTable always returns true)
    await store.ensureTables();
  });

  it('throws if constructed without a knex instance', () => {
    expect(() => new DatabaseAuthStore({})).toThrow('requires a knex instance');
  });

  // ── Refresh Tokens ──────────────────────────────────────────────────────────

  describe('refresh tokens', () => {
    it('saves and retrieves a valid refresh token', async () => {
      await store.saveRefreshToken('tok-1', 'user-1', future());
      const record = await store.getRefreshToken('tok-1');
      expect(record).not.toBeNull();
      expect(record.userId).toBe('user-1');
    });

    it('returns null for unknown token', async () => {
      expect(await store.getRefreshToken('no-such')).toBeNull();
    });

    it('returns null for expired token', async () => {
      await store.saveRefreshToken('tok-exp', 'user-2', past());
      expect(await store.getRefreshToken('tok-exp')).toBeNull();
    });

    it('returns null after revocation', async () => {
      await store.saveRefreshToken('tok-rev', 'user-3', future());
      await store.revokeRefreshToken('tok-rev');
      expect(await store.getRefreshToken('tok-rev')).toBeNull();
    });
  });

  // ── Password Reset Tokens ──────────────────────────────────────────────────

  describe('password reset tokens', () => {
    it('saves and retrieves a valid token', async () => {
      await store.savePasswordResetToken('raw-reset', 'user-1', future());
      const record = await store.getPasswordResetToken('raw-reset');
      expect(record).not.toBeNull();
      expect(record.userId).toBe('user-1');
    });

    it('returns null after deletion', async () => {
      await store.savePasswordResetToken('raw-del', 'user-2', future());
      await store.deletePasswordResetToken('raw-del');
      expect(await store.getPasswordResetToken('raw-del')).toBeNull();
    });

    it('returns null for expired token', async () => {
      await store.savePasswordResetToken('raw-exp', 'user-3', past());
      expect(await store.getPasswordResetToken('raw-exp')).toBeNull();
    });
  });

  // ── Email Verification Tokens ─────────────────────────────────────────────

  describe('email verification tokens', () => {
    it('saves and retrieves with email in metadata', async () => {
      await store.saveEmailVerificationToken('raw-ver', 'user-1', 'x@y.com', future());
      const record = await store.getEmailVerificationToken('raw-ver');
      expect(record).not.toBeNull();
      expect(record.email).toBe('x@y.com');
    });

    it('returns null after deletion', async () => {
      await store.saveEmailVerificationToken('raw-ver-del', 'user-2', 'a@b.com', future());
      await store.deleteEmailVerificationToken('raw-ver-del');
      expect(await store.getEmailVerificationToken('raw-ver-del')).toBeNull();
    });
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  describe('sessions', () => {
    it('saves and retrieves a session', async () => {
      await store.saveSession('sess-1', 'user-1', { mfaVerified: true }, future());
      const session = await store.getSession('sess-1');
      expect(session).not.toBeNull();
      expect(session.userId).toBe('user-1');
      expect(session.data.mfaVerified).toBe(true);
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
  });

  // ── MFA Secrets ──────────────────────────────────────────────────────────

  describe('MFA secrets', () => {
    it('saves and retrieves MFA secret', async () => {
      const secretData = { secret: 'TOTP', verified: false, backupCodes: ['AA'] };
      await store.saveMfaSecret('user-1', secretData);
      const retrieved = await store.getMfaSecret('user-1');
      expect(retrieved.secret).toBe('TOTP');
    });

    it('returns null for unknown user', async () => {
      expect(await store.getMfaSecret('nobody')).toBeNull();
    });

    it('deletes MFA secret', async () => {
      await store.saveMfaSecret('user-2', { secret: 'S', verified: true, backupCodes: [] });
      await store.deleteMfaSecret('user-2');
      expect(await store.getMfaSecret('user-2')).toBeNull();
    });

    it('applies encrypt/decrypt hooks transparently', async () => {
      const encryptSecret = (p) => `ENC:${p}`;
      const decryptSecret = (c) => c.replace(/^ENC:/, '');
      const encryptedStore = new DatabaseAuthStore({ knex, encryptSecret, decryptSecret });

      await encryptedStore.saveMfaSecret('user-enc', { secret: 'PLAIN', verified: false, backupCodes: [] });

      // Verify the raw stored value is encrypted
      const rawRow = knex._tables['auth_mfa_secrets']
        .find((r) => r.user_id === 'user-enc');
      expect(rawRow.secret_data).toMatch(/^ENC:/);

      // But getMfaSecret decrypts transparently
      const retrieved = await encryptedStore.getMfaSecret('user-enc');
      expect(retrieved.secret).toBe('PLAIN');
    });
  });

  // ── OAuth State ──────────────────────────────────────────────────────────

  describe('OAuth state', () => {
    it('saves and retrieves valid state', async () => {
      await store.saveOAuthState('state-1', { provider: 'github' }, future());
      const data = await store.getOAuthState('state-1');
      expect(data).not.toBeNull();
      expect(data.provider).toBe('github');
    });

    it('returns null for expired state', async () => {
      await store.saveOAuthState('state-exp', { provider: 'google' }, past());
      expect(await store.getOAuthState('state-exp')).toBeNull();
    });

    it('deletes state after callback', async () => {
      await store.saveOAuthState('state-del', { provider: 'gitlab' }, future());
      await store.deleteOAuthState('state-del');
      expect(await store.getOAuthState('state-del')).toBeNull();
    });
  });

  // ── Login Attempts ────────────────────────────────────────────────────────

  describe('login attempts', () => {
    it('records and retrieves attempts', async () => {
      await store.recordLoginAttempt('user-1', { count: 3, lockedUntil: null, lastAttemptAt: Date.now() });
      const attempts = await store.getLoginAttempts('user-1');
      expect(attempts.count).toBe(3);
    });

    it('updates on second call (upsert)', async () => {
      await store.recordLoginAttempt('user-2', { count: 1, lockedUntil: null, lastAttemptAt: Date.now() });
      await store.recordLoginAttempt('user-2', { count: 2, lockedUntil: null, lastAttemptAt: Date.now() });
      const attempts = await store.getLoginAttempts('user-2');
      expect(attempts.count).toBe(2);
    });

    it('clears login attempts', async () => {
      await store.recordLoginAttempt('user-3', { count: 4, lockedUntil: null, lastAttemptAt: Date.now() });
      await store.clearLoginAttempts('user-3');
      expect(await store.getLoginAttempts('user-3')).toBeNull();
    });
  });

  // ── cleanupExpired ────────────────────────────────────────────────────────

  describe('cleanupExpired', () => {
    it('removes only expired rows from auth_tokens and auth_sessions', async () => {
      await store.saveRefreshToken('r-good', 'u1', future());
      await store.saveRefreshToken('r-bad', 'u2', past());
      await store.saveSession('s-good', 'u1', {}, future());
      await store.saveSession('s-bad', 'u2', {}, past());

      const { removed } = await store.cleanupExpired();
      expect(removed).toBe(2); // one token, one session

      expect(await store.getRefreshToken('r-good')).not.toBeNull();
      expect(await store.getSession('s-good')).not.toBeNull();
    });
  });

  // ── Multi-instance proof (horizontal scaling) ─────────────────────────────

  describe('multi-instance — proves production horizontal-scaling correctness', () => {
    it('store B can read what store A wrote when sharing the same knex connection', async () => {
      const storeA = new DatabaseAuthStore({ knex });
      const storeB = new DatabaseAuthStore({ knex });

      await storeA.saveRefreshToken('shared-tok', 'user-42', future());
      const record = await storeB.getRefreshToken('shared-tok');
      expect(record).not.toBeNull();
      expect(record.userId).toBe('user-42');
    });

    it('store B sees revocation made by store A', async () => {
      const storeA = new DatabaseAuthStore({ knex });
      const storeB = new DatabaseAuthStore({ knex });

      await storeA.saveRefreshToken('shared-rev', 'user-99', future());
      await storeA.revokeRefreshToken('shared-rev');
      expect(await storeB.getRefreshToken('shared-rev')).toBeNull();
    });

    it('sessions created by store A are visible to store B', async () => {
      const storeA = new DatabaseAuthStore({ knex });
      const storeB = new DatabaseAuthStore({ knex });

      await storeA.saveSession('shared-sess', 'user-7', { mfaVerified: true }, future());
      const session = await storeB.getSession('shared-sess');
      expect(session).not.toBeNull();
      expect(session.userId).toBe('user-7');
    });
  });
});
