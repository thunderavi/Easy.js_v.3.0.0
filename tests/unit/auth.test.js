const AuthManager = require('../../core/auth');
const { DatabaseAuthStore, MemoryAuthStore } = require('../../core/authStore');

const JWT_SECRET = 'test-access-secret-at-least-32-characters';
const REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';

describe('AuthManager', () => {
  it('selects memory or database auth stores from constructor options', () => {
    const memoryAuth = new AuthManager({
      jwtSecret: JWT_SECRET,
      refreshSecret: REFRESH_SECRET
    });
    expect(memoryAuth.store).toBeInstanceOf(MemoryAuthStore);

    const knex = jest.fn();
    const databaseAuth = new AuthManager({
      jwtSecret: JWT_SECRET,
      refreshSecret: REFRESH_SECRET,
      knex
    });
    expect(databaseAuth.store).toBeInstanceOf(DatabaseAuthStore);
    expect(databaseAuth.store.knex).toBe(knex);
  });

  it('issues, verifies, rotates, and revokes token pairs', async () => {
    const auth = new AuthManager({
      jwtSecret: JWT_SECRET,
      refreshSecret: REFRESH_SECRET,
      jwtExpiry: '1h',
      refreshExpiry: '1h'
    });

    const pair = await auth.issueTokenPair('user-1', { role: 'admin' });
    expect(auth.verifyToken(pair.accessToken)).toEqual(expect.objectContaining({
      userId: 'user-1',
      role: 'admin'
    }));

    const refreshPayload = await auth.verifyRefreshToken(pair.refreshToken);
    expect(refreshPayload.userId).toBe('user-1');

    const nextPair = await auth.rotateRefreshToken(pair.refreshToken, { role: 'admin' });
    expect(nextPair.accessToken).toBeDefined();
    await expect(auth.verifyRefreshToken(pair.refreshToken)).rejects.toThrow('Invalid refresh token');
  });

  it('hashes passwords and logs users in through a database adapter', async () => {
    const auth = new AuthManager({ jwtSecret: 'secret', refreshSecret: 'refresh' });
    auth.initialize({ model: 'users', type: 'jwt' });
    const password = await auth.hashPassword('correct-password');
    const db = {
      query: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        password,
        role: 'user'
      })
    };

    const result = await auth.loginUser('test@example.com', 'correct-password', db);

    expect(result.success).toBe(true);
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      name: undefined,
      role: 'user'
    });
    expect(auth.verifyToken(result.token).email).toBe('test@example.com');
  });

  it('registers users with hashed passwords', async () => {
    const auth = new AuthManager({ jwtSecret: 'secret', refreshSecret: 'refresh' });
    auth.initialize({ model: 'users', type: 'jwt' });
    const db = {
      query: jest.fn(async (model, operation, data) => ({
        id: 'created-1',
        email: data.email,
        password: data.password
      }))
    };

    const result = await auth.registerUser({
      email: 'new@example.com',
      password: 'plain-password'
    }, db);

    expect(result.success).toBe(true);
    expect(db.query).toHaveBeenCalledWith('users', 'create', expect.objectContaining({
      email: 'new@example.com',
      password: expect.not.stringMatching(/^plain-password$/)
    }));
  });

  it('supports password reset and email verification tokens', async () => {
    const auth = new AuthManager({ resetTokenExpiryMs: 1000, verificationTokenExpiryMs: 1000 });
    auth.initialize({ model: 'users', type: 'jwt' });
    const db = { query: jest.fn().mockResolvedValue({ ok: true }) };

    const resetToken = await auth.createPasswordResetToken('user-1');
    await expect(auth.resetPassword(resetToken, 'new-password', db)).resolves.toEqual({
      success: true,
      userId: 'user-1'
    });
    await expect(auth.resetPassword(resetToken, 'again', db)).rejects.toThrow('invalid or expired');

    const verifyToken = await auth.createEmailVerificationToken('user-1', 'user@example.com');
    await expect(auth.verifyEmail(verifyToken, db)).resolves.toEqual({
      success: true,
      userId: 'user-1',
      email: 'user@example.com'
    });
  });

  it('enforces JWT middleware and role middleware responses', () => {
    const auth = new AuthManager({ jwtSecret: 'secret' });
    const next = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    auth.jwtMiddleware()({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);

    const req = {
      headers: {
        authorization: `Bearer ${auth.generateToken('user-1', { role: 'admin' })}`
      }
    };
    auth.jwtMiddleware()(req, res, next);
    expect(req.user.userId).toBe('user-1');
    expect(next).toHaveBeenCalled();

    const roleNext = jest.fn();
    auth.requireRole('admin')({ user: { role: 'admin' } }, res, roleNext);
    expect(roleNext).toHaveBeenCalled();
  });

  describe('Cleanup Timer', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('starts cleanup timer if cleanupIntervalMs > 0', () => {
      const auth = new AuthManager({ cleanupIntervalMs: 5000 });
      expect(auth._cleanupTimer).not.toBeNull();
      
      const cleanupSpy = jest.spyOn(auth, 'cleanupExpired').mockResolvedValue({ removed: 0 });
      
      jest.advanceTimersByTime(5000);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      
      jest.advanceTimersByTime(5000);
      expect(cleanupSpy).toHaveBeenCalledTimes(2);
      
      auth.stopCleanup();
      expect(auth._cleanupTimer).toBeNull();
      
      jest.advanceTimersByTime(5000);
      expect(cleanupSpy).toHaveBeenCalledTimes(2); // Should not increase
    });

    it('does not start cleanup timer if cleanupIntervalMs is 0', () => {
      const auth = new AuthManager({ cleanupIntervalMs: 0 });
      expect(auth._cleanupTimer).toBeNull();
    });

    it('delegates cleanupExpired to the store', async () => {
      const auth = new AuthManager({ cleanupIntervalMs: 0 });
      auth.store.cleanupExpired = jest.fn().mockResolvedValue({ removed: 5 });
      const result = await auth.cleanupExpired();
      expect(auth.store.cleanupExpired).toHaveBeenCalled();
      expect(result).toEqual({ removed: 5 });
    });
  });
});
