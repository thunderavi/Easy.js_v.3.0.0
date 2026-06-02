/**
 * Tests for core/jwtSecretValidator.js
 *
 * Covers:
 *   - production: missing secret → throws
 *   - production: known default secret → throws
 *   - production: secret too short → throws
 *   - production: strong valid secret → returns the secret
 *   - development: missing secret → warns + returns ephemeral string
 *   - development: known default secret → warns + returns the value
 *   - development: short secret → warns + returns the value
 *   - development: strong valid secret → returns the secret silently
 */

const { validateJwtSecret, KNOWN_DEFAULTS, PLACEHOLDER_PATTERNS, isPlaceholder, MIN_SECRET_LENGTH } = require('../../core/jwtSecretValidator');

// Helper: temporarily set NODE_ENV and restore it after each test.
function withNodeEnv(env, fn) {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = original;
  }
}

// A secret that passes all checks.
const STRONG_SECRET = 'a'.repeat(MIN_SECRET_LENGTH);

describe('validateJwtSecret – production mode', () => {
  it('throws when secret is missing (undefined)', () => {
    withNodeEnv('production', () => {
      expect(() => validateJwtSecret(undefined, 'JWT_SECRET')).toThrow(
        /JWT_SECRET is required in production/
      );
    });
  });

  it('throws when secret is an empty string', () => {
    withNodeEnv('production', () => {
      expect(() => validateJwtSecret('', 'JWT_SECRET')).toThrow(
        /JWT_SECRET is required in production/
      );
    });
  });

  it('throws when secret is a whitespace-only string', () => {
    withNodeEnv('production', () => {
      expect(() => validateJwtSecret('   ', 'JWT_SECRET')).toThrow(
        /JWT_SECRET is required in production/
      );
    });
  });

  it('throws for the known default "easy-js-secret-key-change-in-production"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('easy-js-secret-key-change-in-production', 'JWT_SECRET')
      ).toThrow(/known insecure default/);
    });
  });

  it('throws for the known default "dev-secret"', () => {
    withNodeEnv('production', () => {
      expect(() => validateJwtSecret('dev-secret', 'JWT_SECRET')).toThrow(
        /known insecure default/
      );
    });
  });

  it('throws for the known default "dev-refresh"', () => {
    withNodeEnv('production', () => {
      expect(() => validateJwtSecret('dev-refresh', 'REFRESH_SECRET')).toThrow(
        /known insecure default/
      );
    });
  });

  it('throws when secret is shorter than MIN_SECRET_LENGTH', () => {
    withNodeEnv('production', () => {
      const shortSecret = 'x'.repeat(MIN_SECRET_LENGTH - 1);
      expect(() => validateJwtSecret(shortSecret, 'JWT_SECRET')).toThrow(
        /too short/
      );
    });
  });

  it('returns the secret when it is strong and valid', () => {
    withNodeEnv('production', () => {
      expect(validateJwtSecret(STRONG_SECRET, 'JWT_SECRET')).toBe(STRONG_SECRET);
    });
  });

  it('accepts a secret exactly at MIN_SECRET_LENGTH', () => {
    withNodeEnv('production', () => {
      const exactSecret = 'z'.repeat(MIN_SECRET_LENGTH);
      expect(validateJwtSecret(exactSecret, 'JWT_SECRET')).toBe(exactSecret);
    });
  });
});

