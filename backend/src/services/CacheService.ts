/**
 * CacheService - In-memory caching with TTL support
 *
 * Provides simple key-value caching with automatic expiration.
 * Used to cache AWS resources, costs, alerts, etc. to reduce API calls.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export class CacheService {
  private cache: Map<string, CacheEntry<any>>;
  private hits: number;
  private misses: number;

  // Default TTLs in seconds
  static readonly TTL = {
    RESOURCES: 3600,        // 1 hour
    COSTS: 86400,           // 24 hours
    SECURITY_ALERTS: 3600,  // 1 hour
    IAM_ANALYSIS: 7200,     // 2 hours
    VPC_TOPOLOGY: 3600,     // 1 hour
    SCAN_RESULTS: 3600,     // 1 hour
    SESSION_STATUS: 60,     // 1 minute
  };

  constructor() {
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Get value from cache
   * Returns undefined if not found or expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value as T;
  }

  /**
   * Set value in cache with TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlSeconds TTL in seconds (default: 5 minutes)
   */
  set<T>(key: string, value: T, ttlSeconds: number = CacheService.TTL.RESOURCES): void {
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete specific key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Clear cache entries matching a pattern
   * @param pattern Regex pattern or string prefix
   */
  clearPattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(`^${pattern}`) : pattern;
    let cleared = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  /**
   * Get all cache keys
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
    };
  }

  /**
   * Get remaining TTL for a key in seconds
   * Returns -1 if key doesn't exist or is expired
   */
  getRemainingTTL(key: string): number {
    const entry = this.cache.get(key);
    if (!entry) {
      return -1;
    }

    const remaining = Math.max(0, entry.expiresAt - Date.now());
    if (remaining === 0) {
      this.cache.delete(key);
      return -1;
    }

    return Math.floor(remaining / 1000);
  }

  /**
   * Cleanup expired entries
   * Called automatically every minute
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }

  /**
   * Build cache key for resources
   */
  static resourceKey(profile: string, region: string, resourceType?: string): string {
    return resourceType
      ? `resources:${profile}:${region}:${resourceType}`
      : `resources:${profile}:${region}`;
  }

  /**
   * Build cache key for scan job
   */
  static scanKey(jobId: string): string {
    return `scan:${jobId}`;
  }

  /**
   * Build cache key for costs
   */
  static costKey(profile: string): string {
    return `costs:${profile}`;
  }

  /**
   * Build cache key for security alerts
   */
  static alertKey(profile: string, region: string): string {
    return `alerts:${profile}:${region}`;
  }
}

// Export singleton instance
export const cacheService = new CacheService();
