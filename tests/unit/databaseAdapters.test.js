jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));
jest.mock('mssql', () => ({ connect: jest.fn() }));
jest.mock('@libsql/client', () => ({ createClient: jest.fn() }));
jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('@elastic/elasticsearch', () => ({ Client: jest.fn() }));
jest.mock('mongoose', () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  Schema: jest.fn(function Schema(definition, options) {
    this.definition = definition;
    this.options = options;
  }),
  model: jest.fn(),
  models: {}
}));
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn(credentials => ({ credentials })) },
  firestore: jest.fn()
}));
jest.mock('cassandra-driver', () => ({
  Client: jest.fn(),
  auth: {
    PlainTextAuthProvider: jest.fn((username, password) => ({ username, password }))
  },
  types: { uuid: jest.fn(() => ({ toString: () => 'cass-id' })) }
}));
jest.mock('neo4j-driver', () => ({
  driver: jest.fn(),
  auth: { basic: jest.fn((user, password) => ({ user, password })) }
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
  waitUntilTableExists: jest.fn(),
  CreateTableCommand: class CreateTableCommand {
    constructor(input) { this.input = input; }
  }
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn() },
  DeleteCommand: class DeleteCommand { constructor(input) { this.input = input; } },
  GetCommand: class GetCommand { constructor(input) { this.input = input; } },
  PutCommand: class PutCommand { constructor(input) { this.input = input; } },
  QueryCommand: class QueryCommand { constructor(input) { this.input = input; } },
  ScanCommand: class ScanCommand { constructor(input) { this.input = input; } },
  UpdateCommand: class UpdateCommand { constructor(input) { this.input = input; } }
}));

const { Pool } = require('pg');
const mysql = require('mysql2/promise');
const mssql = require('mssql');
const libsql = require('@libsql/client');
const redis = require('redis');
const supabase = require('@supabase/supabase-js');
const { Client: ElasticsearchClient } = require('@elastic/elasticsearch');
const mongoose = require('mongoose');
const firebaseAdmin = require('firebase-admin');
const cassandra = require('cassandra-driver');
const neo4j = require('neo4j-driver');
const { DynamoDBClient, CreateTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');
const {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const PostgreSQLAdapter = require('../../adapters/postgresql');
const MySQLAdapter = require('../../adapters/mysql');
const MSSQLAdapter = require('../../adapters/mssql');
const LibSQLAdapter = require('../../adapters/libsql');
const RedisAdapter = require('../../adapters/redis');
const SupabaseAdapter = require('../../adapters/supabase');
const ElasticsearchAdapter = require('../../adapters/elasticsearch');
const MongoDBAdapter = require('../../adapters/mongodb');
const OptionalPackageAdapter = require('../../adapters/optionalPackage');
const FirebaseAdapter = require('../../adapters/firebase');
const CassandraAdapter = require('../../adapters/cassandra');
const Neo4jAdapter = require('../../adapters/neo4j');
const DynamoDBAdapter = require('../../adapters/dynamodb');

const model = { name: 'users', fields: { email: 'string', age: 'number', active: 'boolean' } };

function record(properties) {
  return { get: jest.fn(() => ({ properties })) };
}

function makeSupabaseBuilder(result = { data: [], error: null, count: 0 }) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    range: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(result)),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return builder;
}