describe('validateJwtSecret – development / test mode', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Clear call history before each test so counts don't bleed across cases.
    console.warn.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns an ephemeral secret and warns when secret is missing', () => {
    withNodeEnv('development', () => {
      const result = validateJwtSecret(undefined, 'JWT_SECRET');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('ephemeral random secret')
      );
    });
  });

  it('returns the value and warns for a known default secret', () => {
    withNodeEnv('development', () => {
      const result = validateJwtSecret('dev-secret', 'JWT_SECRET');
      expect(result).toBe('dev-secret');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('known insecure default')
      );
    });
  });

  it('returns the value and warns for a short secret', () => {
    withNodeEnv('development', () => {
      const shortSecret = 'short';
      const result = validateJwtSecret(shortSecret, 'JWT_SECRET');
      expect(result).toBe(shortSecret);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('shorter than the recommended')
      );
    });
  });

  it('returns a strong secret without any warning', () => {
    withNodeEnv('development', () => {
      const result = validateJwtSecret(STRONG_SECRET, 'JWT_SECRET');
      expect(result).toBe(STRONG_SECRET);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  it('works the same in test environment (NODE_ENV=test)', () => {
    withNodeEnv('test', () => {
      // Should not throw; should warn for a known default.
      const result = validateJwtSecret('dev-secret', 'JWT_SECRET');
      expect(result).toBe('dev-secret');
      expect(console.warn).toHaveBeenCalled();
    });
  });
});

describe('validateJwtSecret – KNOWN_DEFAULTS set', () => {
  it('contains the expected default values', () => {
    expect(KNOWN_DEFAULTS.has('easy-js-secret-key-change-in-production')).toBe(true);
    expect(KNOWN_DEFAULTS.has('dev-secret')).toBe(true);
    expect(KNOWN_DEFAULTS.has('dev-refresh')).toBe(true);
  });
});

describe('validateJwtSecret – placeholder pattern detection (production)', () => {
  // The two values that triggered this PR review feedback.
  it('throws for "your-refresh-secret-here-change-in-production"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('your-refresh-secret-here-change-in-production', 'REFRESH_TOKEN_SECRET')
      ).toThrow(/known insecure default/);
    });
  });

  it('throws for "your-jwt-refresh-secret-here-change-in-production"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('your-jwt-refresh-secret-here-change-in-production', 'JWT_REFRESH_SECRET')
      ).toThrow(/known insecure default/);
    });
  });

  // Generic "your-*" prefix pattern.
  it('throws for any secret starting with "your-"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('your-super-secret-value-that-is-long-enough', 'JWT_SECRET')
      ).toThrow(/known insecure default/);
    });
  });

  // Generic "*-change-in-production" suffix pattern.
  it('throws for any secret ending with "-change-in-production"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('some-long-placeholder-change-in-production', 'JWT_SECRET')
      ).toThrow(/known insecure default/);
    });
  });

  // Generic "replace-*" prefix pattern.
  it('throws for any secret starting with "replace-"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('replace-with-a-real-secret-that-is-long-enough', 'JWT_SECRET')
      ).toThrow(/known insecure default/);
    });
  });

  // "change-this" exact match.
  it('throws for "change-this"', () => {
    withNodeEnv('production', () => {
      expect(() => validateJwtSecret('change-this', 'JWT_SECRET')).toThrow(
        /known insecure default/
      );
    });
  });

  // Pattern matching is case-insensitive.
  it('throws for mixed-case placeholder "YOUR-SECRET-CHANGE-IN-PRODUCTION"', () => {
    withNodeEnv('production', () => {
      expect(() =>
        validateJwtSecret('YOUR-SECRET-CHANGE-IN-PRODUCTION', 'JWT_SECRET')
      ).toThrow(/known insecure default/);
    });
  });
});

describe('validateJwtSecret – placeholder pattern detection (development)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    console.warn.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warns (does not throw) for placeholder secrets in development', () => {
    withNodeEnv('development', () => {
      const result = validateJwtSecret(
        'your-refresh-secret-here-change-in-production',
        'REFRESH_TOKEN_SECRET'
      );
      expect(result).toBe('your-refresh-secret-here-change-in-production');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('known insecure default')
      );
    });
  });
});

describe('isPlaceholder – unit tests', () => {
  it('returns true for "your-*" prefixed strings', () => {
    expect(isPlaceholder('your-secret')).toBe(true);
    expect(isPlaceholder('your-refresh-secret-here-change-in-production')).toBe(true);
  });

  it('returns true for "*-change-in-production" suffixed strings', () => {
    expect(isPlaceholder('anything-change-in-production')).toBe(true);
  });

  it('returns true for "replace-*" prefixed strings', () => {
    expect(isPlaceholder('replace-me')).toBe(true);
    expect(isPlaceholder('replace-with-real-secret')).toBe(true);
  });

  it('returns true for "change-this"', () => {
    expect(isPlaceholder('change-this')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPlaceholder('YOUR-SECRET')).toBe(true);
    expect(isPlaceholder('REPLACE-ME')).toBe(true);
    expect(isPlaceholder('CHANGE-THIS')).toBe(true);
  });

  it('returns false for a legitimate strong secret', () => {
    expect(isPlaceholder('a'.repeat(MIN_SECRET_LENGTH))).toBe(false);
    expect(isPlaceholder('f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5')).toBe(false);
  });
});

