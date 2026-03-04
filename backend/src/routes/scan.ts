import { Router } from 'express';
import { randomUUID } from 'crypto';
import { ResourceDiscoveryAgent } from '../agents/ResourceDiscoveryAgent.js';
import { cacheService, CacheService } from '../services/CacheService.js';
import { persistentCache } from '../services/PersistentCacheService.js';
import { SecurityAuditService } from '../services/SecurityAuditService.js';
import { AlertService } from '../services/AlertService.js';
import { ServiceFactory } from '../services/ServiceFactory.js';
import type { ScanJob, ScanRequest, AWSResource, ResourceInventory } from '../types/index.js';

const router = Router();

// Store active scan jobs in memory
const scanJobs = new Map<string, ScanJob>();

/**
 * POST /api/scan
 *
 * Trigger a resource discovery scan
 * Body: { profile: string, regions: string[] }
 * Returns: { jobId: string }
 */
router.post('/', async (req, res) => {
  try {
    const { profile, regions } = req.body as ScanRequest;

    console.log(`[API] POST /scan - profile: "${profile}", regions: ${regions?.join(', ')}`);
    console.log(`[API] POST /scan - Profile will be used for caching with key prefix: resources:${profile}:`);

    // Validate input
    if (!profile) {
      return res.status(400).json({
        success: false,
        error: 'Profile is required',
      });
    }

    if (!regions || regions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one region is required',
      });
    }

    // Generate job ID
    const jobId = randomUUID();

    // Create scan job
    const job: ScanJob = {
      jobId,
      status: 'pending',
      profile,
      regions,
      startedAt: new Date().toISOString(),
      progress: 0,
      resourcesFound: 0,
    };

    scanJobs.set(jobId, job);

    // Start scan in background (don't await)
    executeScan(jobId, profile, regions).catch(error => {
      console.error(`[Scan] Error in background scan ${jobId}:`, error);
      const job = scanJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.errors = [error instanceof Error ? error.message : 'Unknown error'];
        job.completedAt = new Date().toISOString();
      }
    });

    res.json({
      success: true,
      jobId,
      message: 'Scan job started',
      streamUrl: `/api/scan/${jobId}/stream`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in POST /scan:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/scan/:jobId/stream
 *
 * Server-Sent Events stream for scan progress
 */
router.get('/:jobId/stream', (req, res) => {
  const { jobId } = req.params;

  console.log(`[API] GET /scan/${jobId}/stream - SSE connection opened`);

  const job = scanJobs.get(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Scan job not found',
    });
  }

  // Set timeout to 300 seconds (5 minutes) for SSE connection
  req.setTimeout(300000);
  res.setTimeout(300000);

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial job status
  const startMessage = {
    type: 'progress',
    data: {
      progress: { current: 0, total: job.regions.length },
      message: 'Starting scan...',
      jobId: job.jobId,
    }
  };
  sendSSE(res, 'message', startMessage);

  // Poll for updates every 500ms
  const interval = setInterval(() => {
    const currentJob = scanJobs.get(jobId);

    if (!currentJob) {
      const errorMessage = {
        type: 'error',
        data: { error: 'Job not found' }
      };
      sendSSE(res, 'message', errorMessage);
      clearInterval(interval);
      res.end();
      return;
    }

    // Send progress update
    const totalRegions = currentJob.regions.length;
    const currentRegionIndex = Math.floor((currentJob.progress / 100) * totalRegions);

    const progressMessage = {
      type: 'progress',
      data: {
        progress: {
          current: currentRegionIndex,
          total: totalRegions
        },
        message: currentJob.currentRegion
          ? `Scanning ${currentJob.currentRegion}... (${currentJob.resourcesFound} resources found)`
          : `Progress: ${currentJob.progress}%`,
        jobId: currentJob.jobId,
      }
    };
    sendSSE(res, 'message', progressMessage);

    // If job is complete or failed, end stream
    if (currentJob.status === 'completed' || currentJob.status === 'failed') {
      const completeMessage = {
        type: currentJob.status === 'failed' ? 'error' : 'complete',
        data: {
          progress: { current: totalRegions, total: totalRegions },
          message: currentJob.status === 'failed'
            ? 'Scan failed'
            : `Scan completed - ${currentJob.resourcesFound} resources found (cached under profile: ${currentJob.profile})`,
          resources: currentJob.status === 'completed' ? new Array(currentJob.resourcesFound) : undefined,
          resourcesFound: currentJob.resourcesFound,
          error: currentJob.status === 'failed' ? (currentJob.errors?.join(', ') || 'Unknown error') : undefined,
          jobId: currentJob.jobId,
        }
      };
      sendSSE(res, 'message', completeMessage);
      clearInterval(interval);
      res.end();
      console.log(`[API] SSE stream closed for job ${jobId}`);
    }
  }, 500);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    console.log(`[API] Client disconnected from SSE stream ${jobId}`);
  });
});

