import {Injectable, Logger} from '@nestjs/common';

/** Default cache TTL in milliseconds. Configurable via CACHE_TTL_MS env var (default 300000 = 5 min). */
const DEFAULT_TTL_MS = parseInt(process.env.CACHE_TTL_MS || '300000', 10);

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple in-memory TTL cache for conformance resources, CapabilityStatement and terminology operations.
 * Supports namespace-based invalidation for targeted cache clearing on resource mutations.
 */
@Injectable()
export class CacheService {

  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, CacheEntry<any>>();
  private readonly defaultTtl = DEFAULT_TTL_MS;

  /** Gets a cached value, or returns undefined if expired or missing. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
return undefined;
}

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);

      return undefined;
    }

    return entry.value as T;
  }

  /** Sets a value in the cache with an optional TTL in milliseconds (defaults to CACHE_TTL_MS). */
  set<T>(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {value, expiresAt: Date.now() + (ttlMs ?? this.defaultTtl)});
  }

  /** Gets a cached value or computes it using the factory function, caching the result. */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get<T>(key);

    if (cached !== undefined) {
return cached;
}

    const value = await factory();
    this.set(key, value, ttlMs);

    return value;
  }

  /** Deletes a specific cache key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Invalidates all cache entries whose key starts with the given prefix. */
  invalidateByPrefix(prefix: string): number {
    let count = 0;

    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }

    if (count > 0) {
this.logger.debug(`Invalidated ${count} cache entries with prefix '${prefix}'`);
}

    return count;
  }

  /** Clears the entire cache. */
  clear(): void {
    const size = this.store.size;
    this.store.clear();

    if (size > 0) {
this.logger.debug(`Cleared ${size} cache entries`);
}
  }

  /** Returns the number of entries currently in the cache (including possibly expired). */
  get size(): number {
    return this.store.size;
  }
}