describe('PLACEHOLDER_PATTERNS export', () => {
  it('is an array of RegExp objects', () => {
    expect(Array.isArray(PLACEHOLDER_PATTERNS)).toBe(true);
    expect(PLACEHOLDER_PATTERNS.every((p) => p instanceof RegExp)).toBe(true);
  });
});

describe('AuthManager – uses validateJwtSecret', () => {
  const AuthManager = require('../../core/auth');

  it('throws in production when no JWT secret is provided', () => {
    withNodeEnv('production', () => {
      // Ensure env var is not set
      const original = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        expect(() => new AuthManager()).toThrow(/required in production/);
      } finally {
        if (original !== undefined) process.env.JWT_SECRET = original;
      }
    });
  });

  it('throws in production when a known default secret is provided', () => {
    withNodeEnv('production', () => {
      expect(() =>
        new AuthManager({ jwtSecret: 'easy-js-secret-key-change-in-production' })
      ).toThrow(/known insecure default/);
    });
  });

  it('constructs successfully in production with a strong secret', () => {
    withNodeEnv('production', () => {
      expect(
        () => new AuthManager({ jwtSecret: STRONG_SECRET, refreshSecret: STRONG_SECRET })
      ).not.toThrow();
    });
  });

  it('constructs successfully in development without explicit secrets (warns)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    withNodeEnv('development', () => {
      expect(() => new AuthManager()).not.toThrow();
    });
    jest.restoreAllMocks();
  });
});

describe('RealtimeEngine – uses validateJwtSecret', () => {
  const RealtimeEngine = require('../../core/realtime');

  it('throws in production when no JWT secret is provided', () => {
    withNodeEnv('production', () => {
      const original = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        expect(() => new RealtimeEngine()).toThrow(/required in production/);
      } finally {
        if (original !== undefined) process.env.JWT_SECRET = original;
      }
    });
  });

  it('throws in production when a known default secret is provided', () => {
    withNodeEnv('production', () => {
      expect(() =>
        new RealtimeEngine({ jwtSecret: 'easy-js-secret-key-change-in-production' })
      ).toThrow(/known insecure default/);
    });
  });

  it('constructs successfully in production with a strong secret', () => {
    withNodeEnv('production', () => {
      expect(() => new RealtimeEngine({ jwtSecret: STRONG_SECRET })).not.toThrow();
    });
  });

  it('constructs successfully in development without explicit secrets (warns)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    withNodeEnv('development', () => {
      expect(() => new RealtimeEngine()).not.toThrow();
    });
    jest.restoreAllMocks();
  });
});

describe('EnterpriseAuth – uses validateJwtSecret', () => {
  const EnterpriseAuth = require('../../core/enterpriseAuth');

  it('throws in production when no JWT secret is provided', () => {
    withNodeEnv('production', () => {
      const origJwt = process.env.JWT_SECRET;
      const origRefresh = process.env.REFRESH_TOKEN_SECRET;
      delete process.env.JWT_SECRET;
      delete process.env.REFRESH_TOKEN_SECRET;
      try {
        expect(() => new EnterpriseAuth()).toThrow(/required in production/);
      } finally {
        if (origJwt !== undefined) process.env.JWT_SECRET = origJwt;
        if (origRefresh !== undefined) process.env.REFRESH_TOKEN_SECRET = origRefresh;
      }
    });
  });

  it('throws in production when a known default jwtSecret is provided', () => {
    withNodeEnv('production', () => {
      expect(() =>
        new EnterpriseAuth({ jwtSecret: 'dev-secret', refreshTokenSecret: STRONG_SECRET })
      ).toThrow(/known insecure default/);
    });
  });

  it('throws in production when a known default refreshTokenSecret is provided', () => {
    withNodeEnv('production', () => {
      expect(() =>
        new EnterpriseAuth({ jwtSecret: STRONG_SECRET, refreshTokenSecret: 'dev-refresh' })
      ).toThrow(/known insecure default/);
    });
  });

  it('constructs successfully in production with strong secrets', () => {
    withNodeEnv('production', () => {
      expect(
        () =>
          new EnterpriseAuth({
            jwtSecret: STRONG_SECRET,
            refreshTokenSecret: STRONG_SECRET,
          })
      ).not.toThrow();
    });
  });

  it('constructs successfully in development without explicit secrets (warns)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    withNodeEnv('development', () => {
      expect(() => new EnterpriseAuth()).not.toThrow();
    });
    jest.restoreAllMocks();
  });
});
