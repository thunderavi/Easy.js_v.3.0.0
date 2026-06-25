const RouterManager = require('../../core/router');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis()
  };
}

describe('RouterManager', () => {
  it('registers route handlers on an express-like app', () => {
    const manager = new RouterManager();
    const app = { get: jest.fn(), post: jest.fn() };
    manager.registerRoutes(app, [
      { method: 'GET', path: '/posts', model: 'posts' },
      { method: 'POST', path: '/posts', model: 'posts' }
    ], { query: jest.fn() });

    expect(app.get).toHaveBeenCalledWith('/posts', expect.any(Function));
    expect(app.post).toHaveBeenCalledWith('/posts', expect.any(Function));
  });

  it('handles GET list, GET by id, POST, update, and delete operations', async () => {
    const manager = new RouterManager();
    const db = { query: jest.fn().mockResolvedValue({ ok: true }) };

    await manager.createRouteHandler({ method: 'GET', model: 'posts' }, db)(
      { params: {}, query: { limit: 5 }, body: null },
      createResponse()
    );
    expect(db.query).toHaveBeenLastCalledWith('posts', 'findAll', null, {
      limit: 5,
      filter: undefined
    });

    await manager.createRouteHandler({ method: 'GET', model: 'posts' }, db)(
      { params: { id: 'p1' }, query: {}, body: null },
      createResponse()
    );
    expect(db.query).toHaveBeenLastCalledWith('posts', 'findById', 'p1');

    const postRes = createResponse();
    await manager.createRouteHandler({ method: 'POST', model: 'posts' }, db)(
      { params: {}, query: {}, body: { title: 'Hello' } },
      postRes
    );
    expect(db.query).toHaveBeenLastCalledWith('posts', 'create', { title: 'Hello' });
    expect(postRes.status).toHaveBeenCalledWith(201);

    await manager.createRouteHandler({ method: 'PATCH', model: 'posts' }, db)(
      { params: { id: 'p1' }, query: {}, body: { title: 'Updated' } },
      createResponse()
    );
    expect(db.query).toHaveBeenLastCalledWith('posts', 'updateById', {
      id: 'p1',
      updates: { title: 'Updated' }
    });

    const deleteRes = createResponse();
    await manager.createRouteHandler({ method: 'DELETE', model: 'posts' }, db)(
      { params: { id: 'p1' }, query: {}, body: null },
      deleteRes
    );
    expect(db.query).toHaveBeenLastCalledWith('posts', 'deleteById', 'p1');
    expect(deleteRes.status).toHaveBeenCalledWith(204);
  });

  it('returns validation and method errors', async () => {
    const manager = new RouterManager();
    const db = { query: jest.fn() };
    const validator = { validate: jest.fn().mockReturnValue({ title: ['required'] }) };
    const validationRes = createResponse();

    await manager.createRouteHandler({ method: 'POST', model: 'posts' }, db, validator)(
      { params: {}, query: {}, body: {} },
      validationRes
    );

    expect(validationRes.status).toHaveBeenCalledWith(400);
    expect(validationRes.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'Validation failed'
    }));

    const methodRes = createResponse();
    await manager.createRouteHandler({ method: 'TRACE', model: 'posts' }, db)(
      { params: {}, query: {}, body: null },
      methodRes
    );
    expect(methodRes.status).toHaveBeenCalledWith(405);
  });

  it('forwards route errors to next(error) on failure', async () => {
    const manager = new RouterManager();
    const db = {
      query: jest.fn().mockRejectedValue(new Error('Database connection failed'))
    };
    const next = jest.fn();
    const res = createResponse();

    await manager.createRouteHandler({ method: 'GET', model: 'posts' }, db)(
      { params: {}, query: {}, body: null },
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toBe('Database connection failed');
  });

  describe('sanitizeRecord', () => {
    it('removes password from a plain object', () => {
      const manager = new RouterManager();
      const result = manager.sanitizeRecord({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'secret',
        passwordHash: 'hash123',
        hashedPassword: 'hashed'
      });
      expect(result.password).toBeUndefined();
      expect(result.passwordHash).toBeUndefined();
      expect(result.hashedPassword).toBeUndefined();
      expect(result.name).toBe('Alice');
      expect(result.email).toBe('alice@example.com');
    });

    it('removes password from a mongoose-style object with toObject()', () => {
      const manager = new RouterManager();
      const mongooseDoc = {
        name: 'Bob',
        password: 'secret',
        toObject() {
          return { name: 'Bob', password: 'secret' };
        }
      };
      const result = manager.sanitizeRecord(mongooseDoc);
      expect(result.password).toBeUndefined();
      expect(result.name).toBe('Bob');
    });

    it('handles null and undefined safely', () => {
      const manager = new RouterManager();
      expect(manager.sanitizeRecord(null)).toBeNull();
      expect(manager.sanitizeRecord(undefined)).toBeUndefined();
    });
  });

  describe('password sanitization in route responses', () => {
    const userWithPassword = {
      _id: 'u1',
      name: 'Test',
      email: 'test@example.com',
      password: 'plaintext123'
    };

    it('strips password from GET list response', async () => {
      const manager = new RouterManager();
      const db = { query: jest.fn().mockResolvedValue([userWithPassword]) };
      const res = createResponse();

      await manager.createRouteHandler({ method: 'GET', model: 'users' }, db)(
        { params: {}, query: {}, body: null },
        res
      );

      const data = res.json.mock.calls[0][0].data;
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].password).toBeUndefined();
      expect(data[0].email).toBe('test@example.com');
    });

    it('strips password from GET single-record response', async () => {
      const manager = new RouterManager();
      const db = { query: jest.fn().mockResolvedValue(userWithPassword) };
      const res = createResponse();

      await manager.createRouteHandler({ method: 'GET', model: 'users' }, db)(
        { params: { id: 'u1' }, query: {}, body: null },
        res
      );

      const data = res.json.mock.calls[0][0].data;
      expect(data.password).toBeUndefined();
      expect(data.email).toBe('test@example.com');
    });

    it('strips password from POST create response', async () => {
      const manager = new RouterManager();
      const db = { query: jest.fn().mockResolvedValue(userWithPassword) };
      const res = createResponse();

      await manager.createRouteHandler({ method: 'POST', model: 'users' }, db)(
        { params: {}, query: {}, body: { name: 'Test', email: 'test@example.com', password: 'plaintext123' } },
        res
      );

      const data = res.json.mock.calls[0][0].data;
      expect(data.password).toBeUndefined();
      expect(data.email).toBe('test@example.com');
    });

    it('strips password from PUT/PATCH update response', async () => {
      const manager = new RouterManager();
      const db = { query: jest.fn().mockResolvedValue(userWithPassword) };
      const res = createResponse();

      await manager.createRouteHandler({ method: 'PATCH', model: 'users' }, db)(
        { params: { id: 'u1' }, query: {}, body: { name: 'Updated' } },
        res
      );

      const data = res.json.mock.calls[0][0].data;
      expect(data.password).toBeUndefined();
      expect(data.email).toBe('test@example.com');
    });
  });
});
