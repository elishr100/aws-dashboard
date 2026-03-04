import { Router } from 'express';
import { cacheService, CacheService } from '../services/CacheService.js';
import { persistentCache } from '../services/PersistentCacheService.js';
import type { ResourceInventory } from '../types/index.js';

const router = Router();

/**
 * Normalize resource type names to handle plural/singular and case variations
 * This provides backwards compatibility with cached data
 * All types are normalized to match the canonical forms used in ResourceDiscoveryAgent
 */
function normalizeResourceType(type: string): string {
  const normalized = type.toUpperCase();

  // Map all variations to canonical forms matching ResourceDiscoveryAgent types:
  // 'EC2' | 'VPC' | 'S3' | 'RDS' | 'Lambda' | 'ELB' | 'NAT' | 'SecurityGroup' | 'DynamoDB' | 'IAMRole'
  const typeMap: Record<string, string> = {
    // VPC variations
    'VPC': 'VPC',
    'VPCS': 'VPC',
    // EC2 variations
    'EC2': 'EC2',
    'EC2S': 'EC2',
    'EC2INSTANCE': 'EC2',
    'INSTANCE': 'EC2',
    'INSTANCES': 'EC2',
    // S3 variations
    'S3': 'S3',
    'S3S': 'S3',
    'S3BUCKET': 'S3',
    'BUCKET': 'S3',
    'BUCKETS': 'S3',
    // RDS variations
    'RDS': 'RDS',
    'RDSS': 'RDS',
    'RDSINSTANCE': 'RDS',
    'DATABASE': 'RDS',
    'DATABASES': 'RDS',
    // Lambda variations
    'LAMBDA': 'Lambda',
    'LAMBDAS': 'Lambda',
    'LAMBDAFUNCTION': 'Lambda',
    'FUNCTION': 'Lambda',
    'FUNCTIONS': 'Lambda',
    // ELB variations
    'ELB': 'ELB',
    'ELBS': 'ELB',
    'LOADBALANCER': 'ELB',
    'LOADBALANCERS': 'ELB',
    // NAT variations
    'NAT': 'NAT',
    'NATS': 'NAT',
    'NATGATEWAY': 'NAT',
    'NATGATEWAYS': 'NAT',
    // SecurityGroup variations
    'SECURITYGROUP': 'SecurityGroup',
    'SECURITYGROUPS': 'SecurityGroup',
    'SG': 'SecurityGroup',
    'SGS': 'SecurityGroup',
    // DynamoDB variations
    'DYNAMODB': 'DynamoDB',
    'DYNAMODBS': 'DynamoDB',
    'DYNAMODBTABLE': 'DynamoDB',
    'DYNAMODBTABLES': 'DynamoDB',
    'TABLE': 'DynamoDB',
    'TABLES': 'DynamoDB',
    // IAMRole variations
    'IAMROLE': 'IAMRole',
    'IAMROLES': 'IAMRole',
    'IAM': 'IAMRole',
    'ROLE': 'IAMRole',
    'ROLES': 'IAMRole',
    // Bedrock variations
    'BEDROCK': 'Bedrock',
    'BEDROCKS': 'Bedrock',
    'AMAZONBEDROCK': 'Bedrock',
  };

  return typeMap[normalized] || type;
}

/**
 * GET /api/resources
 *
 * Query discovered resources with optional filters
 * Query params:
 *   - profile: AWS profile name (required)
 *   - region: AWS region (required)
 *   - type: Resource type filter (EC2|VPC|S3|RDS|Lambda|ELB|NAT|SecurityGroup|IAMRole)
 *   - vpcId: Filter by VPC ID
 *
 * IMPORTANT: This endpoint returns resources from the specified region PLUS global resources (like IAM roles)
 * to ensure IAM roles are always visible in the dashboard regardless of selected region filter.
 */
