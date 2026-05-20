const SQLiteAdapter = require('../../adapters/sqlite');

describe('SQLiteAdapter', () => {
  let adapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter();
    await adapter.connect(':memory:', [
      { name: 'users', fields: { email: 'string', age: 'number' } }
    ]);
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('performs canonical CRUD operations offline', async () => {
    const created = await adapter.query('users', 'create', { email: 'a@example.com', age: 30 });
    expect(created.id).toBeDefined();

    const found = await adapter.query('users', 'findOne', { id: created.id });
    expect(found.email).toBe('a@example.com');

    await adapter.query('users', 'update', { id: created.id, age: 31 });
    const updated = await adapter.query('users', 'findOne', { id: created.id });
    expect(Number(updated.age)).toBe(31);

    expect(await adapter.query('users', 'count', {})).toBe(1);
    await adapter.query('users', 'delete', { id: created.id });
    expect(await adapter.query('users', 'count', {})).toBe(0);
  });
});
