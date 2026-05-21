'use strict';

const MemoryAuthStore = require('./memoryAuthStore');
const DatabaseAuthStore = require('./databaseAuthStore');

/**
 * Create the appropriate auth store based on the provided options.
 *
 * Selection logic:
 *   - If `options.knex` is provided → DatabaseAuthStore (production / multi-instance).
 *   - Otherwise → MemoryAuthStore (development / test).
 *
 * Example — use memory store (default in tests):
 *   const store = createAuthStore();
 *
 * Example — use database store in production:
 *   const store = createAuthStore({ knex: myKnexInstance });
 *
 * Example — use database store with MFA encryption:
 *   const store = createAuthStore({
 *     knex: myKnexInstance,
 *     encryptSecret: (plaintext) => myEncrypt(plaintext),
 *     decryptSecret: (ciphertext) => myDecrypt(ciphertext),
 *   });
 *
 * @param {{ knex?: import('knex').Knex, encryptSecret?: Function, decryptSecret?: Function }} [options]
 * @returns {MemoryAuthStore | DatabaseAuthStore}
 */
function createAuthStore(options = {}) {
  if (options.knex) {
    return new DatabaseAuthStore(options);
  }
  return new MemoryAuthStore();
}

module.exports = { createAuthStore, MemoryAuthStore, DatabaseAuthStore };
