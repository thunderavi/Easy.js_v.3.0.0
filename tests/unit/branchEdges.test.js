const fs = require('fs');
const path = require('path');
const os = require('os');

const AIProviderManager = require('../../core/aiProviderManager');
const QueryBuilder = require('../../core/queryBuilder');
const ValidationEngine = require('../../core/validator');
const mockTables = {};
jest.mock('sql.js', () => {
  return jest.fn(async () => {
    return {
      Database: class Database {
        run(sql, values) {
          if (sql.includes('CREATE TABLE')) {
            const tableName = sql.match(/CREATE TABLE IF NOT EXISTS "([^"]+)"/)?.[1] || 'users';
            mockTables[tableName] = mockTables[tableName] || [];
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
              mockTables[tableName] = mockTables[tableName] || [];
              mockTables[tableName].push(record);
            }
            return;
          }
          if (sql.includes('UPDATE')) {
            const tableName = sql.match(/UPDATE "([^"]+)" SET/)?.[1] || 'users';
            const id = values[values.length - 1];
            const record = (mockTables[tableName] || []).find(r => r.id === id);
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
            mockTables[tableName] = (mockTables[tableName] || []).filter(r => r.id !== id);
            return;
          }
        }
        prepare(sql) {
          let tableName = sql.match(/FROM "([^"]+)"/)?.[1] || 'users';
          let rows = [];
          let filteredRows = null;
          if (sql.includes('SELECT COUNT(*)')) {
            rows = [{ count: mockTables[tableName]?.length || 0 }];
          } else if (sql.includes('SELECT * FROM')) {
            rows = mockTables[tableName] || [];
          }
          let index = 0;
          return {
            bind(values) {
              if (sql.includes('WHERE')) {
                if (sql.includes('"id" = ?')) {
                  const id = values[0];
                  filteredRows = (mockTables[tableName] || []).filter(r => r.id === id);
                } else if (sql.includes('"name" = ?')) {
                  const name = values[0];
                  filteredRows = (mockTables[tableName] || []).filter(r => r.name === name);
                }
              }
            },
            step() {
              const activeRows = filteredRows || rows;
              if (sql.includes('SELECT COUNT(*)')) {
                const countVal = filteredRows ? filteredRows.length : (mockTables[tableName]?.length || 0);
                rows = [{ count: countVal }];
                return index < rows.length;
              }
              return index < activeRows.length;
            },
            getAsObject() {
              const activeRows = filteredRows || rows;
              return activeRows[index++];
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

describe('branch edge contracts', () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_MODEL;
    delete process.env.GEMINI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
  });

  it('covers environment-backed AI defaults and empty extraction fallbacks', () => {
    process.env.AI_PROVIDER = 'google';
    process.env.OPENAI_MODEL = 'gpt-env';
    process.env.GEMINI_MODEL = 'gemini-env';
    process.env.ANTHROPIC_MODEL = 'claude-env';

    const manager = new AIProviderManager();

    expect(manager.config.defaultProvider).toBe('google');
    expect(manager.config.openaiModel).toBe('gpt-env');
    expect(manager.config.geminiModel).toBe('gemini-env');
    expect(manager.config.anthropicModel).toBe('claude-env');
    expect(manager.extractOpenAIText({})).toBe('');
    expect(manager.extractOpenAIText({ output: [{}, { content: [{}] }] })).toBe('');
    expect(manager.extractGeminiText({})).toBe('');
    expect(manager.extractGeminiText({ candidates: [{}, { content: { parts: [{}] } }] })).toBe('');
    expect(manager.extractAnthropicText({})).toBe('');
    expect(manager.extractAnthropicText({ content: [{}] })).toBe('');
  });

  it('covers query builder alternate operators, sorting, pagination, joins, and includes', () => {
    const options = QueryBuilder
      .for('users')
      .where('age', 'gte', 18)
      .where('role', 'admin')
      .search('email', 'example.com')
      .select(['id', 'email'])
      .orderBy('created_at', 'DESC')
      .orderBy('name', 'sideways')
      .paginate({ limit: 'bad', page: '-2' })
      .include('posts')
      .join('profiles', 'id', 'user_id', 'inner')
      .toAdapterOptions();

    expect(options).toEqual(expect.objectContaining({
      filter: { age: { $gte: 18 }, role: 'admin' },
      fields: ['id', 'email'],
      sort: { created_at: 'desc', name: 'asc' },
      limit: 20,
      skip: 0,
      includes: ['posts'],
      joins: [{ model: 'profiles', localKey: 'id', foreignKey: 'user_id', type: 'inner' }],
      search: { fields: ['email'], term: 'example.com' }
    }));

    expect(QueryBuilder.for('users').paginate({ limit: 5, offset: 12 }).toAdapterOptions().skip).toBe(12);
  });

  it('covers validation success and failure branches for every rule type', () => {
    const validator = new ValidationEngine();
    validator.loadRules([{
      model: 'users',
      rules: {
        email: 'required:email',
        password: 'min=8:max=12',
        age: 'numeric',
        handle: 'alphanumeric',
        website: 'url',
        phone: 'phone',
        ignored: 'unique:unknown'
      }
    }]);

    expect(validator.validate('users', {
      email: 'bad',
      password: 'short',
      age: 'old',
      handle: 'bad handle!',
      website: 'not-url',
      phone: 'not-phone'
    })).toEqual(expect.objectContaining({
      email: expect.arrayContaining(['email must be a valid email']),
      password: expect.arrayContaining(['password must be at least 8 characters']),
      age: ['age must be numeric'],
      handle: ['handle must be alphanumeric'],
      website: ['website must be a valid URL'],
      phone: ['phone must be a valid phone number']
    }));

    expect(validator.validate('users', {
      email: 'a@example.com',
      password: 'longenough',
      age: 42,
      handle: 'abc123',
      website: 'https://example.com',
      phone: '+14155552671'
    })).toBeNull();
    expect(validator.validateField('password', 'this-password-is-too-long', 'max=12')).toEqual([
      'password must not exceed 12 characters'
    ]);
    expect(validator.validateField('email', '', 'email:min=8:numeric:alphanumeric:url:phone')).toEqual([]);
  });

  it('covers SQLite path, type, persistence, no-op update, and count branches', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-sqlite-'));
    const dbPath = path.join(tempDir, 'test.sqlite');
    const adapter = new SQLiteAdapter();

    expect(adapter.resolvePath(null)).toBe(':memory:');
    expect(adapter.resolvePath('memory')).toBe(':memory:');
    expect(adapter.resolvePath({})).toBe(':memory:');
    expect(adapter.resolvePath({ filename: dbPath })).toBe(dbPath);
    expect(adapter.resolvePath(`sqlite://${dbPath}`)).toBe(dbPath);
    expect(adapter.mapType('boolean')).toBe('INTEGER');
    expect(adapter.mapType('json')).toBe('TEXT');
    expect(adapter.mapType('float')).toBe('REAL');
    expect(adapter.mapType('string')).toBe('TEXT');

    await adapter.connect(dbPath, [
      { name: 'items', fields: { name: 'string', active: 'boolean', meta: 'json', score: 'float' } }
    ]);
    expect(fs.existsSync(dbPath)).toBe(true);

    const created = await adapter.create('items', { name: 'A', active: 1, meta: '{}', score: 1.5 });
    await expect(adapter.update('items', { id: created.id })).resolves.toEqual({ id: created.id });
    await expect(adapter.count('items', { name: 'missing' })).resolves.toBe(0);
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await expect(adapter.query('items', 'missing')).rejects.toThrow('Unknown operation');
    await adapter.close();

    const reopened = new SQLiteAdapter();
    await reopened.connect(dbPath, []);
    await expect(reopened.count('items', {})).resolves.toBe(1);
    await reopened.close();
  });
});
