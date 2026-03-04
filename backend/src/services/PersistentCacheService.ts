/**
 * PersistentCacheService - File-based persistent caching
 *
 * Stores cache data to disk so it persists across server restarts.
 * Cache data is only cleared when a new scan/audit runs.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface CacheMetadata {
  lastScan: string;
  profile: string;
  region?: string;
}

export class PersistentCacheService {
  private cacheDir: string;
  private memoryCache: Map<string, any> = new Map();

  constructor(basePath?: string) {
    this.cacheDir = basePath || join(homedir(), '.aws-dashboard', 'cache');
    console.log(`[PersistentCache] Cache directory: ${this.cacheDir}`);
  }

  /**
   * Initialize cache service - load all persisted data into memory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      console.log('[PersistentCache] Initialized cache directory');

      // Load all cached data from disk into memory
      await this.loadAllCaches();
    } catch (error) {
      console.error('[PersistentCache] Failed to initialize:', error);
    }
  }

  /**
   * Load all cached data from disk into memory
   */
  private async loadAllCaches(): Promise<void> {
    try {
      const profiles = await this.getProfileDirectories();

      for (const profile of profiles) {
        const profileDir = join(this.cacheDir, profile);
        const files = await fs.readdir(profileDir);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          try {
            const filePath = join(profileDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Determine cache key from filename
            let cacheKey: string;
            if (file.startsWith('resources-')) {
              const region = file.replace('resources-', '').replace('.json', '');
              cacheKey = `resources:${profile}:${region}`;
            } else if (file.startsWith('security-')) {
              const region = file.replace('security-', '').replace('.json', '');
              cacheKey = `security:${profile}:${region}`;
            } else if (file === 'costs.json') {
              cacheKey = `costs:${profile}`;
            } else if (file === 'last-scan.json') {
              cacheKey = `last-scan:${profile}`;
            } else if (file === 'alerts.json') {
              cacheKey = `alerts:${profile}`;
            } else if (file === 'audit-latest.json') {
              cacheKey = `audit-latest:${profile}`;
            } else if (file.startsWith('audit-')) {
              // Load individual audit job files: audit-{jobId}.json
              const jobId = file.replace('audit-', '').replace('.json', '');
              cacheKey = `audit-job:${profile}:${jobId}`;
            } else {
              continue;
            }

            this.memoryCache.set(cacheKey, data);
            console.log(`[PersistentCache] Loaded ${cacheKey} from disk`);
          } catch (error) {
            console.error(`[PersistentCache] Failed to load ${file}:`, error);
          }
        }
      }

      console.log(`[PersistentCache] Loaded ${this.memoryCache.size} cache entries from disk`);
    } catch (error) {
      console.error('[PersistentCache] Failed to load caches:', error);
    }
  }

  /**
   * Get list of profile directories
   */
  private async getProfileDirectories(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.cacheDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | undefined {
    return this.memoryCache.get(key) as T | undefined;
  }

  /**
   * Set value in cache and persist to disk
   */
  async set<T>(key: string, value: T): Promise<void> {
    // Store in memory
    this.memoryCache.set(key, value);

    // Persist to disk
    await this.persistToDisk(key, value);
  }

  /**
   * Check if key exists in cache
   */
  has(key: string): boolean {
    return this.memoryCache.has(key);
  }

  /**
   * Delete specific key from cache and disk
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);

    // Delete from disk
    const filePath = this.getFilePath(key);
    if (filePath) {
      try {
        await fs.unlink(filePath);
        console.log(`[PersistentCache] Deleted ${key} from disk`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.error(`[PersistentCache] Failed to delete ${key}:`, error);
        }
      }
    }
  }

  /**
   * Clear all cache entries for a profile
   */
  async clearProfile(profile: string): Promise<void> {
    // Clear from memory
    const keysToDelete: string[] = [];
    for (const key of this.memoryCache.keys()) {
      if (key.includes(`:${profile}:`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.memoryCache.delete(key);
    }

    // Clear from disk
    const profileDir = join(this.cacheDir, profile);
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
      console.log(`[PersistentCache] Cleared all caches for profile ${profile}`);
    } catch (error) {
      console.error(`[PersistentCache] Failed to clear profile ${profile}:`, error);
    }
  }

  /**
   * Get all cache keys
   */
  getKeys(): string[] {
    return Array.from(this.memoryCache.keys());
  }

  /**
   * Get last scan timestamp for a profile
   */
  getLastScanTime(profile: string): string | undefined {
    const metadata = this.get<CacheMetadata>(`last-scan:${profile}`);
    return metadata?.lastScan;
  }

  /**
   * Set last scan timestamp for a profile
   */
  async setLastScanTime(profile: string): Promise<void> {
    const metadata: CacheMetadata = {
      lastScan: new Date().toISOString(),
      profile,
    };
    await this.set(`last-scan:${profile}`, metadata);
  }

  /**
   * Persist cache entry to disk
   */
  private async persistToDisk(key: string, value: any): Promise<void> {
    const filePath = this.getFilePath(key);
    if (!filePath) {
      console.warn(`[PersistentCache] Cannot determine file path for key: ${key}`);
      return;
    }

    try {
      // Ensure directory exists
      const dir = join(filePath, '..');
      await fs.mkdir(dir, { recursive: true });

      // Write to disk
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
      console.log(`[PersistentCache] Persisted ${key} to disk`);
    } catch (error) {
      console.error(`[PersistentCache] Failed to persist ${key}:`, error);
    }
  }

  /**
   * Get file path for cache key
   */
  private getFilePath(key: string): string | null {
    const parts = key.split(':');

    if (parts[0] === 'resources' && parts.length >= 3) {
      const [_, profile, region] = parts;
      return join(this.cacheDir, profile, `resources-${region}.json`);
    } else if (parts[0] === 'security' && parts.length >= 3) {
      const [_, profile, region] = parts;
      return join(this.cacheDir, profile, `security-${region}.json`);
    } else if (parts[0] === 'costs' && parts.length >= 2) {
      const [_, profile] = parts;
      return join(this.cacheDir, profile, 'costs.json');
    } else if (parts[0] === 'last-scan' && parts.length >= 2) {
      const [_, profile] = parts;
      return join(this.cacheDir, profile, 'last-scan.json');
    } else if (parts[0] === 'alerts' && parts.length >= 2) {
      const [_, profile] = parts;
      return join(this.cacheDir, profile, 'alerts.json');
    } else if (parts[0] === 'audit-latest' && parts.length >= 2) {
      const [_, profile] = parts;
      return join(this.cacheDir, profile, 'audit-latest.json');
    } else if (parts[0] === 'audit-job' && parts.length >= 3) {
      const [_, profile, jobId] = parts;
      return join(this.cacheDir, profile, `audit-${jobId}.json`);
    }

    return null;
  }

  /**
   * Build cache key for resources
   */
  static resourceKey(profile: string, region: string): string {
    return `resources:${profile}:${region}`;
  }

  /**
   * Build cache key for security findings
   */
  static securityKey(profile: string, region: string): string {
    return `security:${profile}:${region}`;
  }

  /**
   * Build cache key for costs
   */
  static costKey(profile: string): string {
    return `costs:${profile}`;
  }

  /**
   * Build cache key for alerts
   */
  static alertsKey(profile: string): string {
    return `alerts:${profile}`;
  }

  /**
   * Build cache key for latest audit job
   */
  static auditLatestKey(profile: string): string {
    return `audit-latest:${profile}`;
  }

  /**
   * Build cache key for specific audit job
   */
  static auditJobKey(profile: string, jobId: string): string {
    return `audit-job:${profile}:${jobId}`;
  }
}

// Export singleton instance
export const persistentCache = new PersistentCacheService();