/**
 * GET /api/scan/:jobId/status
 *
 * Get scan job status (lightweight endpoint for polling)
 */
router.get('/:jobId/status', (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`[API] GET /scan/${jobId}/status`);

    const job = scanJobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Scan job not found',
      });
    }

    res.json({
      success: true,
      status: job.status,
      progress: job.progress,
      resourcesFound: job.resourcesFound,
      currentRegion: job.currentRegion,
      completedAt: job.completedAt,
      errors: job.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /scan/:jobId/status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/scan/:jobId
 *
 * Get scan job details (full job object)
 */
router.get('/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`[API] GET /scan/${jobId}`);

    const job = scanJobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Scan job not found',
      });
    }

    res.json({
      success: true,
      job,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /scan/:jobId:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Execute scan in background with timeout
 */
async function executeScan(jobId: string, profile: string, regions: string[]): Promise<void> {
  const job = scanJobs.get(jobId);
  if (!job) return;

  console.log(`[Scan] Starting scan ${jobId} for ${profile} in ${regions.length} regions`);

  job.status = 'running';

  // Wrap the entire scan with a 1800-second timeout
  const FULL_SCAN_TIMEOUT = 1800000; // 1800 seconds

  const scanPromise = executeScanInternal(jobId, profile, regions);
  const timeoutPromise = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error('Full scan timeout after 1800 seconds')), FULL_SCAN_TIMEOUT)
  );

  try {
    await Promise.race([scanPromise, timeoutPromise]);
  } catch (error) {
    console.error(`[Scan] Scan ${jobId} failed or timed out:`, error);
    const currentJob = scanJobs.get(jobId);
    if (currentJob) {
      currentJob.status = 'failed';
      currentJob.errors = currentJob.errors || [];
      currentJob.errors.push(error instanceof Error ? error.message : 'Unknown error');
      currentJob.completedAt = new Date().toISOString();
    }
  }
}

/**
 * Internal scan execution logic
 */
