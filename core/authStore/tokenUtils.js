'use strict';

const crypto = require('crypto');

/**
 * Hash a sensitive token using SHA-256.
 * Used consistently by both MemoryAuthStore and DatabaseAuthStore so that
 * raw tokens (refresh, password-reset, email-verification) are never stored
 * or compared directly — only their hashes are persisted or looked up.
 *
 * @param {string} token - The raw token string.
 * @returns {string} 64-character hex digest.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { hashToken };
