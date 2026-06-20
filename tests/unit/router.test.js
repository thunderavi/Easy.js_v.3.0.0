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
});
