import { Router, Request, Response } from 'express';
import { ServiceFactory } from '../services/ServiceFactory.js';
import { BudgetService } from '../services/BudgetService.js';
import { cacheService, CacheService } from '../services/CacheService.js';
import type { CostQuery, Budget } from '../types/cost.js';
import type { AWSResource, ResourceInventory } from '../types/index.js';

const router = Router();

// Budget service (doesn't need ClaudeMCPService)
const budgetService = new BudgetService();

/**
 * POST /api/cost/report
 * Generate comprehensive cost report
 */
router.post('/report', async (req: Request, res: Response) => {
  try {
    const query: CostQuery = req.body;

    if (!query.profile || !query.startDate || !query.endDate) {
      return res.status(400).json({
        error: 'profile, startDate, and endDate are required',
      });
    }

    console.log(`[CostAPI] Generating cost report for ${query.profile}`);

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(query.profile, query.region || 'us-west-2');
    const report = await costService.getCostReport(query);

    res.json(report);
  } catch (error: any) {
    console.error('[CostAPI] Failed to generate report:', error);
    res.status(500).json({
      error: 'Failed to generate cost report',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/summary
 * Get cost summary
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { profile, startDate, endDate } = req.query;

    if (!profile || !startDate || !endDate) {
      return res.status(400).json({
        error: 'profile, startDate, and endDate are required',
      });
    }

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(profile as string, 'us-west-2');
    const summary = await costService.getCostSummary(
      profile as string,
      startDate as string,
      endDate as string
    );

    res.json(summary);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get summary:', error);
    res.status(500).json({
      error: 'Failed to retrieve cost summary',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/trends
 * Get cost trends
 */
router.get('/trends', async (req: Request, res: Response) => {
  try {
    const { profile, startDate, endDate } = req.query;

    if (!profile || !startDate || !endDate) {
      return res.status(400).json({
        error: 'profile, startDate, and endDate are required',
      });
    }

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(profile as string, 'us-west-2');
    const trends = await costService.getCostTrends(
      profile as string,
      startDate as string,
      endDate as string
    );

    res.json(trends);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get trends:', error);
    res.status(500).json({
      error: 'Failed to retrieve cost trends',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/forecast
 * Get cost forecast
 */
router.get('/forecast', async (req: Request, res: Response) => {
  try {
    const { profile, days } = req.query;

    if (!profile) {
      return res.status(400).json({
        error: 'profile is required',
      });
    }

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(profile as string, 'us-west-2');
    const forecast = await costService.getCostForecast(
      profile as string,
      days ? parseInt(days as string) : 30
    );

    res.json(forecast);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get forecast:', error);
    res.status(500).json({
      error: 'Failed to retrieve cost forecast',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/anomalies
 * Get cost anomalies
 */
router.get('/anomalies', (req: Request, res: Response) => {
  try {
    const anomalies = costService.getAnomalies();
    res.json(anomalies);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get anomalies:', error);
    res.status(500).json({
      error: 'Failed to retrieve anomalies',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/recommendations
 * Get cost optimization recommendations
 */
router.get('/recommendations', (req: Request, res: Response) => {
  try {
    const { severity, type } = req.query;

    const recommendations = costService.getRecommendations({
      severity: severity as string,
      type: type as string,
    });

    res.json(recommendations);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get recommendations:', error);
    res.status(500).json({
      error: 'Failed to retrieve recommendations',
      message: error.message,
    });
  }
});

/**
 * POST /api/cost/budgets
 * Create a new budget
 */
router.post('/budgets', (req: Request, res: Response) => {
  try {
    const budgetData = req.body;

    if (!budgetData.name || !budgetData.amount || !budgetData.period) {
      return res.status(400).json({
        error: 'name, amount, and period are required',
      });
    }

    const budget = budgetService.createBudget(budgetData);

    res.json(budget);
  } catch (error: any) {
    console.error('[CostAPI] Failed to create budget:', error);
    res.status(500).json({
      error: 'Failed to create budget',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/budgets
 * Get all budgets
 */
router.get('/budgets', (req: Request, res: Response) => {
  try {
    const { profile, status } = req.query;

    const budgets = budgetService.getBudgets({
      profile: profile as string,
      status: status as Budget['status'],
    });

    res.json(budgets);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get budgets:', error);
    res.status(500).json({
      error: 'Failed to retrieve budgets',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/budgets/:budgetId
 * Get a specific budget
 */
router.get('/budgets/:budgetId', (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const budget = budgetService.getBudget(budgetId);

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(budget);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get budget:', error);
    res.status(500).json({
      error: 'Failed to retrieve budget',
      message: error.message,
    });
  }
});

/**
 * PATCH /api/cost/budgets/:budgetId
 * Update a budget
 */
router.patch('/budgets/:budgetId', (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const updates = req.body;

    const budget = budgetService.updateBudget(budgetId, updates);

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(budget);
  } catch (error: any) {
    console.error('[CostAPI] Failed to update budget:', error);
    res.status(500).json({
      error: 'Failed to update budget',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/cost/budgets/:budgetId
 * Delete a budget
 */
router.delete('/budgets/:budgetId', (req: Request, res: Response) => {
  try {
    const { budgetId } = req.params;
    const deleted = budgetService.deleteBudget(budgetId);

    if (!deleted) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json({ success: true, budgetId });
  } catch (error: any) {
    console.error('[CostAPI] Failed to delete budget:', error);
    res.status(500).json({
      error: 'Failed to delete budget',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/budgets/stats
 * Get budget statistics
 */
router.get('/budgets/stats', (req: Request, res: Response) => {
  try {
    const stats = budgetService.getBudgetStats();
    res.json(stats);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get budget stats:', error);
    res.status(500).json({
      error: 'Failed to retrieve budget statistics',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/budgets/at-risk
 * Get budgets at risk of exceeding
 */
router.get('/budgets/at-risk', (req: Request, res: Response) => {
  try {
    const budgets = budgetService.getAtRiskBudgets();
    res.json(budgets);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get at-risk budgets:', error);
    res.status(500).json({
      error: 'Failed to retrieve at-risk budgets',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/budget-alerts
 * Get budget alerts
 */
router.get('/budget-alerts', (req: Request, res: Response) => {
  try {
    const { budgetId, acknowledged } = req.query;

    const alerts = budgetService.getBudgetAlerts({
      budgetId: budgetId as string,
      acknowledged: acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined,
    });

    res.json(alerts);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get budget alerts:', error);
    res.status(500).json({
      error: 'Failed to retrieve budget alerts',
      message: error.message,
    });
  }
});

/**
 * POST /api/cost/budget-alerts/:alertId/acknowledge
 * Acknowledge a budget alert
 */
router.post('/budget-alerts/:alertId/acknowledge', (req: Request, res: Response) => {
  try {
    const { alertId } = req.params;
    const success = budgetService.acknowledgeBudgetAlert(alertId);

    if (!success) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ success: true, alertId });
  } catch (error: any) {
    console.error('[CostAPI] Failed to acknowledge alert:', error);
    res.status(500).json({
      error: 'Failed to acknowledge alert',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/dashboard
 * Get cost dashboard summary with top expensive resources
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const { profile } = req.query;

    if (!profile) {
      return res.status(400).json({
        error: 'profile is required',
      });
    }

    console.log(`[CostAPI] Getting dashboard summary for ${profile}`);

    // Collect all resources from cache across all regions
    const allResources: AWSResource[] = [];
    const allCacheKeys = Array.from(cacheService['cache'].keys());

    for (const key of allCacheKeys) {
      if (key.startsWith(`resources:${profile}:`)) {
        const inventory = cacheService.get<ResourceInventory>(key);
        if (inventory?.resources) {
          allResources.push(...inventory.resources);
        }
      }
    }

    console.log(`[CostAPI] Found ${allResources.length} resources for cost summary`);

    if (allResources.length === 0) {
      return res.json({
        totalCurrentMonth: 0,
        projectedMonthEnd: 0,
        topExpensiveResources: [],
        currency: 'USD',
      });
    }

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(profile as string, 'us-west-2');
    const summary = await costService.getCostDashboardSummary(profile as string, allResources);

    res.json(summary);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get dashboard summary:', error);
    res.status(500).json({
      error: 'Failed to retrieve cost dashboard summary',
      message: error.message,
    });
  }
});

/**
 * GET /api/cost/nat-breakdown
 * Get detailed NAT Gateway cost breakdown
 */
router.get('/nat-breakdown', async (req: Request, res: Response) => {
  try {
    const { profile } = req.query;

    if (!profile) {
      return res.status(400).json({
        error: 'profile is required',
      });
    }

    console.log(`[CostAPI] Getting NAT Gateway cost breakdown for ${profile}`);

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(profile as string, 'us-west-2');
    const breakdown = await costService.getNATGatewayCostBreakdown(profile as string);

    if (!breakdown) {
      return res.status(404).json({
        error: 'NAT Gateway cost data not available',
      });
    }

    res.json(breakdown);
  } catch (error: any) {
    console.error('[CostAPI] Failed to get NAT Gateway cost breakdown:', error);
    res.status(500).json({
      error: 'Failed to retrieve NAT Gateway cost breakdown',
      message: error.message,
    });
  }
});

/**
 * POST /api/cost/refresh
 * Manually refresh cost data for resources
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { profile } = req.body;

    if (!profile) {
      return res.status(400).json({
        error: 'profile is required',
      });
    }

    console.log(`[CostAPI] Refreshing cost data for ${profile}`);

    // Clear cost-related cache entries
    const allCacheKeys = Array.from(cacheService['cache'].keys());
    for (const key of allCacheKeys) {
      if (key.startsWith(`costs:${profile}`)) {
        cacheService.delete(key);
      }
    }

    // Collect resources and fetch fresh costs
    const allResources: AWSResource[] = [];
    const regions: string[] = [];

    for (const key of allCacheKeys) {
      if (key.startsWith(`resources:${profile}:`)) {
        const inventory = cacheService.get<ResourceInventory>(key);
        if (inventory?.resources) {
          allResources.push(...inventory.resources);
          if (inventory.region && !regions.includes(inventory.region)) {
            regions.push(inventory.region);
          }
        }
      }
    }

    if (allResources.length === 0) {
      return res.json({
        success: true,
        message: 'No resources found to refresh costs for',
        resourcesUpdated: 0,
      });
    }

    // Get cost service with shared ClaudeMCPService
    const costService = ServiceFactory.getCostAnalysisService(profile, 'us-west-2');

    // Fetch fresh costs
    const resourceCosts = await costService.getResourceCosts(profile, allResources);

    // Update cached resources with new cost data
    let updatedCount = 0;
    for (const key of allCacheKeys) {
      if (key.startsWith(`resources:${profile}:`)) {
        const inventory = cacheService.get<ResourceInventory>(key);
        if (inventory?.resources) {
          inventory.resources = inventory.resources.map(resource => {
            const cost = resourceCosts.get(resource.id);
            if (cost) {
              updatedCount++;
              return { ...resource, cost };
            }
            return resource;
          });
          cacheService.set(key, inventory, CacheService.TTL.RESOURCES);
        }
      }
    }

    res.json({
      success: true,
      message: 'Cost data refreshed successfully',
      resourcesUpdated: updatedCount,
      totalResources: allResources.length,
    });
  } catch (error: any) {
    console.error('[CostAPI] Failed to refresh costs:', error);
    res.status(500).json({
      error: 'Failed to refresh cost data',
      message: error.message,
    });
  }
});

export default router;
