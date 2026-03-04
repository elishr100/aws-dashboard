import { Router, Request, Response } from 'express';
import { AggregationService } from '../services/AggregationService.js';
import { AccountDiscoveryService } from '../services/AccountDiscoveryService.js';

const router = Router();
const aggregationService = new AggregationService();

/**
 * GET /api/analytics/aggregated
 * Get aggregated metrics across all or specific accounts
 */
router.get('/aggregated', async (req: Request, res: Response) => {
  try {
    const { accountIds } = req.query;

    const accountIdArray = accountIds
      ? (accountIds as string).split(',').map((id) => id.trim())
      : undefined;

    const metrics = await aggregationService.aggregateMetrics(accountIdArray);
    res.json(metrics);
  } catch (error) {
    console.error('Error fetching aggregated metrics:', error);
    res.status(500).json({ error: 'Failed to fetch aggregated metrics' });
  }
});

/**
 * POST /api/analytics/comparison
 * Compare multiple accounts
 */
router.post('/comparison', async (req: Request, res: Response) => {
  try {
    const { accountIds } = req.body;

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length < 2) {
      return res.status(400).json({
        error: 'At least 2 account IDs are required for comparison',
      });
    }

    if (accountIds.length > 10) {
      return res.status(400).json({
        error: 'Maximum 10 accounts can be compared at once',
      });
    }

    const comparison = await aggregationService.compareAccounts(accountIds);
    res.json(comparison);
  } catch (error) {
    console.error('Error comparing accounts:', error);
    res.status(500).json({ error: 'Failed to compare accounts' });
  }
});

/**
 * GET /api/analytics/benchmarks/:accountId
 * Get benchmark for a specific account
 */
router.get('/benchmarks/:accountId', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;

    const benchmark = await aggregationService.benchmarkAccount(accountId);
    res.json(benchmark);
  } catch (error: any) {
    console.error('Error fetching benchmark:', error);

    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to fetch benchmark' });
  }
});

/**
 * GET /api/analytics/trends
 * Get organization-wide trends
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const trends = await aggregationService.getOrganizationTrends();
    res.json(trends);
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

/**
 * POST /api/analytics/chargeback
 * Generate chargeback report
 */
router.post('/chargeback', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, allocationType } = req.body;

    if (!startDate || !endDate || !allocationType) {
      return res.status(400).json({
        error: 'Missing required fields: startDate, endDate, allocationType',
      });
    }

    if (!['BY_ACCOUNT', 'BY_TAG', 'BY_TEAM'].includes(allocationType)) {
      return res.status(400).json({
        error: 'Invalid allocationType. Must be BY_ACCOUNT, BY_TAG, or BY_TEAM',
      });
    }

    const report = await aggregationService.generateChargebackReport(
      startDate,
      endDate,
      allocationType
    );

    res.json(report);
  } catch (error) {
    console.error('Error generating chargeback report:', error);
    res.status(500).json({ error: 'Failed to generate chargeback report' });
  }
});

/**
 * POST /api/analytics/search
 * Federated search across accounts
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const searchRequest = req.body;

    const results = await aggregationService.searchResources(searchRequest);
    res.json(results);
  } catch (error) {
    console.error('Error performing federated search:', error);
    res.status(500).json({ error: 'Failed to perform federated search' });
  }
});

/**
 * GET /api/analytics/summary
 * Get executive summary
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    // Get all accounts from ~/.aws/config (does NOT depend on scan data)
    const accountService = new AccountDiscoveryService();
    const allAccounts = accountService.discoverAccounts();

    const metrics = await aggregationService.aggregateMetrics();

    const summary = {
      overview: {
        totalAccounts: allAccounts.length, // Use accounts from ~/.aws/config, not from scan cache
        totalResources: metrics.resources.total,
        totalCost: metrics.costs.total,
        averageCostPerAccount: metrics.costs.total / Math.max(1, Object.keys(metrics.costs.byAccount).length),
      },
      security: {
        overallScore: metrics.security.overallScore,
        criticalFindings: metrics.security.criticalFindings,
        highFindings: metrics.security.highFindings,
        status:
          metrics.security.overallScore >= 90
            ? 'EXCELLENT'
            : metrics.security.overallScore >= 75
            ? 'GOOD'
            : metrics.security.overallScore >= 50
            ? 'FAIR'
            : 'POOR',
      },
      compliance: {
        overallScore: metrics.compliance.overallScore,
        frameworks: metrics.compliance.byFramework,
        status:
          metrics.compliance.overallScore >= 90
            ? 'EXCELLENT'
            : metrics.compliance.overallScore >= 75
            ? 'GOOD'
            : metrics.compliance.overallScore >= 50
            ? 'FAIR'
            : 'POOR',
      },
      costs: {
        total: metrics.costs.total,
        trend: metrics.costs.trend,
        topSpenders: Object.entries(metrics.costs.byAccount)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([accountId, cost]) => {
            // Resolve account ID to profile name
            const accountService = new AccountDiscoveryService();
            const displayName = accountService.resolveAccountIdToProfile(accountId);

            return {
              accountId,
              accountName: displayName,
              cost,
            };
          }),
        byService: metrics.costs.byService,
      },
      resources: {
        total: metrics.resources.total,
        byType: metrics.resources.byType,
        byRegion: metrics.resources.byRegion,
      },
      generatedAt: metrics.generatedAt,
    };

    res.json(summary);
  } catch (error) {
    console.error('Error fetching executive summary:', error);
    res.status(500).json({ error: 'Failed to fetch executive summary' });
  }
});

/**
 * GET /api/analytics/cost-allocation
 * Get cost allocation breakdown
 */
router.get('/cost-allocation', async (req: Request, res: Response) => {
  try {
    const { groupBy } = req.query;

    const metrics = await aggregationService.aggregateMetrics();

    let allocation: any;

    if (groupBy === 'service') {
      allocation = {
        type: 'BY_SERVICE',
        breakdown: Object.entries(metrics.costs.byService).map(([service, cost]) => ({
          name: service,
          cost,
          percentage: (cost / metrics.costs.total) * 100,
        })),
      };
    } else if (groupBy === 'region') {
      allocation = {
        type: 'BY_REGION',
        breakdown: Object.entries(metrics.costs.byRegion).map(([region, cost]) => ({
          name: region,
          cost,
          percentage: (cost / metrics.costs.total) * 100,
        })),
      };
    } else {
      // Default: by account
      const accountService = new AccountDiscoveryService();

      allocation = {
        type: 'BY_ACCOUNT',
        breakdown: Object.entries(metrics.costs.byAccount).map(([accountId, cost]) => ({
          accountId,
          accountName: accountService.resolveAccountIdToProfile(accountId),
          cost,
          percentage: (cost / metrics.costs.total) * 100,
        })),
      };
    }

    allocation.totalCost = metrics.costs.total;
    allocation.generatedAt = new Date().toISOString();

    res.json(allocation);
  } catch (error) {
    console.error('Error fetching cost allocation:', error);
    res.status(500).json({ error: 'Failed to fetch cost allocation' });
  }
});

export default router;
