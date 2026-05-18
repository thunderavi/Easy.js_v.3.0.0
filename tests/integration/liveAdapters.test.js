const fs = require('fs');
const PostgreSQLAdapter = require('../../adapters/postgresql');
const RedisAdapter = require('../../adapters/redis');
const MongoDBAdapter = require('../../adapters/mongodb');
const SupabaseAdapter = require('../../adapters/supabase');
const FirebaseAdapter = require('../../adapters/firebase');
const DynamoDBAdapter = require('../../adapters/dynamodb');
const ElasticsearchAdapter = require('../../adapters/elasticsearch');
const CassandraAdapter = require('../../adapters/cassandra');
const Neo4jAdapter = require('../../adapters/neo4j');

const live = process.env.LIVE_ADAPTERS === 'true' ? describe : describe.skip;

const model = {
  name: 'live_users',
  fields: {
    email: 'string',
    name: 'string'
  },
  schema: {
    email: String,
    name: String
  }
};

function env(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function testIfConfigured(name, requiredEnv, fn) {
  const missing = requiredEnv.filter(key => !env(key));
  const runner = missing.length ? it.skip : it;
  runner(missing.length ? `${name} (missing ${missing.join(', ')})` : name, fn);
}

function testIf(name, configured, missingLabel, fn) {
  const runner = configured ? it : it.skip;
  runner(configured ? name : `${name} (missing ${missingLabel})`, fn);
}

function parseFirebaseCredentials() {
  if (env('FIREBASE_CREDENTIALS_JSON')) {
    const credentials = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    return credentials;
  }

  if (env('FIREBASE_CREDENTIALS_BASE64')) {
    const credentials = JSON.parse(Buffer.from(process.env.FIREBASE_CREDENTIALS_BASE64, 'base64').toString('utf8'));
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    return credentials;
  }

  return JSON.parse(fs.readFileSync(process.env.FIREBASE_CREDENTIALS_FILE, 'utf8'));
}

async function expectCrudContract(adapter, table, sample, options = {}) {
  const created = await adapter.query(table, 'create', sample);
  if (options.afterCreate) await options.afterCreate();

  const found = await adapter.query(table, 'findOne', { id: created.id || sample.id });
  const count = await adapter.query(table, 'count', { id: created.id || sample.id });

  expect(found).toEqual(expect.objectContaining({ email: sample.email }));
  expect(count).toBeGreaterThanOrEqual(1);
  await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
}

live('live database adapter contracts', () => {
  jest.setTimeout(90000);

  it('runs CRUD and health checks against PostgreSQL', async () => {
    const adapter = new PostgreSQLAdapter();
    await adapter.connect(process.env.POSTGRES_URL || 'postgres://easyjs:easyjs@localhost:5432/easyjs_test', [model]);

    try {
      await adapter.delete(model.name, { id: 'live-postgres-user' }).catch(() => {});
      await expectCrudContract(adapter, model.name, {
        id: 'live-postgres-user',
        email: 'postgres@example.com',
        name: 'Postgres User'
      });
    } finally {
      await adapter.delete(model.name, { id: 'live-postgres-user' }).catch(() => {});
      await adapter.close();
    }
  });

  it('runs CRUD and health checks against Redis', async () => {
    const adapter = new RedisAdapter();
    await adapter.connect(process.env.REDIS_URL || 'redis://localhost:6379');

    try {
      await adapter.delete(model.name, { id: 'live-redis-user' }).catch(() => {});
      await expectCrudContract(adapter, model.name, {
        id: 'live-redis-user',
        email: 'redis@example.com',
        name: 'Redis User'
      });
    } finally {
      await adapter.delete(model.name, { id: 'live-redis-user' }).catch(() => {});
      await adapter.close();
    }
  });

  it('runs CRUD and health checks against MongoDB', async () => {
    const adapter = new MongoDBAdapter();
    await adapter.connect({
      uri: process.env.MONGODB_URL || 'mongodb://localhost:27017/easyjs_test',
      timeoutMs: 5000
    }, [model]);

    try {
      await adapter.query(model.name, 'delete', { email: 'mongo@example.com' }).catch(() => {});
      const created = await adapter.query(model.name, 'create', {
        email: 'mongo@example.com',
        name: 'Mongo User'
      });
      const found = await adapter.query(model.name, 'findOne', { id: created.id });

      expect(found).toBeTruthy();
      await expect(adapter.healthCheck()).resolves.toEqual({ status: 'connected' });
    } finally {
      await adapter.query(model.name, 'delete', { email: 'mongo@example.com' }).catch(() => {});
      await adapter.close();
    }
  });

  testIfConfigured('runs CRUD and health checks against Supabase', ['SUPABASE_URL', 'SUPABASE_KEY'], async () => {
    const adapter = new SupabaseAdapter();
    const table = env('SUPABASE_TABLE') || model.name;
    await adapter.connect({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY }, [{ ...model, name: table }]);

    try {
      await adapter.query(table, 'delete', { id: 'live-supabase-user' }).catch(() => {});
      await expectCrudContract(adapter, table, {
        id: 'live-supabase-user',
        email: 'supabase@example.com',
        name: 'Supabase User'
      });
    } finally {
      await adapter.query(table, 'delete', { id: 'live-supabase-user' }).catch(() => {});
      await adapter.close();
    }
  });

  testIf(
    'runs CRUD and health checks against Firebase/Firestore',
    Boolean(env('FIREBASE_PROJECT_ID') && (env('FIREBASE_CREDENTIALS_JSON') || env('FIREBASE_CREDENTIALS_BASE64') || env('FIREBASE_CREDENTIALS_FILE'))),
    'FIREBASE_PROJECT_ID and one Firebase credentials source',
    async () => {
    const adapter = new FirebaseAdapter();

    await adapter.connect({
      credentials: parseFirebaseCredentials(),
      databaseURL: env('FIREBASE_DATABASE_URL') || `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
    }, [model]);

    try {
      await adapter.query(model.name, 'delete', { id: 'live-firebase-user' }).catch(() => {});
      await expectCrudContract(adapter, model.name, {
        id: 'live-firebase-user',
        email: 'firebase@example.com',
        name: 'Firebase User'
      });
    } finally {
      await adapter.query(model.name, 'delete', { id: 'live-firebase-user' }).catch(() => {});
      await adapter.close();
    }
  });

  testIf(
    'runs CRUD and health checks against DynamoDB',
    Boolean(env('AWS_REGION') && (env('DYNAMODB_ENDPOINT') || env('AWS_PROFILE') || (env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY')))),
    'AWS_REGION plus DYNAMODB_ENDPOINT, AWS_PROFILE, or AWS access keys',
    async () => {
    const adapter = new DynamoDBAdapter();
    const table = env('DYNAMODB_TABLE') || model.name;
    await adapter.connect({
      region: process.env.AWS_REGION,
      endpoint: env('DYNAMODB_ENDPOINT'),
      accessKeyId: env('AWS_ACCESS_KEY_ID'),
      secretAccessKey: env('AWS_SECRET_ACCESS_KEY')
    }, [{ ...model, name: table }]);

    try {
      await adapter.query(table, 'delete', { id: 'live-dynamodb-user' }).catch(() => {});
      await expectCrudContract(adapter, table, {
        id: 'live-dynamodb-user',
        email: 'dynamodb@example.com',
        name: 'DynamoDB User'
      });
    } finally {
      await adapter.query(table, 'delete', { id: 'live-dynamodb-user' }).catch(() => {});
      await adapter.close();
    }
  });

  testIfConfigured('runs CRUD and health checks against Elasticsearch/OpenSearch', ['ELASTICSEARCH_URL'], async () => {
    const adapter = new ElasticsearchAdapter();
    const index = env('ELASTICSEARCH_INDEX') || model.name;
    const auth = env('ELASTICSEARCH_API_KEY')
      ? { apiKey: process.env.ELASTICSEARCH_API_KEY }
      : env('ELASTICSEARCH_USERNAME') && env('ELASTICSEARCH_PASSWORD')
        ? { username: process.env.ELASTICSEARCH_USERNAME, password: process.env.ELASTICSEARCH_PASSWORD }
        : undefined;

    await adapter.connect({ node: process.env.ELASTICSEARCH_URL, auth }, [{ ...model, name: index }]);

    try {
      await adapter.query(index, 'delete', { id: 'live-elasticsearch-user' }).catch(() => {});
      await expectCrudContract(adapter, index, {
        id: 'live-elasticsearch-user',
        email: 'elasticsearch@example.com',
        name: 'Elasticsearch User'
      }, {
        afterCreate: () => adapter.client.indices.refresh({ index })
      });
    } finally {
      await adapter.query(index, 'delete', { id: 'live-elasticsearch-user' }).catch(() => {});
      await adapter.close();
    }
  });

  testIfConfigured('runs CRUD and health checks against Cassandra', ['CASSANDRA_CONTACT_POINTS', 'CASSANDRA_KEYSPACE'], async () => {
    const adapter = new CassandraAdapter();
    await adapter.connect({
      contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(',').map(point => point.trim()).filter(Boolean),
      localDataCenter: env('CASSANDRA_LOCAL_DATACENTER') || 'datacenter1',
      keyspace: process.env.CASSANDRA_KEYSPACE,
      username: env('CASSANDRA_USERNAME'),
      password: env('CASSANDRA_PASSWORD'),
      ssl: env('CASSANDRA_SSL') === 'true',
      secureConnectBundle: env('CASSANDRA_SECURE_CONNECT_BUNDLE')
    }, [model]);

    const id = '550e8400-e29b-41d4-a716-446655440000';
    try {
      await adapter.query(model.name, 'delete', { id }).catch(() => {});
      await expectCrudContract(adapter, model.name, {
        id,
        email: 'cassandra@example.com',
        name: 'Cassandra User'
      });
    } finally {
      await adapter.query(model.name, 'delete', { id }).catch(() => {});
      await adapter.close();
    }
  });

  testIfConfigured('runs CRUD and health checks against Neo4j', ['NEO4J_URL'], async () => {
    const adapter = new Neo4jAdapter();
    await adapter.connect(process.env.NEO4J_URL, [model]);

    try {
      await adapter.query(model.name, 'delete', { id: 'live-neo4j-user' }).catch(() => {});
      await expectCrudContract(adapter, model.name, {
        id: 'live-neo4j-user',
        email: 'neo4j@example.com',
        name: 'Neo4j User'
      });
    } finally {
      await adapter.query(model.name, 'delete', { id: 'live-neo4j-user' }).catch(() => {});
      await adapter.close();
    }
  });
});
