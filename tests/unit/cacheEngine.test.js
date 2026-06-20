jest.mock('redis', () => ({ createClient: jest.fn() }));

const redis = require('redis');
const CacheEngine = require('../../core/cache');

describe('CacheEngine hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tracks memory size and hit/miss metrics for in-memory cache operations', async () => {
    const cache = new CacheEngine({ enableCompression: false });

    await cache.set('users', { id: 1 }, { name: 'Ada' });

    await expect(cache.get('users', { id: 1 })).resolves.toEqual({ name: 'Ada' });
    await expect(cache.get('users', { id: 2 })).resolves.toBeNull();

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.sets).toBe(1);
    expect(stats.memoryEntries).toBe(1);
    expect(stats.memorySizeBytes).toBeGreaterThan(0);
  });

  it('expires memory cache entries based on TTL and cleans up metadata', async () => {
    const cache = new CacheEngine({ enableCompression: false });

    await cache.set('users', 'u1', { id: 'u1' }, 1);

    const key = cache.generateKey('users', 'u1');

    expect(await cache.get('users', 'u1')).toEqual({ id: 'u1' });
    expect(cache.memoryCache.has(key)).toBe(true);
    expect(cache.keyMetadata.has(key)).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 1100));

    await expect(cache.get('users', 'u1')).resolves.toBeNull();

    expect(cache.memoryCache.has(key)).toBe(false);
    expect(cache.keyMetadata.has(key)).toBe(false);
    expect(cache.memoryCacheSize).toBe(0);
  });

  it('returns memory cache entries before TTL expiry', async () => {
    const cache = new CacheEngine({ enableCompression: false });

    await cache.set('users', 'u1', { id: 'u1' }, 5);

    await expect(cache.get('users', 'u1')).resolves.toEqual({ id: 'u1' });
  });

  it('clears only entries in the requested namespace despite hashed cache keys', async () => {
    const cache = new CacheEngine({ enableCompression: false });

    await cache.set('users', 'u1', { id: 'u1' });
    await cache.set('posts', 'p1', { id: 'p1' });

    await cache.clear('users');

    await expect(cache.get('users', 'u1')).resolves.toBeNull();
    await expect(cache.get('posts', 'p1')).resolves.toEqual({ id: 'p1' });
    expect(cache.getStats().memoryEntries).toBe(1);
  });

  it('invalidates cached queries by matching the original query metadata', async () => {
    const cache = new CacheEngine({ enableCompression: false });
    const query = { table: 'users', where: { active: true } };

    await cache.cacheQuery(query, [{ id: 1 }]);

    const queryId = require('crypto').createHash('md5').update(JSON.stringify(query)).digest('hex');
    await expect(cache.get('query', queryId)).resolves.toEqual([{ id: 1 }]);

    expect(cache.invalidateQueries('users')).toBe(1);
    await expect(cache.get('query', queryId)).resolves.toBeNull();
  });

  it('stores compressed Redis values as base64 and decompresses them on read', async () => {
    const cache = new CacheEngine({ enableCompression: true });
    const payload = { nested: { ok: true } };
    const compressed = cache.compress(payload).toString('base64');

    cache.client = {
      get: jest.fn().mockResolvedValue(compressed),
      setEx: jest.fn()
    };

    await expect(cache.get('redis', 'key')).resolves.toEqual(payload);
    await cache.set('redis', 'key', payload, 12);

    expect(cache.client.setEx).toHaveBeenCalledWith(
      expect.any(String),
      12,
      expect.any(String)
    );
    expect(() => cache.decompress(cache.client.setEx.mock.calls[0][2])).not.toThrow();
  });

  it('evicts old memory entries when configured memory is exceeded', async () => {
    const cache = new CacheEngine({
      enableCompression: false,
      maxMemoryCache: 0.00001
    });

    await cache.set('tiny', 'a', { value: 'this is larger than the configured cache limit' });

    expect(cache.getStats().memoryEntries).toBe(0);
    expect(cache.getStats().memorySizeBytes).toBe(0);
  });

  it('initializes Redis, handles Redis failures, clears Redis, and closes cleanly', async () => {
    const client = {
      on: jest.fn(),
      connect: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      setEx: jest.fn().mockRejectedValue(new Error('set failed')),
      del: jest.fn().mockResolvedValue(1),
      flushDb: jest.fn(),
      quit: jest.fn()
    };
    redis.createClient.mockReturnValue(client);
    const cache = new CacheEngine({ redisUrl: 'redis://cache:6379', enableCompression: false });

    await cache.init();

    expect(redis.createClient).toHaveBeenCalledWith(expect.objectContaining({
      url: 'redis://cache:6379',
      socket: expect.objectContaining({ keepAlive: 30000 })
    }));
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(cache.initialized).toBe(true);

    client.on.mock.calls[0][1](new Error('redis broken'));
    expect(cache.client).toBeNull();

    cache.client = client;
    await cache.set('users', 'u1', { id: 'u1' });
    await expect(cache.get('users', 'missing')).resolves.toBeNull();
    await cache.clear('users');
    expect(client.del).toHaveBeenCalledWith(expect.any(Array));
    await cache.clear();
    expect(client.flushDb).toHaveBeenCalled();

    await cache.close();
    expect(client.quit).toHaveBeenCalled();
    expect(cache.initialized).toBe(false);
  });

  it('falls back to memory when Redis connect/get/delete fail and supports non-compressed data', async () => {
    const brokenClient = {
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error('connect failed'))
    };
    redis.createClient.mockReturnValue(brokenClient);
    const cache = new CacheEngine({ enableCompression: false, enableMetrics: false });

    await cache.init();
    expect(cache.client).toBeNull();
    expect(cache.compress({ ok: true })).toBe('{"ok":true}');
    expect(cache.decompress('{"ok":true}')).toEqual({ ok: true });
    expect(cache.decompress({ already: 'object' })).toEqual({ already: 'object' });

    cache.client = {
      get: jest.fn().mockRejectedValue(new Error('get failed')),
      del: jest.fn().mockRejectedValue(new Error('delete failed'))
    };
    await cache.set('query', 'one', { id: 1 });
    await cache.cacheQuery({ table: 'users' }, [{ id: 1 }]);
    expect(cache.invalidateQueries('users')).toBe(1);
    await expect(cache.get('missing', 'key')).resolves.toBeNull();

    const stats = cache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    cache.resetMetrics();
    expect(cache.metrics).toEqual({
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      compressionRatio: 0
    });
  });

  it('evicts oldest entries when the memory map grows beyond the hard count limit', () => {
    const cache = new CacheEngine({ enableCompression: false });
    for (let index = 0; index < 1001; index++) {
      const key = `key-${index}`;
      cache.memoryCache.set(key, { index });
      cache.trackMemoryEntry(key, 'bulk', { index });
    }

    expect(cache.memoryCache.has('key-0')).toBe(false);
    expect(cache.keyMetadata.has('key-0')).toBe(false);
    expect(cache.deleteMemoryEntry('missing')).toBe(false);
  });
});