router.get('/', (req, res) => {
  try {
    const { profile, region, type, vpcId } = req.query;

    console.log(`[API] GET /resources - profile: ${profile}, region: ${region}, type: ${type}, vpcId: ${vpcId}`);

    // Validate required params
    if (!profile || !region) {
      return res.status(400).json({
        success: false,
        error: 'Profile and region are required query parameters',
      });
    }

    // Build cache key for the requested region
    const cacheKey = CacheService.resourceKey(profile as string, region as string, type as string);

    // Try in-memory cache first, then persistent cache
    let cached = cacheService.get<ResourceInventory>(cacheKey);
    if (!cached) {
      cached = persistentCache.get<ResourceInventory>(cacheKey);
      if (cached) {
        // Restore to in-memory cache
        cacheService.set(cacheKey, cached, CacheService.TTL.RESOURCES);
        console.log(`[API] Restored ${cacheKey} from persistent cache to memory`);
      }
    }

    if (!cached) {
      return res.status(404).json({
        success: false,
        error: `No scan data found for ${profile} in ${region}. Please run a scan first.`,
        cacheKey,
      });
    }

    // Start with resources from the requested region
    let allResources = [...cached.resources];

    // ALWAYS include global resources (IAM roles) regardless of region filter
    // This ensures IAM roles show up in "Resources by Type" in the dashboard
    const globalCacheKey = CacheService.resourceKey(profile as string, 'global');
    let globalCached = cacheService.get<ResourceInventory>(globalCacheKey);
    if (!globalCached) {
      globalCached = persistentCache.get<ResourceInventory>(globalCacheKey);
      if (globalCached) {
        cacheService.set(globalCacheKey, globalCached, CacheService.TTL.RESOURCES);
        console.log(`[API] Restored ${globalCacheKey} from persistent cache`);
      }
    }

    if (globalCached && globalCached.resources) {
      console.log(`[API] GET /resources - Adding ${globalCached.resources.length} global resources to response`);
      allResources = [...allResources, ...globalCached.resources];
    } else {
      console.log(`[API] GET /resources - No global resources found in cache (key: ${globalCacheKey})`);
    }

    // Filter resources based on query params
    let filteredResources = allResources;

    if (type) {
      filteredResources = filteredResources.filter(r => r.type === type);
    }

    if (vpcId) {
      filteredResources = filteredResources.filter(r => r.vpcId === vpcId);
    }

    const remainingTTL = cacheService.getRemainingTTL(cacheKey);

    res.json({
      success: true,
      resources: filteredResources,
      count: filteredResources.length,
      fetchedAt: cached.fetchedAt,
      profile: cached.profile,
      region: cached.region,
      cached: true,
      cacheExpiresIn: remainingTTL,
      filters: {
        type: type || null,
        vpcId: vpcId || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /resources:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/resources/stats
 *
 * Get resource statistics from cache (aggregated across all regions for the profile)
 * Query params:
 *   - profile: AWS profile name (required)
 *   - region: AWS region (optional - used for fetching but stats aggregate all regions)
 */
router.get('/stats', (req, res) => {
  try {
    const { profile, region } = req.query;

    console.log(`[API] GET /resources/stats - profile: ${profile}, region: ${region}`);

    if (!profile) {
      return res.status(400).json({
        success: false,
        error: 'Profile is required query parameter',
      });
    }

    // Get all cache entries for this profile (across all regions)
    // Check both in-memory and persistent caches
    const memoryKeys = cacheService.getKeys();
    const persistentKeys = persistentCache.getKeys();
    const allKeys = Array.from(new Set([...memoryKeys, ...persistentKeys]));
    const profilePrefix = `resources:${profile}:`;
    const relevantKeys = allKeys.filter(key => key.startsWith(profilePrefix));

    console.log(`[API] GET /resources/stats - looking for profile prefix: ${profilePrefix}`);
    console.log(`[API] All cache keys: ${allKeys.join(', ')}`);
    console.log(`[API] Relevant keys found: ${relevantKeys.length} - ${relevantKeys.join(', ')}`);

    if (relevantKeys.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No resources found in cache. Please run a scan first.',
        hint: `Searched for keys starting with '${profilePrefix}'. Available keys: ${allKeys.join(', ')}`,
      });
    }

    // Aggregate stats across all regions
    const statsByType: Record<string, number> = {};
    const statsByRegion: Record<string, number> = {};
    const statsByVpc: Record<string, number> = {};
    const statsByState: Record<string, number> = {};
    let totalResources = 0;
    let latestFetchedAt = '';

    for (const cacheKey of relevantKeys) {
      // Try in-memory first, then persistent
      let cached = cacheService.get<ResourceInventory>(cacheKey);
      if (!cached) {
        cached = persistentCache.get<ResourceInventory>(cacheKey);
        if (cached) {
          // Restore to in-memory
          cacheService.set(cacheKey, cached, CacheService.TTL.RESOURCES);
          console.log(`[API] Restored ${cacheKey} from persistent cache`);
        }
      }

      // Defensive check: ensure cached data exists
      if (!cached) {
        console.log(`[API] Cache key ${cacheKey} exists but returned no data (possibly expired)`);
        continue;
      }

      // Defensive check: ensure resources array exists and is valid
      if (!cached.resources || !Array.isArray(cached.resources)) {
        console.log(`[API] Cache key ${cacheKey} has invalid or missing resources array:`, {
          hasResources: !!cached.resources,
          isArray: Array.isArray(cached.resources),
          type: typeof cached.resources,
        });
        continue;
      }

      console.log(`[API] Processing ${cached.resources.length} resources from cache key ${cacheKey}`);

      // Track latest fetch time
      if (!latestFetchedAt || cached.fetchedAt > latestFetchedAt) {
        latestFetchedAt = cached.fetchedAt;
      }

      // Aggregate resources
      for (const resource of cached.resources) {
        totalResources++;

        // Count by type (normalize to handle plural/singular variations)
        const normalizedType = normalizeResourceType(resource.type);
        statsByType[normalizedType] = (statsByType[normalizedType] || 0) + 1;

        // Count by region
        statsByRegion[cached.region] = (statsByRegion[cached.region] || 0) + 1;

        // Count by VPC
        if (resource.vpcId) {
          statsByVpc[resource.vpcId] = (statsByVpc[resource.vpcId] || 0) + 1;
        }

        // Count by state
        if (resource.state) {
          statsByState[resource.state] = (statsByState[resource.state] || 0) + 1;
        }
      }
    }

    console.log(`[API] Stats aggregation complete - total resources: ${totalResources}`);

    res.json({
      success: true,
      stats: {
        total: totalResources,
        byType: statsByType,
        byRegion: statsByRegion,
        byVpc: statsByVpc,
        byState: statsByState,
      },
      fetchedAt: latestFetchedAt,
      profile: profile as string,
      regionsScanned: relevantKeys.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /resources/stats:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/resources/cache/debug
 *
 * Debug endpoint to inspect cache contents
 */
router.get('/cache/debug', (req, res) => {
  try {
    console.log('[API] GET /resources/cache/debug');

    const allKeys = cacheService.getKeys();
    const cacheStats = cacheService.getStats();

    // Group keys by type
    const resourceKeys = allKeys.filter(k => k.startsWith('resources:'));
    const securityKeys = allKeys.filter(k => k.startsWith('security:') || k.startsWith('alerts:'));
    const otherKeys = allKeys.filter(k => !k.startsWith('resources:') && !k.startsWith('security:') && !k.startsWith('alerts:'));

    // For each resource key, get a summary of what's cached
    const resourceSummary = resourceKeys.map(key => {
      const inventory = cacheService.get<ResourceInventory>(key);
      const ttl = cacheService.getRemainingTTL(key);
      return {
        key,
        resourceCount: inventory?.resources?.length || 0,
        profile: inventory?.profile,
        region: inventory?.region,
        fetchedAt: inventory?.fetchedAt,
        ttlSeconds: ttl,
      };
    });

    res.json({
      success: true,
      stats: cacheStats,
      keys: {
        total: allKeys.length,
        resources: resourceKeys.length,
        security: securityKeys.length,
        other: otherKeys.length,
      },
      allKeys,
      resourceKeys,
      securityKeys,
      otherKeys,
      resourceSummary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /resources/cache/debug:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/resources/cache
 *
 * Clear resource cache for a profile/region
 * Query params:
 *   - profile: AWS profile name (required)
 *   - region: AWS region (optional, if omitted clears all regions for profile)
 */
router.delete('/cache', (req, res) => {
  try {
    const { profile, region } = req.query;

    console.log(`[API] DELETE /resources/cache - profile: ${profile}, region: ${region}`);

    if (!profile) {
      return res.status(400).json({
        success: false,
        error: 'Profile is required',
      });
    }

    let cleared: number;

    if (region) {
      // Clear specific region
      const cacheKey = CacheService.resourceKey(profile as string, region as string);
      const deleted = cacheService.delete(cacheKey);
      cleared = deleted ? 1 : 0;
    } else {
      // Clear all regions for profile
      const pattern = `resources:${profile}:`;
      cleared = cacheService.clearPattern(pattern);
    }

    res.json({
      success: true,
      message: `Cleared ${cleared} cache entries for profile: ${profile}`,
      cleared,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in DELETE /resources/cache:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
