/**
 * JWT Secret Validator
 *
 * Centralised helper that enforces strong JWT secrets in production and
 * warns (or generates an ephemeral fallback) in development/test.
 *
 * Rules enforced in production (NODE_ENV === 'production'):
 *   - Secret must be present (non-empty string).
 *   - Secret must be at least 32 characters long.
 *   - Secret must not equal any known default / dev placeholder.
 *   - Secret must not match generic placeholder patterns (e.g. "your-*",
 *     "*-change-in-production", "replace-*", "change-this").
 *
 * In non-production environments a console warning is emitted when the
 * secret is missing or matches a known default, and an ephemeral random
 * secret is returned so the process can still start.
 */

const crypto = require('crypto');

/** Minimum acceptable length for a production JWT secret. */
const MIN_SECRET_LENGTH = 32;

/**
 * Known insecure default values that must never be used in production.
 *
 * FIX (Issue #67): Added 'easyjs-default-secret' — the original hardcoded
 * fallback that was present in the codebase before this fix. Without this
 * entry, a developer who accidentally commits that value could silently
 * deploy a production app whose tokens can be forged by anyone.
 */
const KNOWN_DEFAULTS = new Set([
  // Added for Issue #67
  'easyjs-default-secret', // the original hardcoded || fallback
  // Pre-existing entries
  'easy-js-secret-key-change-in-production',
  'dev-secret',
  'dev-refresh',
  'your-secret-key-here-change-in-production',
  'secret',
  'refresh',
  'change-me',
]);

/**
 * Regex patterns that identify generic placeholder secrets.
 * A secret matching any of these is treated the same as a KNOWN_DEFAULT.
 *
 * Patterns (case-insensitive):
 *   - starts with "your-"
 *   - ends with "-change-in-production"
 *   - starts with "replace-"
 *   - equals "change-this"
 */
const PLACEHOLDER_PATTERNS = [
  /^your-/i,
  /-change-in-production$/i,
  /^replace-/i,
  /^change-this$/i,
];

/**
 * Returns true when the secret looks like a documentation placeholder
 * rather than a real secret.
 *
 * @param {string} secret
 * @returns {boolean}
 */
function isPlaceholder(secret) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(secret));
}

/**
 * Determine whether the current runtime is production.
 * Reads process.env.NODE_ENV at call-time so tests can override it.
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validate a JWT secret value.
 *
 * @param {string} secret   - The secret value to validate.
 * @param {string} [label]  - Human-readable label used in error/warning messages
 *                            (e.g. "JWT_SECRET", "JWT_REFRESH_SECRET").
 * @returns {string}        - The validated secret (same value that was passed in).
 * @throws {Error}          - In production when the secret is missing, too short,
 *                            or matches a known default.
 */
function validateJwtSecret(secret, label = 'JWT secret') {
  const prod = isProduction();

  // ── Missing / empty ──────────────────────────────────────────────────────
  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    if (prod) {
      throw new Error(
        `[Security] ${label} is required in production. ` +
          'Set a strong, unique secret via the corresponding environment variable.'
      );
    }
    const ephemeral = crypto.randomBytes(32).toString('hex');
    console.warn(
      `[Security] WARNING: ${label} is not set. ` +
        'Using an ephemeral random secret for this process. ' +
        'Tokens will be invalidated on restart. Set a persistent secret for development.'
    );
    return ephemeral;
  }

  // ── Known default / placeholder ──────────────────────────────────────────
  if (KNOWN_DEFAULTS.has(secret) || isPlaceholder(secret)) {
    if (prod) {
      throw new Error(
        `[Security] ${label} uses a known insecure default value ("${secret}"). ` +
          'Replace it with a strong, unique secret before deploying to production.'
      );
    }
    console.warn(
      `[Security] WARNING: ${label} is set to a known insecure default ("${secret}"). ` +
        'This is acceptable in development but must be changed before going to production.'
    );
    return secret;
  }

  // ── Too short ────────────────────────────────────────────────────────────
  if (secret.length < MIN_SECRET_LENGTH) {
    if (prod) {
      throw new Error(
        `[Security] ${label} is too short (${secret.length} chars). ` +
          `A minimum of ${MIN_SECRET_LENGTH} characters is required in production.`
      );
    }
    console.warn(
      `[Security] WARNING: ${label} is shorter than the recommended ` +
        `${MIN_SECRET_LENGTH} characters. Use a longer secret in production.`
    );
    return secret;
  }

  // ── All checks passed ────────────────────────────────────────────────────
  return secret;
}

module.exports = { validateJwtSecret, KNOWN_DEFAULTS, PLACEHOLDER_PATTERNS, isPlaceholder, MIN_SECRET_LENGTH };