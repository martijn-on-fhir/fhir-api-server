import {Injectable, Logger, OnModuleDestroy, OnModuleInit} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/naming-convention
import Redis from 'ioredis';
import {config} from '../config/app-config';

/** Default cache TTL in milliseconds. Configured via centralized config (default 300000 = 5 min). */
const DEFAULT_TTL_MS = config.cache.ttlMs;

/** Whether to use Redis or fall back to in-memory store. */
const USE_REDIS = config.cache.store === 'redis';

/** In-memory cache entry with expiration timestamp. */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Dual-mode TTL cache for conformance resources, CapabilityStatement and terminology operations.
 * Uses Redis when configured (default), falls back to in-memory Map.
 * Supports namespace-based invalidation for targeted cache clearing on resource mutations.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {

  private readonly logger = new Logger(CacheService.name);
  private readonly memoryStore = new Map<string, CacheEntry<any>>();
  private readonly defaultTtl = DEFAULT_TTL_MS;
  private redis: Redis | null = null;

  /** Connects to Redis on startup if configured. Falls back to in-memory on connection failure. */
  async onModuleInit(): Promise<void> {
    if (!USE_REDIS) {
      this.logger.log('Cache store: in-memory');

      return;
    }

    try {
      this.redis = new Redis(config.redis.url, {
        keyPrefix: config.redis.keyPrefix,
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => (times > 1 ? null : 500),
      });

      await this.redis.connect();
      this.logger.log(`Cache store: Redis (${config.redis.url})`);
    } catch (err) {
      this.logger.warn(`Redis connection failed, falling back to in-memory cache: ${err.message}`);
      this.redis?.disconnect();
      this.redis = null;
    }
  }

  /** Disconnects from Redis on shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  /** Gets a cached value, or returns undefined if expired or missing. */
  async get<T>(key: string): Promise<T | undefined> {
    if (this.redis) {
      const raw = await this.redis.get(key);

      return raw ? JSON.parse(raw) : undefined;
    }

    const entry = this.memoryStore.get(key);

    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.memoryStore.delete(key);

      return undefined;
    }

    return entry.value as T;
  }

  /** Sets a value in the cache with an optional TTL in milliseconds (defaults to CACHE_TTL_MS). */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtl;

    if (this.redis) {
      await this.redis.set(key, JSON.stringify(value), 'PX', ttl);

      return;
    }

    this.memoryStore.set(key, {value, expiresAt: Date.now() + ttl});
  }

  /** Gets a cached value or computes it using the factory function, caching the result. */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = await this.get<T>(key);

    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlMs);

    return value;
  }

  /** Deletes a specific cache key. */
  async delete(key: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(key);

      return;
    }

    this.memoryStore.delete(key);
  }

  /** Invalidates all cache entries whose key starts with the given prefix. */
  async invalidateByPrefix(prefix: string): Promise<number> {
    if (this.redis) {
      const fullPrefix = `${config.redis.keyPrefix}${prefix}*`;
      const keys = await this.redis.keys(fullPrefix);

      if (keys.length === 0) {
        return 0;
      }

      // Strip the keyPrefix because ioredis auto-prefixes commands
      const stripped = keys.map((k) => k.slice(config.redis.keyPrefix.length));
      await this.redis.del(...stripped);
      this.logger.debug(`Invalidated ${keys.length} Redis cache entries with prefix '${prefix}'`);

      return keys.length;
    }

    let count = 0;

    for (const key of this.memoryStore.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryStore.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.logger.debug(`Invalidated ${count} cache entries with prefix '${prefix}'`);
    }

    return count;
  }

  /** Clears the entire cache. */
  async clear(): Promise<void> {
    if (this.redis) {
      const keys = await this.redis.keys(`${config.redis.keyPrefix}*`);

      if (keys.length > 0) {
        const stripped = keys.map((k) => k.slice(config.redis.keyPrefix.length));
        await this.redis.del(...stripped);
        this.logger.debug(`Cleared ${keys.length} Redis cache entries`);
      }

      return;
    }

    const size = this.memoryStore.size;
    this.memoryStore.clear();

    if (size > 0) {
      this.logger.debug(`Cleared ${size} cache entries`);
    }
  }

  /** Returns the Redis client for use by other modules (e.g. throttler storage). Null if in-memory mode. */
  getRedisClient(): Redis | null {
    return this.redis;
  }
}
