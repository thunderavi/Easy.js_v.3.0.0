jest.mock('sql.js', () => {
  return jest.fn(async () => {
    const tables = {};
    return {
      Database: class Database {
        run(sql, values) {
          if (sql.includes('CREATE TABLE')) {
            const tableName = sql.match(/CREATE TABLE IF NOT EXISTS "([^"]+)"/)?.[1] || 'users';
            tables[tableName] = [];
            return;
          }
          if (sql.includes('INSERT INTO')) {
            const tableName = sql.match(/INSERT INTO "([^"]+)"/)?.[1] || 'users';
            const keysMatch = sql.match(/\(([^)]+)\)/);
            if (keysMatch) {
              const keys = keysMatch[1].split(',').map(s => s.replace(/"/g, '').trim());
              const record = {};
              keys.forEach((key, idx) => {
                record[key] = values[idx];
              });
              tables[tableName].push(record);
            }
            return;
          }
          if (sql.includes('UPDATE')) {
            const tableName = sql.match(/UPDATE "([^"]+)" SET/)?.[1] || 'users';
            const id = values[values.length - 1];
            const record = tables[tableName].find(r => r.id === id);
            if (record) {
              const setPart = sql.match(/SET\s+([\s\S]+?)\s+WHERE/)?.[1] || '';
              const keys = setPart.split(',').map(part => part.trim().split('=')[0].replace(/"/g, '').trim()).filter(k => k && k !== 'updated_at');
              keys.forEach((key, idx) => {
                record[key] = values[idx];
              });
            }
            return;
          }
          if (sql.includes('DELETE FROM')) {
            const tableName = sql.match(/DELETE FROM "([^"]+)"/)?.[1] || 'users';
            const id = values[0];
            tables[tableName] = tables[tableName].filter(r => r.id !== id);
            return;
          }
        }
        prepare(sql) {
          let rows = [];
          if (sql.includes('SELECT COUNT(*)')) {
            const tableName = sql.match(/FROM "([^"]+)"/)?.[1] || 'users';
            rows = [{ count: tables[tableName]?.length || 0 }];
          } else if (sql.includes('SELECT * FROM')) {
            const tableName = sql.match(/FROM "([^"]+)"/)?.[1] || 'users';
            rows = tables[tableName] || [];
          }
          let index = 0;
          return {
            bind(values) {
              if (sql.includes('SELECT * FROM') && sql.includes('WHERE "id" = ?')) {
                const id = values[0];
                rows = (tables['users'] || []).filter(r => r.id === id);
              }
            },
            step() {
              return index < rows.length;
            },
            getAsObject() {
              return rows[index++];
            },
            free() {}
          };
        }
        export() {
          return new Uint8Array();
        }
        close() {}
      }
    };
  });
}, { virtual: true });

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