async function executeScanInternal(jobId: string, profile: string, regions: string[]): Promise<void> {
  const job = scanJobs.get(jobId);
  if (!job) return;

  // Use ServiceFactory to get shared ResourceDiscoveryAgent instance
  const agent = ServiceFactory.getResourceDiscoveryAgent(profile, regions[0]);
  const totalRegions = regions.length;
  let completedRegions = 0;
  let baseResourceCount = 0; // Track resources found in previous regions

  // Discover GLOBAL resources ONCE (not per-region)
  const globalResources: any[] = [];

  try {
    console.log(`[Scan] Discovering global resources (IAM, Route53, CloudTrail, WAF Global, Bedrock) for ${profile}`);

    // Run all global discoveries in parallel
    const [iamRoles, iamUsers, iamPolicies, route53Zones, cloudTrailTrails, wafGlobal, bedrockUsage] = await Promise.allSettled([
      agent.discoverIAMRoles(),
      agent.discoverIAMUsers(),
      agent.discoverIAMPolicies(),
      agent.discoverRoute53Zones(),
      agent.discoverCloudTrailTrails(),
      agent.discoverWAFGlobal(),
      agent.discoverBedrockUsage(),
    ]);

    // Process results
    if (iamRoles.status === 'fulfilled') {
      globalResources.push(...iamRoles.value);
      console.log(`[Scan] Found ${iamRoles.value.length} IAM roles`);
    } else {
      console.error(`[Scan] Error discovering IAM roles:`, iamRoles.reason);
      job.errors = job.errors || [];
      job.errors.push(`IAMRole: ${iamRoles.reason instanceof Error ? iamRoles.reason.message : 'Unknown error'}`);
    }

    if (iamUsers.status === 'fulfilled') {
      globalResources.push(...iamUsers.value);
      console.log(`[Scan] Found ${iamUsers.value.length} IAM users`);
    } else {
      console.error(`[Scan] Error discovering IAM users:`, iamUsers.reason);
      job.errors = job.errors || [];
      job.errors.push(`IAMUser: ${iamUsers.reason instanceof Error ? iamUsers.reason.message : 'Unknown error'}`);
    }

    if (iamPolicies.status === 'fulfilled') {
      globalResources.push(...iamPolicies.value);
      console.log(`[Scan] Found ${iamPolicies.value.length} IAM policies`);
    } else {
      console.error(`[Scan] Error discovering IAM policies:`, iamPolicies.reason);
      job.errors = job.errors || [];
      job.errors.push(`IAMPolicy: ${iamPolicies.reason instanceof Error ? iamPolicies.reason.message : 'Unknown error'}`);
    }

    if (route53Zones.status === 'fulfilled') {
      globalResources.push(...route53Zones.value);
      console.log(`[Scan] Found ${route53Zones.value.length} Route53 zones`);
    } else {
      console.error(`[Scan] Error discovering Route53:`, route53Zones.reason);
      job.errors = job.errors || [];
      job.errors.push(`Route53: ${route53Zones.reason instanceof Error ? route53Zones.reason.message : 'Unknown error'}`);
    }

    if (cloudTrailTrails.status === 'fulfilled') {
      globalResources.push(...cloudTrailTrails.value);
      console.log(`[Scan] Found ${cloudTrailTrails.value.length} CloudTrail trails`);
    } else {
      console.error(`[Scan] Error discovering CloudTrail:`, cloudTrailTrails.reason);
      job.errors = job.errors || [];
      job.errors.push(`CloudTrail: ${cloudTrailTrails.reason instanceof Error ? cloudTrailTrails.reason.message : 'Unknown error'}`);
    }

    if (wafGlobal.status === 'fulfilled') {
      globalResources.push(...wafGlobal.value);
      console.log(`[Scan] Found ${wafGlobal.value.length} WAF Global Web ACLs`);
    } else {
      console.error(`[Scan] Error discovering WAF Global:`, wafGlobal.reason);
      job.errors = job.errors || [];
      job.errors.push(`WAF Global: ${wafGlobal.reason instanceof Error ? wafGlobal.reason.message : 'Unknown error'}`);
    }

    if (bedrockUsage.status === 'fulfilled') {
      globalResources.push(...bedrockUsage.value);
      console.log(`[Scan] Found ${bedrockUsage.value.length} Bedrock usage records`);
    } else {
      console.error(`[Scan] Error discovering Bedrock usage:`, bedrockUsage.reason);
      // Don't add to errors - Bedrock discovery is optional
    }

    baseResourceCount = globalResources.length;
    job.resourcesFound = baseResourceCount;
    console.log(`[Scan] Found ${globalResources.length} total global resources`);

    // Cache global resources (in-memory + disk)
    const globalCacheKey = `resources:${profile}:global`;
    const globalInventory = {
      resources: globalResources,
      fetchedAt: new Date().toISOString(),
      profile,
      region: 'global',
    };

    cacheService.set(globalCacheKey, globalInventory, CacheService.TTL.RESOURCES);
    await persistentCache.set(globalCacheKey, globalInventory);
    console.log(`[Scan] Cached ${globalResources.length} global resources under key: ${globalCacheKey}`);
  } catch (error) {
    console.error(`[Scan] Error discovering global resources:`, error);
    job.errors = job.errors || [];
    job.errors.push(`Global: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  for (const region of regions) {
    if (job.status !== 'running') {
      console.log(`[Scan] Job ${jobId} cancelled or failed`);
      break;
    }

    try {
      console.log(`[Scan] Discovering resources in ${region}`);
      job.currentRegion = region;

      // Set up progress callback for this region to update count in real-time
      agent.setProgressCallback((currentRegionCount: number) => {
        if (job) {
          job.resourcesFound = baseResourceCount + currentRegionCount;
        }
      });

      const inventory = await agent.discoverAll(region);

      // Update base count for next region
      baseResourceCount += inventory.resources.length;
      job.resourcesFound = baseResourceCount;

      // Cache the results (in-memory + disk)
      const cacheKey = CacheService.resourceKey(profile, region);
      cacheService.set(cacheKey, inventory, CacheService.TTL.RESOURCES);
      await persistentCache.set(cacheKey, inventory);

      console.log(`[Scan] Found ${inventory.resources.length} resources in ${region}`);
      console.log(`[Scan] Cached resources under key: ${cacheKey}`);

      if (inventory.errors) {
        job.errors = job.errors || [];
        job.errors.push(...inventory.errors);
      }

      completedRegions++;
      job.progress = Math.floor((completedRegions / totalRegions) * 100);
    } catch (error) {
      console.error(`[Scan] Error scanning ${region}:`, error);
      job.errors = job.errors || [];
      job.errors.push(`${region}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.progress = 100;

  console.log(`[Scan] Scan ${jobId} completed - found ${job.resourcesFound} resources`);
  console.log(`[Scan] Resources cached for profile: ${profile} across ${regions.length} regions`);

  // Fetch and attach cost data to resources
  fetchResourceCosts(profile, regions).catch(error => {
    console.error(`[Scan] Failed to fetch resource costs (non-fatal):`, error);
  });

  // Automatically trigger security audit after scan completion
  triggerSecurityAudit(profile, regions).catch(error => {
    console.error(`[Scan] Failed to trigger automatic security audit:`, error);
  });

  // Clean up job after 5 minutes
  setTimeout(() => {
    scanJobs.delete(jobId);
    console.log(`[Scan] Cleaned up job ${jobId}`);
  }, 5 * 60 * 1000);
}

/**
 * Fetch and attach cost data to resources (runs in background)
 */
async function fetchResourceCosts(profile: string, regions: string[]): Promise<void> {
  try {
    console.log(`[Scan] Fetching cost data for resources in ${profile} across ${regions.length} regions`);

    // Collect all resources from cache
    const allResources: AWSResource[] = [];
    for (const region of regions) {
      const cacheKey = CacheService.resourceKey(profile, region);
      const inventory = cacheService.get<ResourceInventory>(cacheKey);
      console.log(`[Scan] Fetching resources from cache key: ${cacheKey} - found: ${inventory?.resources?.length || 0} resources`);
      if (inventory?.resources) {
        allResources.push(...inventory.resources);
      }
    }

    // Also include global resources
    const globalCacheKey = `resources:${profile}:global`;
    const globalInventory = cacheService.get<ResourceInventory>(globalCacheKey);
    if (globalInventory?.resources) {
      console.log(`[Scan] Adding ${globalInventory.resources.length} global resources to cost fetch`);
      allResources.push(...globalInventory.resources);
    }

    console.log(`[Scan] Total resources to fetch costs for: ${allResources.length}`);

    if (allResources.length === 0) {
      console.log(`[Scan] No resources found, skipping cost fetch`);
      return;
    }

    // Fetch costs using CostAnalysisService via ServiceFactory (shared singleton)
    const costService = ServiceFactory.getCostAnalysisService(profile, regions[0]);
    const resourceCosts = await costService.getResourceCosts(profile, allResources);

    console.log(`[Scan] Fetched cost data for ${resourceCosts.size} resources`);

    // Calculate total costs for Analytics
    let totalCurrentMonthCost = 0;
    let totalAvgMonthlyCost = 0;
    const costByService: Record<string, number> = {};

    for (const [resourceId, cost] of resourceCosts.entries()) {
      totalCurrentMonthCost += cost.currentMonthCost;
      totalAvgMonthlyCost += cost.avgMonthlyCost;

      // Find resource type for service aggregation
      const resource = allResources.find(r => r.id === resourceId);
      if (resource) {
        costByService[resource.type] = (costByService[resource.type] || 0) + cost.currentMonthCost;
      }
    }

    console.log(`[Scan] Total costs - Current month: $${totalCurrentMonthCost.toFixed(2)}, Avg monthly: $${totalAvgMonthlyCost.toFixed(2)}`);

    // Update cached resources with cost data (both in-memory and persistent)
    let updatedCount = 0;
    for (const region of regions) {
      const cacheKey = CacheService.resourceKey(profile, region);
      const inventory = cacheService.get<ResourceInventory>(cacheKey);

      if (inventory?.resources) {
        // Attach cost data to resources
        inventory.resources = inventory.resources.map(resource => {
          const cost = resourceCosts.get(resource.id);
          if (cost) {
            updatedCount++;
            return { ...resource, cost };
          }
          return resource;
        });

        // Save updated inventory back to BOTH caches
        cacheService.set(cacheKey, inventory, CacheService.TTL.RESOURCES);
        await persistentCache.set(cacheKey, inventory);
        console.log(`[Scan] Persisted ${inventory.resources.length} resources with costs to ${cacheKey}`);
      }
    }

    // Update global resources with costs
    if (globalInventory?.resources) {
      globalInventory.resources = globalInventory.resources.map(resource => {
        const cost = resourceCosts.get(resource.id);
        if (cost) {
          updatedCount++;
          return { ...resource, cost };
        }
        return resource;
      });

      cacheService.set(globalCacheKey, globalInventory, CacheService.TTL.RESOURCES);
      await persistentCache.set(globalCacheKey, globalInventory);
      console.log(`[Scan] Persisted ${globalInventory.resources.length} global resources with costs`);
    }

    // Fetch previous month cost for trend calculation
    let previousMonthCost = 0;
    try {
      const costSummary = await costService.getCostSummary(profile, '', '');
      previousMonthCost = costSummary.previousMonth || 0;
      console.log(`[Scan] Previous month cost: $${previousMonthCost.toFixed(2)}`);
    } catch (error) {
      console.warn(`[Scan] Failed to fetch previous month cost (non-fatal):`, error);
    }

    // Calculate trend
    let trend = 'STABLE';
    if (previousMonthCost > 0) {
      const changePercentage = ((totalCurrentMonthCost - previousMonthCost) / previousMonthCost) * 100;
      if (changePercentage > 5) {
        trend = 'INCREASING';
      } else if (changePercentage < -5) {
        trend = 'DECREASING';
      }
      console.log(`[Scan] Cost trend: ${trend} (${changePercentage.toFixed(1)}% change)`);
    }

    // Save total cost data for Analytics (aggregated across all resources)
    const costCacheKey = `costs:${profile}`;
    const costData = {
      totalCost: totalCurrentMonthCost,
      previousMonthCost,
      avgMonthlyCost: totalAvgMonthlyCost,
      trend,
      costByService,
      currency: 'USD',
      lastUpdated: new Date().toISOString(),
      profile,
    };
    await persistentCache.set(costCacheKey, costData);
    console.log(`[Scan] Saved total cost data to persistent cache: ${costCacheKey} - $${totalCurrentMonthCost.toFixed(2)} (trend: ${trend})`);

    console.log(`[Scan] Updated ${updatedCount} resources with cost data`);
  } catch (error) {
    console.error(`[Scan] Failed to fetch resource costs:`, error);
    // Don't throw - cost fetch failure should not affect the scan
  }
}

/**
 * Trigger security audit after scan completion (runs in background)
 */
async function triggerSecurityAudit(profile: string, regions: string[]): Promise<void> {
  try {
    console.log(`[Scan] Starting automatic security audit for ${profile} in ${regions.length} regions`);

    const { SecurityAuditAgent } = await import('../agents/SecurityAuditAgent.js');
    const alertService = ServiceFactory.getAlertService();

    const allFindings: any[] = [];

    // Audit resources in each region using cached data
    for (const region of regions) {
      const cacheKey = CacheService.resourceKey(profile, region);
      const inventory = cacheService.get<ResourceInventory>(cacheKey);

      if (!inventory || !inventory.resources || inventory.resources.length === 0) {
        console.log(`[Scan] No cached resources found for ${region}, skipping security audit`);
        continue;
      }

      console.log(`[Scan] Auditing ${inventory.resources.length} resources in ${region}`);

      const auditAgent = new SecurityAuditAgent();
      const findings = await auditAgent.auditResources(inventory, profile, region);

      allFindings.push(...findings);

      // Cache the findings for this region (in-memory + disk)
      const securityCacheKey = `security:${profile}:${region}`;
      cacheService.set(securityCacheKey, findings, CacheService.TTL.SECURITY_ALERTS);
      await persistentCache.set(securityCacheKey, findings);
      console.log(`[Scan] Cached ${findings.length} findings for ${region} under key ${securityCacheKey}`);
    }

    // Calculate summary
    const summary = {
      total: allFindings.length,
      critical: allFindings.filter((f: any) => f.severity === 'CRITICAL').length,
      high: allFindings.filter((f: any) => f.severity === 'HIGH').length,
      medium: allFindings.filter((f: any) => f.severity === 'MEDIUM').length,
      low: allFindings.filter((f: any) => f.severity === 'LOW').length,
    };

    console.log(`[Scan] Security audit completed - found ${summary.total} findings`);
    console.log(`[Scan] Critical: ${summary.critical}, High: ${summary.high}, Medium: ${summary.medium}, Low: ${summary.low}`);

    // Create alerts from critical and high severity findings
    const criticalFindings = allFindings.filter(
      (f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH'
    );

    if (criticalFindings.length > 0) {
      // Create alerts from critical and high findings
      await alertService.createAlertsFromCriticalAndHighFindings(criticalFindings);
      console.log(`[Scan] Created ${criticalFindings.length} security alerts and persisted to disk`);
    }
  } catch (error) {
    console.error(`[Scan] Security audit failed:`, error);
    // Don't throw - we don't want to fail the scan if audit fails
  }
}

/**
 * Send Server-Sent Event
 */
function sendSSE(res: any, event: string, data: any): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default router;