describe('database adapter contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('covers PostgreSQL connection, CRUD, transactions, and close', async () => {
    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: '1', email: 'a@example.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: '1', email: 'created@example.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: '1', email: 'updated@example.com' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] })
        .mockResolvedValueOnce({ rows: [{ count: '4' }] })
        .mockResolvedValueOnce({ rows: [] }),
      connect: jest.fn().mockResolvedValue(client),
      end: jest.fn()
    };
    Pool.mockImplementation(() => pool);

    const adapter = new PostgreSQLAdapter();
    await adapter.connect('postgres://user:pass@localhost/db', [model]);

    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: expect.stringContaining('postgres://') }));
    expect(pool.query.mock.calls[1][0]).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(await adapter.query('users', 'findMany', { email: 'a@example.com' }, { sort: 'age', limit: 5, skip: 2 }))
      .toEqual([{ id: '1', email: 'a@example.com' }]);
    expect(pool.query.mock.calls[2]).toEqual([
      'SELECT * FROM "users" WHERE "email" = $1 ORDER BY "age" LIMIT 5 OFFSET 2',
      ['a@example.com']
    ]);
    expect(await adapter.query('users', 'create', { email: 'created@example.com' })).toEqual({ id: '1', email: 'created@example.com' });
    expect(await adapter.query('users', 'update', { id: '1', email: 'updated@example.com' })).toEqual({ id: '1', email: 'updated@example.com' });
    expect(await adapter.query('users', 'delete', { id: '1' })).toEqual({ deleted: 1, rows: [{ id: '1' }] });
    expect(await adapter.query('users', 'count', {})).toBe(4);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(new PostgreSQLAdapter().query('users', 'count')).rejects.toThrow('PostgreSQL not connected');

    await expect(adapter.transaction(async trx => {
      expect(trx).toBe(client);
      return 'ok';
    })).resolves.toBe('ok');
    expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'COMMIT']);

    client.query.mockClear();
    await expect(adapter.transaction(() => { throw new Error('EXPECTED_ERROR'); })).rejects.toThrow('EXPECTED_ERROR');
    expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'ROLLBACK']);

    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(pool.end).toHaveBeenCalled();
    expect(adapter.connected).toBe(false);
  });

  it('covers MySQL URL parsing, CRUD, transactions, and close', async () => {
    const conn = { beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
    const pool = {
      query: jest.fn().mockResolvedValue([[]]),
      execute: jest.fn()
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([[{ id: '1', email: 'a@example.com' }]])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{ affectedRows: 2 }])
        .mockResolvedValueOnce([[{ count: 2 }]]),
      getConnection: jest.fn().mockResolvedValue(conn),
      end: jest.fn()
    };
    mysql.createPool.mockResolvedValue(pool);

    const adapter = new MySQLAdapter();
    await adapter.connect('mysql://root:secret@localhost:3307/app?ssl=true', [model]);

    expect(mysql.createPool).toHaveBeenCalledWith(expect.objectContaining({
      host: 'localhost',
      user: 'root',
      password: 'secret',
      database: 'app',
      port: 3307,
      ssl: {}
    }));
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'create', { id: '2', email: 'b@example.com' })).toEqual({ id: '2', email: 'b@example.com' });
    expect(await adapter.query('users', 'update', { id: '2', email: 'c@example.com' })).toEqual({ id: '2', email: 'c@example.com' });
    expect(await adapter.query('users', 'delete', { email: 'c@example.com' })).toEqual({ deleted: 2 });
    expect(await adapter.query('users', 'count', {})).toBe(2);
    expect(adapter.parseConnection('not-a-url')).toEqual(expect.objectContaining({ host: 'localhost', database: 'easy_db' }));
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');

    await expect(adapter.transaction(async trx => trx)).resolves.toBe(conn);
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
    conn.beginTransaction.mockClear();
    await expect(adapter.transaction(() => { throw new Error('EXPECTED_ERROR'); })).rejects.toThrow('EXPECTED_ERROR');
    expect(conn.rollback).toHaveBeenCalled();

    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(pool.end).toHaveBeenCalled();
  });

  it('covers MSSQL query helpers and lifecycle', async () => {
    const request = {
      input: jest.fn(function input() { return this; }),
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ recordset: [{ id: '1' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowsAffected: [3] })
        .mockResolvedValueOnce({ recordset: [{ count: 3 }] })
        .mockResolvedValueOnce({})
    };
    const pool = { request: jest.fn(() => request), close: jest.fn() };
    mssql.connect.mockResolvedValue(pool);

    const adapter = new MSSQLAdapter();
    await adapter.connect('mssql://sa:secret@db.example.com:1444/app?encrypt=false&trustServerCertificate=true', [model]);

    expect(mssql.connect).toHaveBeenCalledWith(expect.objectContaining({
      server: 'db.example.com',
      port: 1444,
      user: 'sa',
      password: 'secret',
      database: 'app',
      options: { encrypt: false, trustServerCertificate: true }
    }));
    expect(adapter.mapType('boolean')).toBe('BIT');
    expect(await adapter.query('users', 'findMany', { email: 'a@example.com' }, { limit: 7 })).toEqual([{ id: '1' }]);
    expect(request.input).toHaveBeenCalledWith('p0', 'a@example.com');
    expect(await adapter.query('users', 'create', { id: '2', email: 'b@example.com' })).toEqual({ id: '2', email: 'b@example.com' });
    expect(await adapter.query('users', 'update', { id: '2', email: 'c@example.com' })).toEqual({ id: '2', email: 'c@example.com' });
    expect(await adapter.query('users', 'delete', { id: '2' })).toEqual({ deleted: 3 });
    expect(await adapter.query('users', 'count', {})).toBe(3);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(pool.close).toHaveBeenCalled();
  });

  it('covers LibSQL CRUD and lifecycle', async () => {
    const client = {
      execute: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: '1', email: 'a@example.com' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ count: 5 }] })
        .mockResolvedValueOnce({ rows: [] }),
      close: jest.fn()
    };
    libsql.createClient.mockReturnValue(client);

    const adapter = new LibSQLAdapter();
    await adapter.connect('file:local.db', [model]);

    expect(libsql.createClient).toHaveBeenCalledWith({ url: 'file:local.db' });
    expect(adapter.mapType('number')).toBe('INTEGER');
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'create', { id: '2', email: 'b@example.com' })).toEqual({ id: '2', email: 'b@example.com' });
    expect(await adapter.query('users', 'update', { id: '2', email: 'changed@example.com' })).toEqual({ id: '2', email: 'changed@example.com' });
    expect(await adapter.query('users', 'delete', { id: '2' })).toEqual({ deleted: true });
    expect(await adapter.query('users', 'count', {})).toBe(5);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(client.close).toHaveBeenCalled();
  });

  it('covers Redis in-memory style operations over a mocked client', async () => {
    const store = new Map();
    const sets = new Map();
    const client = {
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn(key => Promise.resolve(store.get(key) || null)),
      set: jest.fn((key, value) => { store.set(key, value); return Promise.resolve(); }),
      sAdd: jest.fn((key, value) => {
        if (!sets.has(key)) sets.set(key, new Set());
        sets.get(key).add(value);
        return Promise.resolve();
      }),
      sMembers: jest.fn(key => Promise.resolve([...sets.get(key) || []])),
      del: jest.fn(key => { store.delete(key); return Promise.resolve(); }),
      sRem: jest.fn((key, value) => { sets.get(key)?.delete(value); return Promise.resolve(); }),
      sCard: jest.fn(key => Promise.resolve((sets.get(key) || new Set()).size)),
      ping: jest.fn(),
      quit: jest.fn()
    };
    redis.createClient.mockReturnValue(client);

    const adapter = new RedisAdapter();
    await adapter.connect({ url: 'redis://cache:6379' });

    expect(redis.createClient).toHaveBeenCalledWith({ url: 'redis://cache:6379' });
    const created = await adapter.query('users', 'create', { id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'findOne', { id: created.id })).toEqual(created);
    expect(await adapter.query('users', 'findMany', { email: 'a@example.com' })).toEqual([created]);
    expect(await adapter.query('users', 'update', { id: '1', age: 30 })).toEqual(expect.objectContaining({ id: '1', age: 30 }));
    expect(await adapter.query('users', 'count')).toBe(1);
    expect(await adapter.query('users', 'delete', { id: '1' })).toEqual({ deleted: 1 });
    expect(await adapter.query('users', 'findOne', {})).toBeNull();
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(client.quit).toHaveBeenCalled();
  });

  it('covers MongoDB model building, operations, health, and disconnect aliases', async () => {
    const mongoModel = {
      find: jest.fn(() => ({ limit: jest.fn(limit => Promise.resolve([{ limit }])) })),
      findById: jest.fn(id => Promise.resolve({ id })),
      findOne: jest.fn(query => Promise.resolve({ query })),
      create: jest.fn(data => Promise.resolve({ id: 'created', ...data })),
      findByIdAndUpdate: jest.fn((id, data, options) => Promise.resolve({ id, data, options })),
      findByIdAndDelete: jest.fn(id => Promise.resolve({ id, deleted: true })),
      deleteMany: jest.fn(query => Promise.resolve({ deletedCount: 2, query })),
      countDocuments: jest.fn(query => Promise.resolve(Object.keys(query).length))
    };
    mongoose.connect.mockResolvedValue({ connection: 'ok' });
    mongoose.model.mockReturnValue(mongoModel);

    const adapter = new MongoDBAdapter();
    await adapter.connect('mongodb://localhost/app', [{ name: 'User', schema: { email: String } }]);

    expect(mongoose.connect).toHaveBeenCalledWith('mongodb://localhost/app', {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    expect(mongoose.Schema).toHaveBeenCalledWith({ email: String }, {
      timestamps: true,
      collection: 'user'
    });
    expect(await adapter.query('User', 'findMany', { active: true }, { limit: 3 })).toEqual([{ limit: 3 }]);
    expect(await adapter.query('User', 'findOne', { id: '1' })).toEqual({ id: '1' });
    expect(await adapter.query('User', 'findOne', { email: 'a@example.com' })).toEqual({ query: { email: 'a@example.com' } });
    expect(await adapter.query('User', 'create', { email: 'new@example.com' })).toEqual({ id: 'created', email: 'new@example.com' });
    expect(await adapter.query('User', 'update', { id: '1', email: 'changed@example.com' }))
      .toEqual({ id: '1', data: { email: 'changed@example.com', id: undefined }, options: { new: true } });
    expect(await adapter.query('User', 'delete', { id: '1' })).toEqual({ id: '1', deleted: true });
    expect(await adapter.query('User', 'delete', { active: false })).toEqual({ deletedCount: 2, query: { active: false } });
    expect(await adapter.query('User', 'count', { active: true })).toBe(1);
    await expect(adapter.query('Missing', 'findMany')).rejects.toThrow("Model 'Missing' not found");
    await expect(adapter.query('User', 'missing')).rejects.toThrow('Unknown operation');
    expect(await adapter.healthCheck()).toEqual({ status: 'connected' });
    await adapter.disconnect();
    expect(mongoose.disconnect).toHaveBeenCalled();
    expect(adapter.connected).toBe(false);
  });

  it('covers optional package adapter failure messages', async () => {
    const MissingOracle = OptionalPackageAdapter.for('oracle', 'definitely-missing-oracledb');
    await expect(new MissingOracle().connect()).rejects.toThrow('requires the optional package "definitely-missing-oracledb"');

    const NodeFsBacked = OptionalPackageAdapter.for('custom', 'fs');
    await expect(new NodeFsBacked().connect()).rejects.toThrow('requires a provider-specific adapter implementation');
  });

  it('covers Supabase query builder flows', async () => {
    const builders = [
      makeSupabaseBuilder({ data: { id: '1', email: 'a@example.com' }, error: null }),
      makeSupabaseBuilder({ data: [{ id: '2' }], error: null }),
      makeSupabaseBuilder({ data: [{ id: '3' }], error: null }),
      makeSupabaseBuilder({ data: [{ id: '4' }], error: null }),
      makeSupabaseBuilder({ error: null }),
      makeSupabaseBuilder({ count: 8 })
    ];
    const client = { from: jest.fn(() => builders.shift()) };
    supabase.createClient.mockReturnValue(client);

    const adapter = new SupabaseAdapter();
    await adapter.connect({ url: 'https://example.supabase.co', key: 'anon' }, [model]);

    expect(supabase.createClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon');
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'findMany', { active: true }, { limit: 2, skip: 5 })).toEqual([{ id: '2' }]);
    expect(await adapter.query('users', 'create', { email: 'b@example.com' })).toEqual({ id: '3' });
    expect(await adapter.query('users', 'update', { id: '4', email: 'c@example.com' })).toEqual({ id: '4' });
    expect(await adapter.query('users', 'delete', { id: '4' })).toEqual({ deleted: true });
    expect(await adapter.query('users', 'count', { active: true })).toBe(8);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(new SupabaseAdapter().query('users', 'count')).rejects.toThrow('Supabase not connected');
    expect(await adapter.healthCheck()).toEqual({ status: 'connected' });
    await adapter.close();
    expect(adapter.connected).toBe(false);
  });

  it('covers Elasticsearch index, search, CRUD, and close paths', async () => {
    const client = {
      ping: jest.fn(),
      indices: {
        create: jest.fn()
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce({ statusCode: 400 })
      },
      search: jest.fn()
        .mockResolvedValueOnce({ hits: { hits: [{ _id: '1', _source: { email: 'a@example.com' } }] } })
        .mockResolvedValueOnce({ hits: { hits: [{ _id: '2', _source: { email: 'b@example.com' } }] } })
        .mockResolvedValueOnce({ hits: { hits: [{ _id: '3', _source: { email: 'search@example.com' } }] } }),
      index: jest.fn().mockResolvedValue({ _id: '4' }),
      update: jest.fn(),
      deleteByQuery: jest.fn().mockResolvedValue({ deleted: 2 }),
      count: jest.fn().mockResolvedValue({ count: 6 }),
      close: jest.fn()
    };
    ElasticsearchClient.mockImplementation(() => client);

    const adapter = new ElasticsearchAdapter();
    await adapter.connect({ node: 'http://search:9200', auth: { username: 'u', password: 'p' } }, [model]);
    await adapter.createIndex('users');

    expect(ElasticsearchClient).toHaveBeenCalledWith(expect.objectContaining({ node: 'http://search:9200' }));
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ email: 'a@example.com' });
    expect(await adapter.query('users', 'findMany', {}, { limit: 2, skip: 1 })).toEqual([{ id: '2', email: 'b@example.com' }]);
    expect(await adapter.query('users', 'search', 'example', { fields: ['email'], limit: 3 })).toEqual([{ id: '3', email: 'search@example.com' }]);
    expect(await adapter.query('users', 'create', { email: 'new@example.com' })).toEqual({ id: '4', email: 'new@example.com' });
    expect(await adapter.query('users', 'update', { id: '4', email: 'changed@example.com' })).toEqual({ id: '4', email: 'changed@example.com' });
    expect(await adapter.query('users', 'delete', { email: 'changed@example.com' })).toEqual({ deleted: 2 });
    expect(await adapter.query('users', 'count', {})).toBe(6);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(new ElasticsearchAdapter().query('users', 'count')).rejects.toThrow('Elasticsearch not connected');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(client.close).toHaveBeenCalled();
  });

  it('covers Firebase collection queries and lifecycle', async () => {
    const docs = [
      { id: '1', data: () => ({ email: 'a@example.com' }), ref: { delete: jest.fn() } },
      { id: '2', data: () => ({ email: 'b@example.com' }), ref: { delete: jest.fn() } }
    ];
    const chain = {
      doc: jest.fn(() => ({ set: jest.fn(), update: jest.fn() })),
      set: jest.fn(),
      where: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      orderBy: jest.fn(() => chain),
      offset: jest.fn(() => chain),
      get: jest.fn().mockResolvedValue({ empty: false, docs, size: docs.length }),
      add: jest.fn().mockResolvedValue({ id: 'new-id' })
    };
    const db = {
      collection: jest.fn(() => chain),
      runTransaction: jest.fn(async callback => callback('trx'))
    };
    firebaseAdmin.firestore.mockReturnValue(db);

    const adapter = new FirebaseAdapter();
    await adapter.connect({ credentials: { projectId: 'p' }, databaseURL: 'https://db' }, [model]);

    expect(firebaseAdmin.initializeApp).toHaveBeenCalled();
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'findMany', { active: true }, { sort: 'email', limit: 2, skip: 1 }))
      .toEqual([{ id: '1', email: 'a@example.com' }, { id: '2', email: 'b@example.com' }]);
    expect(await adapter.query('users', 'create', { email: 'new@example.com' })).toEqual({ id: 'new-id', email: 'new@example.com' });
    expect(await adapter.query('users', 'update', { id: '1', email: 'changed@example.com' })).toEqual({ id: '1', email: 'changed@example.com' });
    expect(await adapter.query('users', 'delete', { email: 'b@example.com' })).toEqual({ deleted: 2 });
    expect(await adapter.query('users', 'count', {})).toBe(2);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(new FirebaseAdapter().query('users', 'count')).rejects.toThrow('Firebase not connected');
    await expect(adapter.transaction(async trx => trx)).resolves.toBe('trx');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(adapter.connected).toBe(false);
  });

  it('covers Cassandra schema, CRUD, count, health, and close', async () => {
    const client = {
      connect: jest.fn(),
      execute: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: '1' }] })
        .mockResolvedValueOnce({ rows: [{ id: '1' }, { id: '2' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ count: '9' }] })
        .mockResolvedValueOnce({ rows: [] }),
      shutdown: jest.fn()
    };
    cassandra.Client.mockImplementation(() => client);

    const adapter = new CassandraAdapter();
    await adapter.connect({ contactPoints: ['db'], localDataCenter: 'dc1', keyspace: 'app' }, [model]);

    expect(cassandra.Client).toHaveBeenCalledWith({ contactPoints: ['db'], localDataCenter: 'dc1' });
    expect(adapter.buildClientConfig({
      contactPoints: ['secure-db'],
      localDataCenter: 'dc2',
      username: 'user',
      password: 'pass',
      ssl: true,
      secureConnectBundle: 'secure-connect.zip'
    })).toEqual({
      contactPoints: ['secure-db'],
      localDataCenter: 'dc2',
      authProvider: { username: 'user', password: 'pass' },
      sslOptions: {},
      cloud: { secureConnectBundle: 'secure-connect.zip' }
    });
    expect(adapter.buildClientConfig({
      sslOptions: { ca: 'cert' },
      cloud: { secureConnectBundle: 'cloud.zip' }
    })).toEqual(expect.objectContaining({
      sslOptions: { ca: 'cert' },
      cloud: { secureConnectBundle: 'cloud.zip' }
    }));
    expect(adapter.mapType('json')).toBe('text');
    expect(await adapter.query('users', 'findOne', { id: '1' })).toEqual({ id: '1' });
    expect(await adapter.query('users', 'findMany', { email: 'a@example.com' }, { limit: 2 })).toEqual([{ id: '1' }, { id: '2' }]);
    expect(await adapter.query('users', 'create', { email: 'new@example.com' })).toEqual({ id: 'cass-id', email: 'new@example.com' });
    expect(await adapter.query('users', 'update', { id: '1', email: 'changed@example.com' })).toEqual({ id: '1', email: 'changed@example.com' });
    expect(await adapter.query('users', 'delete', { id: '1' })).toEqual({ deleted: true });
    expect(await adapter.query('users', 'count', { active: true })).toBe(9);
    await expect(adapter.findOne('bad-name', { id: '1' })).rejects.toThrow('Invalid table name');
    await expect(adapter.findMany('users', { 'bad-name': 'x' })).rejects.toThrow('Invalid column name');
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(new CassandraAdapter().query('users', 'findMany')).rejects.toThrow('Cassandra not connected');
    await expect(new CassandraAdapter().connect({ keyspace: 'bad-name' }, [])).rejects.toThrow('Invalid keyspace');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(client.shutdown).toHaveBeenCalled();
  });

  it('covers Neo4j parsing, constraints, CRUD, count, health, and close', async () => {
    const session = {
      run: jest.fn()
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [record({ id: '1', email: 'a@example.com' })] })
        .mockResolvedValueOnce({ records: [record({ id: '2', email: 'created@example.com' })] })
        .mockResolvedValueOnce({ records: [record({ id: '2', email: 'updated@example.com' })] })
        .mockResolvedValueOnce({ summary: { counters: { updates: () => ({ nodesDeleted: 2 }) } } })
        .mockResolvedValueOnce({ records: [{ get: jest.fn(() => ({ toString: () => '7' })) }] }),
      close: jest.fn()
    };
    const driver = { session: jest.fn(() => session), verifyConnectivity: jest.fn(), close: jest.fn() };
    neo4j.driver.mockReturnValue(driver);

    const adapter = new Neo4jAdapter();
    await adapter.connect('neo4j://neo4j:secret@localhost:7687', [model]);

    expect(neo4j.auth.basic).toHaveBeenCalledWith('neo4j', 'secret');
    expect(neo4j.driver).toHaveBeenCalledWith('neo4j://localhost:7687', { user: 'neo4j', password: 'secret' });
    expect(adapter.where({ email: 'a@example.com' })).toEqual({
      clause: ' WHERE n.email = $p0',
      params: { p0: 'a@example.com' }
    });
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'create', { id: '2', email: 'created@example.com' })).toEqual({ id: '2', email: 'created@example.com' });
    expect(await adapter.query('users', 'update', { id: '2', email: 'updated@example.com' })).toEqual({ id: '2', email: 'updated@example.com' });
    expect(await adapter.query('users', 'delete', { email: 'updated@example.com' })).toEqual({ deleted: 2 });
    expect(await adapter.query('users', 'count', {})).toBe(7);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    await adapter.close();
    expect(driver.close).toHaveBeenCalled();
  });

  it('covers DynamoDB commands, not-connected guards, and close', async () => {
    const dynamodb = {
      send: jest.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({ name: 'ResourceInUseException' }),
      destroy: jest.fn()
    };
    const documentClient = {
      send: jest.fn(command => {
        if (command instanceof GetCommand) return Promise.resolve({ Item: { id: '1', email: 'a@example.com' } });
        if (command instanceof QueryCommand) return Promise.resolve({ Items: [{ id: '2' }] });
        if (command instanceof ScanCommand && command.input.Select === 'COUNT') return Promise.resolve({ Count: 4 });
        if (command instanceof ScanCommand) return Promise.resolve({ Items: [{ id: '3' }] });
        return Promise.resolve({});
      })
    };
    DynamoDBClient.mockImplementation(() => dynamodb);
    DynamoDBDocumentClient.from.mockReturnValue(documentClient);

    const adapter = new DynamoDBAdapter();
    await adapter.connect({
      region: 'us-west-2',
      endpoint: 'http://localhost:8000',
      accessKeyId: 'key',
      secretAccessKey: 'secret'
    }, [model, 'orders']);

    expect(DynamoDBClient).toHaveBeenCalledWith({
      region: 'us-west-2',
      endpoint: 'http://localhost:8000',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' }
    });
    expect(dynamodb.send.mock.calls[0][0]).toBeInstanceOf(CreateTableCommand);
    expect(waitUntilTableExists).toHaveBeenCalledWith(
      { client: dynamodb, maxWaitTime: 30 },
      { TableName: 'users' }
    );
    expect(await adapter.query('users', 'findOne', { id: '1' })).toEqual({ id: '1', email: 'a@example.com' });
    expect(await adapter.query('users', 'findOne', { email: 'a@example.com' })).toEqual({ id: '2' });
    expect(await adapter.query('users', 'findOne', {})).toBeNull();
    expect(await adapter.query('users', 'findMany', { active: true }, { limit: 2 })).toEqual([{ id: '3' }]);
    expect(await adapter.query('users', 'create', { id: '4', email: 'new@example.com' })).toEqual(expect.objectContaining({ id: '4', email: 'new@example.com' }));
    expect(documentClient.send.mock.calls.at(-1)[0]).toBeInstanceOf(PutCommand);
    expect(await adapter.query('users', 'update', { id: '4', email: 'changed@example.com' })).toEqual(expect.objectContaining({ id: '4', email: 'changed@example.com' }));
    expect(documentClient.send.mock.calls.at(-1)[0]).toBeInstanceOf(UpdateCommand);
    await expect(adapter.query('users', 'update', { email: 'missing@example.com' })).rejects.toThrow('requires an id');
    expect(await adapter.query('users', 'delete', { id: '1' })).toEqual({ deleted: 1 });
    expect(documentClient.send.mock.calls.at(-1)[0]).toBeInstanceOf(DeleteCommand);
    expect(await adapter.query('users', 'delete', {})).toEqual({ deleted: 0 });
    expect(await adapter.query('users', 'count', { active: true })).toBe(4);
    await expect(adapter.query('users', 'missing')).rejects.toThrow('Unknown operation');
    await expect(new DynamoDBAdapter().query('users', 'count')).rejects.toThrow('DynamoDB not connected');
    expect(await adapter.healthCheck()).toEqual({ status: 'connected' });
    expect(await new DynamoDBAdapter().healthCheck()).toEqual({ status: 'disconnected' });
    await adapter.close();
    expect(dynamodb.destroy).toHaveBeenCalled();
  });

  it('covers adapter edge branches for defaults, empty results, generated ids, and SDK failures', async () => {
    Pool.mockImplementationOnce(() => ({
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('pg connect failed')),
      end: jest.fn()
    }));
    await expect(new PostgreSQLAdapter().connect({ host: 'localhost' }, [model])).rejects.toThrow('pg connect failed');

    const pgPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'generated' }] }),
      end: jest.fn()
    };
    const pg = new PostgreSQLAdapter();
    pg.pool = pgPool;
    pg.connected = true;
    expect(pg.buildWhere({})).toEqual({ sql: '', params: [] });
    await expect(pg.findOne('users', {})).resolves.toBeNull();
    await expect(pg.update('users', { id: '1' })).resolves.toEqual({ id: '1' });
    await expect(pg.create('users', {})).resolves.toEqual({ id: 'generated' });
    await new PostgreSQLAdapter().close();

    mysql.createPool
      .mockRejectedValueOnce(new Error('mysql unavailable'))
      .mockResolvedValueOnce({
        query: jest.fn().mockResolvedValue([[]]),
        execute: jest.fn()
          .mockResolvedValueOnce([{}])
          .mockResolvedValueOnce([[]])
          .mockResolvedValueOnce([[{}]]),
        end: jest.fn()
      });
    await expect(new MySQLAdapter().connect({ host: 'db' }, [])).rejects.toThrow('MySQL connection failed');
    const mysqlAdapter = new MySQLAdapter();
    await mysqlAdapter.connect('mysql://root@localhost/app?ssl=false', [model]);
    expect(mysql.createPool).toHaveBeenLastCalledWith(expect.objectContaining({ ssl: undefined }));
    await expect(mysqlAdapter.findOne('users', {})).resolves.toBeNull();
    await expect(mysqlAdapter.update('users', { id: '1' })).resolves.toEqual({ id: '1' });
    await expect(mysqlAdapter.count('users', {})).resolves.toBe(0);

    const mssqlAdapter = new MSSQLAdapter();
    expect(mssqlAdapter.mapType('number')).toBe('INT');
    expect(mssqlAdapter.mapType('json')).toBe('NVARCHAR(MAX)');
    expect(mssqlAdapter.mapType('date')).toBe('DATETIME2');
    expect(mssqlAdapter.mapType('string')).toBe('NVARCHAR(255)');
    await new MSSQLAdapter().close();

    const libClient = {
      execute: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
    };
    libsql.createClient.mockReturnValueOnce(libClient);
    const lib = new LibSQLAdapter();
    await lib.connect({ url: 'file:test.db' }, [model]);
    expect(libsql.createClient).toHaveBeenLastCalledWith({ url: 'file:test.db' });
    expect(lib.mapType('float')).toBe('REAL');
    await expect(lib.findOne('users', {})).resolves.toBeNull();
    await expect(lib.count('users', {})).resolves.toBe(0);
    await lib.close();

    const redisClient = {
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      sAdd: jest.fn(),
      sMembers: jest.fn().mockResolvedValue(['1']),
      del: jest.fn(),
      sRem: jest.fn(),
      sCard: jest.fn().mockResolvedValue(0),
      ping: jest.fn(),
      quit: jest.fn()
    };
    redis.createClient.mockReturnValueOnce(redisClient);
    const redisAdapter = new RedisAdapter();
    await redisAdapter.connect();
    expect(redis.createClient).toHaveBeenLastCalledWith({ url: 'redis://localhost:6379' });
    await expect(redisAdapter.findMany('users', { id: 'missing' })).resolves.toEqual([]);
    await expect(redisAdapter.update('users', { id: 'new', name: 'New' })).resolves.toEqual(expect.objectContaining({ id: 'new' }));

    const supabaseBuilders = [
      makeSupabaseBuilder({ data: null, error: new Error('not found') }),
      makeSupabaseBuilder({ data: null, error: new Error('select failed') }),
      makeSupabaseBuilder({ count: null })
    ];
    supabase.createClient.mockReturnValueOnce({ from: jest.fn(() => supabaseBuilders.shift()) });
    const supa = new SupabaseAdapter();
    await supa.connect({ url: 'url', key: 'key' }, []);
    await expect(supa.findOne('users', { id: 'missing' })).resolves.toBeNull();
    await expect(supa.findMany('users', {})).rejects.toThrow('select failed');
    await expect(supa.count('users', {})).resolves.toBeNull();

    const elastic = {
      ping: jest.fn(),
      indices: { create: jest.fn().mockRejectedValueOnce({ statusCode: 500 }) },
      search: jest.fn().mockResolvedValueOnce({ hits: { hits: [] } }),
      count: jest.fn().mockResolvedValueOnce({})
    };
    ElasticsearchClient.mockImplementationOnce(() => elastic);
    const es = new ElasticsearchAdapter();
    es.client = elastic;
    es.connected = true;
    await expect(es.createIndex('broken')).rejects.toEqual({ statusCode: 500 });
    await expect(es.findOne('users', { id: 'missing' })).resolves.toBeNull();
    await expect(es.count('users', {})).resolves.toBe(0);

    const neoSession = {
      run: jest.fn()
        .mockResolvedValueOnce({ records: [] })
        .mockResolvedValueOnce({ records: [] }),
      close: jest.fn()
    };
    const neoDriver = { session: jest.fn(() => neoSession), verifyConnectivity: jest.fn(), close: jest.fn() };
    neo4j.driver.mockReturnValueOnce(neoDriver);
    const neo = new Neo4jAdapter();
    await neo.connect({ uri: 'bolt://localhost', user: 'neo4j', password: '' }, []);
    expect(neo.where({})).toEqual({ clause: '', params: {} });
    await expect(neo.findOne('users', {})).resolves.toBeNull();
    await expect(neo.update('users', { id: 'missing' })).resolves.toBeNull();

    const cassClient = {
      connect: jest.fn(),
      execute: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ id: '1' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }),
      shutdown: jest.fn()
    };
    cassandra.Client.mockImplementationOnce(() => cassClient);
    const cass = new CassandraAdapter();
    await cass.connect({ keyspace: 'app' }, []);
    expect(cassandra.Client).toHaveBeenLastCalledWith(expect.objectContaining({
      contactPoints: ['127.0.0.1'],
      localDataCenter: 'datacenter1'
    }));
    await expect(cass.findMany('users', {}, {})).resolves.toEqual([{ id: '1' }]);
    await expect(cass.create('users', { id: 'known' })).resolves.toEqual({ id: 'known' });
    await expect(cass.count('users', {})).resolves.toBe(0);

    const dynamodb = { send: jest.fn().mockRejectedValueOnce({ name: 'OtherError' }), destroy: jest.fn() };
    DynamoDBClient.mockImplementationOnce(() => dynamodb);
    DynamoDBDocumentClient.from.mockReturnValueOnce({ send: jest.fn() });
    const dynamo = new DynamoDBAdapter();
    await dynamo.connect({}, []);
    expect(DynamoDBClient).toHaveBeenLastCalledWith({ region: 'us-east-1' });
    await expect(dynamo.createTable('users')).rejects.toEqual({ name: 'OtherError' });

    mongoose.connect.mockRejectedValueOnce(new Error('mongo down'));
    await expect(new MongoDBAdapter().connect('mongodb://bad', [])).rejects.toThrow('MongoDB connection failed');
  });

  it('covers SQL adapter no-filter/default-data branch combinations', async () => {
    const pgPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: '1' }] })
        .mockResolvedValueOnce({ rows: [{ count: undefined }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }),
      end: jest.fn()
    };
    const pg = new PostgreSQLAdapter();
    pg.pool = pgPool;
    pg.connected = true;
    await expect(pg.findMany('users')).resolves.toEqual([{ id: '1' }]);
    await expect(pg.count('users')).resolves.toBe(0);
    await expect(pg.delete('users')).resolves.toEqual({ deleted: 0, rows: [] });

    const mysqlPool = {
      execute: jest.fn()
        .mockResolvedValueOnce([[{ id: '1' }]])
        .mockResolvedValueOnce([[{}]])
        .mockResolvedValueOnce([{ affectedRows: undefined }])
        .mockResolvedValueOnce([{}]),
      query: jest.fn(),
      end: jest.fn()
    };
    const mysqlAdapter = new MySQLAdapter();
    mysqlAdapter.pool = mysqlPool;
    expect(mysqlAdapter.whereClause()).toEqual({ sql: '', values: [] });
    await expect(mysqlAdapter.findMany('users')).resolves.toEqual([{ id: '1' }]);
    await expect(mysqlAdapter.count('users')).resolves.toBe(0);
    await expect(mysqlAdapter.delete('users')).resolves.toEqual({ deleted: 0 });
    await expect(mysqlAdapter.create('users', {})).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }));

    const request = {
      input: jest.fn(function input() { return this; }),
      query: jest.fn()
        .mockResolvedValueOnce({ recordset: [{ id: '1' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rowsAffected: [] })
        .mockResolvedValueOnce({ recordset: [{}] })
    };
    const mssqlAdapter = new MSSQLAdapter();
    mssqlAdapter.pool = { request: jest.fn(() => request), close: jest.fn() };
    expect(mssqlAdapter.parseConnection('mssql://sa:secret@localhost/app')).toEqual(expect.objectContaining({
      options: { encrypt: true, trustServerCertificate: false }
    }));
    expect(mssqlAdapter.addWhere(request, {})).toBe('');
    await expect(mssqlAdapter.findMany('users')).resolves.toEqual([{ id: '1' }]);
    await expect(mssqlAdapter.create('users')).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }));
    await expect(mssqlAdapter.delete('users')).resolves.toEqual({ deleted: 0 });
    await expect(mssqlAdapter.count('users')).resolves.toBe(0);

    const libClient = {
      execute: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: '1' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ rows: [{}] })
    };
    const lib = new LibSQLAdapter();
    lib.client = libClient;
    expect(lib.whereClause()).toEqual({ sql: '', args: [] });
    await expect(lib.findMany('users')).resolves.toEqual([{ id: '1' }]);
    await expect(lib.create('users')).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }));
    await expect(lib.delete('users')).resolves.toEqual({ deleted: true });
    await expect(lib.count('users')).resolves.toBe(0);

    const neoSession = {
      run: jest.fn()
        .mockResolvedValueOnce({ records: [record({ id: 'generated' })] })
        .mockResolvedValueOnce({ summary: { counters: { updates: () => ({ nodesDeleted: 0 }) } } })
        .mockResolvedValueOnce({ records: [{ get: jest.fn(() => ({ toString: () => '0' })) }] }),
      close: jest.fn()
    };
    const neo = new Neo4jAdapter();
    neo.driver = { session: jest.fn(() => neoSession), close: jest.fn(), verifyConnectivity: jest.fn() };
    await expect(neo.create('users')).resolves.toEqual({ id: 'generated' });
    await expect(neo.delete('users')).resolves.toEqual({ deleted: 0 });
    await expect(neo.count('users')).resolves.toBe(0);
  });

  it('covers remaining NoSQL/search adapter default branch combinations', async () => {
    const documentClient = {
      send: jest.fn(command => {
        if (command instanceof ScanCommand && command.input.Select === 'COUNT') return Promise.resolve({});
        if (command instanceof ScanCommand) return Promise.resolve({});
        if (command instanceof QueryCommand) return Promise.resolve({ Items: [] });
        return Promise.resolve({});
      })
    };
    const dynamo = new DynamoDBAdapter();
    dynamo.documentClient = documentClient;
    dynamo.connected = true;
    await expect(dynamo.findOne('users', { email: 'none@example.com' })).resolves.toBeNull();
    await expect(dynamo.findMany('users')).resolves.toEqual([]);
    await expect(dynamo.create('users')).resolves.toEqual(expect.objectContaining({ id: expect.any(String) }));
    await expect(dynamo.count('users')).resolves.toBe(0);
    await expect(dynamo.healthCheck()).resolves.toEqual({ status: 'connected' });
    await new DynamoDBAdapter().close();

    const elastic = {
      ping: jest.fn(),
      indices: { create: jest.fn() },
      index: jest.fn().mockResolvedValue({ _id: 'created' }),
      update: jest.fn(),
      deleteByQuery: jest.fn().mockResolvedValue({}),
      search: jest.fn().mockResolvedValue({ hits: { hits: [] } }),
      count: jest.fn().mockResolvedValue({}),
      close: jest.fn()
    };
    const es = new ElasticsearchAdapter();
    es.client = elastic;
    es.connected = true;
    await expect(es.findMany('users', { email: 'a@example.com' })).resolves.toEqual([]);
    await expect(es.search('users', 'term')).resolves.toEqual([]);
    await expect(es.delete('users', { email: 'a@example.com' })).resolves.toEqual({ deleted: undefined });
    await expect(es.create('users', {})).resolves.toEqual({ id: 'created' });

    const redisAdapter = new RedisAdapter();
    redisAdapter.client = {
      sMembers: jest.fn().mockResolvedValue([]),
      sCard: jest.fn().mockResolvedValue(0),
      ping: jest.fn(),
      quit: jest.fn()
    };
    await expect(redisAdapter.findMany('users')).resolves.toEqual([]);
    await expect(redisAdapter.count('users')).resolves.toBe(0);
    await redisAdapter.close();
  });
});
