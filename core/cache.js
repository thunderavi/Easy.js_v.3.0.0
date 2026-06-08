/**
 * Advanced Caching Engine
 * Multi-layer caching with Redis, in-memory, and query result caching
 * Supports cache invalidation, TTL, and cache warming
 */

const crypto = require('crypto');
const optionalRequire = require('./optionalRequire');

class CacheEngine {
  constructor(config = {}) {
    this.config = {
      redisUrl: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379',
      ttl: config.ttl || 3600, // 1 hour default
      maxMemoryCache: config.maxMemoryCache || 100, // MB
      enableCompression: config.enableCompression !== false,
      enableMetrics: config.enableMetrics !== false,
      ...config
    };

    this.memoryCache = new Map();
    this.memoryCacheSize = 0;
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      compressionRatio: 0
    };

    this.initialized = false;
    this.client = null;
    this.redisAvailable = false;
    this.fallbackLogged = false;
    this.queryCache = new Map();
    this.keyMetadata = new Map();
  }

  async init() {
    try {
      const redis = optionalRequire('redis', 'Redis cache');
      this.client = redis.createClient({
        url: this.config.redisUrl,
        socket: {
          reconnectStrategy: false,
          keepAlive: 30000
        }
      });

      this.client.on('error', (err) => {
        this.fallbackToMemory(err);
      });

      await this.client.connect();
      this.initialized = true;
      this.redisAvailable = true;
      console.log('[CacheEngine] Connected to Redis');
    } catch (error) {
      this.fallbackToMemory(error);
      this.initialized = true;
    }
  }

  fallbackToMemory(error = null) {
    const currentClient = this.client;
    this.client = null;
    this.redisAvailable = false;

    if (currentClient && typeof currentClient.disconnect === 'function') {
      currentClient.disconnect().catch(() => {});
    }

    if (!this.fallbackLogged) {
      const reason = error?.message ? `: ${error.message}` : '';
      console.warn(`[CacheEngine] Redis unavailable${reason}. Using in-memory caching.`);
      this.fallbackLogged = true;
    }
  }

  /**
   * Generate cache key with hash for consistency
   */
  generateKey(namespace, identifier) {
    const combined = `${namespace}:${JSON.stringify(identifier)}`;
    return crypto.createHash('md5').update(combined).digest('hex');
  }

  /**
   * Compress data for storage efficiency
   */
  compress(data) {
    if (!this.config.enableCompression) return JSON.stringify(data);
    const zlib = require('zlib');
    return zlib.brotliCompressSync(JSON.stringify(data));
  }

  /**
   * Decompress cached data
   */
  decompress(data) {
    if (!this.config.enableCompression) {
      return typeof data === 'string' ? JSON.parse(data) : data;
    }
    const zlib = require('zlib');
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
    return JSON.parse(zlib.brotliDecompressSync(buffer).toString());
  }

  /**
   * Get from cache with fallback chain
   */
  async get(namespace, identifier, options = {}) {
    const key = this.generateKey(namespace, identifier);

    // Try Redis first
    if (this.client) {
      try {
        const redisData = await this.client.get(key);
        if (redisData) {
          this.updateMetrics('hits');
          return this.decompress(redisData);
        }
      } catch (error) {
        console.error('[CacheEngine] Redis get error:', error.message);
      }
    }

    // Try memory cache
    if (this.memoryCache.has(key)) {
      const metadata = this.keyMetadata.get(key);

      if (this.isExpired(metadata)) {
        this.deleteMemoryEntry(key);
        this.updateMetrics('misses');
        return null;
      }

      this.updateMetrics('hits');
      return this.memoryCache.get(key);
    }

    this.updateMetrics('misses');
    return null;
  }

  /**
   * Set cache with multi-layer storage
   */
  async set(namespace, identifier, data, ttl = null) {
    const key = this.generateKey(namespace, identifier);
    const cacheTime = ttl || this.config.ttl;

    // Store in memory
    this.trackMemoryEntry(key, namespace, data, cacheTime);
    this.memoryCache.set(key, data);
    this.evictIfNeeded();

    // Store in Redis
    if (this.client) {
      try {
        const compressed = this.compress(data);
        await this.client.setEx(
          key,
          cacheTime,
          Buffer.isBuffer(compressed) ? compressed.toString('base64') : compressed
        );
      } catch (error) {
        console.error('[CacheEngine] Redis set error:', error.message);
      }
    }

    this.updateMetrics('sets');
  }

  /**
   * Cache query results for optimized database access
   */
  async cacheQuery(query, result, ttl = 1800) {
    const key = crypto.createHash('md5').update(JSON.stringify(query)).digest('hex');
    await this.set('query', key, result, ttl);
    this.queryCache.set(key, {
      query,
      cacheKey: this.generateKey('query', key),
      timestamp: Date.now()
    });
  }

  /**
   * Invalidate queries matching pattern
   */
  invalidateQueries(pattern) {
    let invalidated = 0;
    for (const [key, value] of this.queryCache.entries()) {
      if (JSON.stringify(value.query).includes(pattern)) {
        this.deleteMemoryEntry(value.cacheKey);
        if (this.client) {
          this.client.del(value.cacheKey).catch(err => console.error('[CacheEngine] Delete error:', err));
        }
        this.queryCache.delete(key);
        invalidated++;
      }
    }
    return invalidated;
  }

  /**
   * Clear specific cache namespace
   */
  async clear(namespace = null) {
    if (namespace) {
      const keys = Array.from(this.keyMetadata.entries())
        .filter(([, metadata]) => metadata.namespace === namespace)
        .map(([key]) => key);

      for (const key of keys) {
        this.deleteMemoryEntry(key);
      }
      if (this.client) {
        if (keys.length > 0) {
          await this.client.del(keys);
        }
      }
    } else {
      this.memoryCache.clear();
      this.keyMetadata.clear();
      this.memoryCacheSize = 0;
      if (this.client) {
        await this.client.flushDb();
      }
    }
    this.updateMetrics('deletes');
  }

  /**
   * Warm cache with frequent queries
   */
  async warmCache(queries) {
    for (const { query, result, ttl } of queries) {
      await this.cacheQuery(query, result, ttl);
    }
  }

  /**
   * Update memory usage tracking
   */
  trackMemoryEntry(key, namespace, data, ttl) {
    const oldMetadata = this.keyMetadata.get(key);
    if (oldMetadata) {
      this.memoryCacheSize -= oldMetadata.sizeMb;
    }

    const size = Buffer.byteLength(JSON.stringify(data), 'utf8') / (1024 * 1024); // MB

    const expiresAt = ttl
      ? Date.now() + ttl * 1000
      : null;

    this.keyMetadata.set(key, { namespace, sizeMb: size, expiresAt });
    this.memoryCacheSize += size;

    if (this.memoryCache.size > 1000) {
      // Evict oldest if too many entries
      const firstKey = this.memoryCache.keys().next().value;
      this.deleteMemoryEntry(firstKey);
    }
  }

  isExpired(metadata) {
    return metadata?.expiresAt && Date.now() > metadata.expiresAt;
  }

  deleteMemoryEntry(key) {
    const metadata = this.keyMetadata.get(key);
    if (metadata) {
      this.memoryCacheSize = Math.max(0, this.memoryCacheSize - metadata.sizeMb);
      this.keyMetadata.delete(key);
    }
    return this.memoryCache.delete(key);
  }

  /**
   * Evict cache if memory limit exceeded
   */
  evictIfNeeded() {
    if (this.memoryCacheSize > this.config.maxMemoryCache) {
      const entriesToRemove = Math.ceil(this.memoryCache.size * 0.2);
      let removed = 0;

      for (const [key] of this.memoryCache.entries()) {
        if (removed >= entriesToRemove) break;
        this.deleteMemoryEntry(key);
        removed++;
      }
    }
  }

  /**
   * Update metrics
   */
  updateMetrics(type) {
    if (this.config.enableMetrics) {
      this.metrics[type]++;
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.metrics.hits / (this.metrics.hits + this.metrics.misses || 1);
    return {
      ...this.metrics,
      hitRate: (hitRate * 100).toFixed(2) + '%',
      memoryEntries: this.memoryCache.size,
      memorySizeBytes: this.memoryCacheSize * 1024 * 1024
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      compressionRatio: 0
    };
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.initialized = false;
      this.redisAvailable = false;
      console.log('[CacheEngine] Redis connection closed');
    }
  }
}

module.exports = CacheEngine;
