import { OrganizationService } from './OrganizationService.js';
import { CacheService } from './CacheService.js';
import { ClaudeMCPService } from './ClaudeMCPService.js';
import type {
  AggregatedMetrics,
  AccountComparison,
  AccountBenchmark,
  AccountInfo,
} from '../types/organization.js';

export interface FederatedSearchRequest {
  query?: string;
  accountIds?: string[];
  resourceTypes?: string[];
  tags?: Record<string, string>;
  regions?: string[];
}

export interface FederatedSearchResult {
  resources: Array<{
    id: string;
    type: string;
    name: string;
    accountId: string;
    profile: string;
    region: string;
    tags?: Record<string, string>;
  }>;
  totalFound: number;
  searchedAccounts: number;
  executionTime: number;
}

export interface ChargebackAllocation {
  id: string;
  name: string;
  cost: number;
  percentage: number;
  accounts?: string[];
  tags?: Record<string, string>;
}

export interface ChargebackReport {
  id: string;
  title: string;
  period: {
    startDate: string;
    endDate: string;
  };
  allocationType: 'BY_ACCOUNT' | 'BY_TAG' | 'BY_TEAM';
  allocations: ChargebackAllocation[];
  totalCost: number;
  generatedAt: string;
}

export interface TrendDataPoint {
  date: string;
  value: number;
  accountId?: string;
}

export interface OrganizationTrends {
  costs: {
    daily: TrendDataPoint[];
    weekly: TrendDataPoint[];
    monthly: TrendDataPoint[];
  };
  resources: {
    daily: TrendDataPoint[];
    weekly: TrendDataPoint[];
  };
  security: {
    weekly: TrendDataPoint[];
    monthly: TrendDataPoint[];
  };
  compliance: {
    weekly: TrendDataPoint[];
    monthly: TrendDataPoint[];
  };
}

export class AggregationService {
  private orgService: OrganizationService;
  private cacheService: CacheService;
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor() {
    // OrganizationService requires a ClaudeMCPService but doesn't use it for account discovery
    // Using a placeholder instance for now
    const placeholderService = new ClaudeMCPService('default', 'us-west-2');
    this.orgService = new OrganizationService(placeholderService);
    this.cacheService = new CacheService();
  }

  /**
   * Aggregate metrics across all accounts
   */
  async aggregateMetrics(accountIds?: string[]): Promise<AggregatedMetrics> {
    const cacheKey = `aggregated-metrics:${accountIds?.join(',') || 'all'}`;
    const cached = this.cacheService.get<AggregatedMetrics>(cacheKey);
    if (cached) {
      return cached;
    }

    const accounts = accountIds
      ? accountIds.map((id) => this.orgService.getAccount(id)).filter((a): a is AccountInfo => a !== undefined)
      : this.orgService.getAllAccounts({ status: 'ACTIVE' });

    // Aggregate resources
    const resourcesByType: Record<string, number> = {};
    const resourcesByRegion: Record<string, number> = {};
    const resourcesByAccount: Record<string, number> = {};

    accounts.forEach((account) => {
      // Simulate resource counts (in real implementation, query actual resources)
      const resourceCount = Math.floor(Math.random() * 100) + 20;
      resourcesByAccount[account.accountId] = resourceCount;

      // By region
      resourcesByRegion[account.region] = (resourcesByRegion[account.region] || 0) + resourceCount;

      // By type (simulated)
      ['EC2', 'S3', 'RDS', 'Lambda', 'VPC'].forEach((type) => {
        const count = Math.floor(Math.random() * 20) + 5;
        resourcesByType[type] = (resourcesByType[type] || 0) + count;
      });
    });

    // Aggregate costs - load from persistent cache if available
    const costsByAccount: Record<string, number> = {};
    const costsByService: Record<string, number> = {};
    const costsByRegion: Record<string, number> = {};
    let totalPreviousMonthCost = 0;
    let trendFromCache = 'STABLE';
    let accountsWithCostData = 0;

    // Import persistent cache to get real cost data
    const { persistentCache } = await import('./PersistentCacheService.js');

    for (const account of accounts) {
      try {
        // Try to load cached cost data for this profile
        const costData = persistentCache.get<any>(`costs:${account.profile}`);
        const accountCost = costData?.totalCost || 0;
        const previousMonth = costData?.previousMonthCost || 0;

        costsByAccount[account.accountId] = accountCost;
        costsByRegion[account.region] = (costsByRegion[account.region] || 0) + accountCost;
        totalPreviousMonthCost += previousMonth;

        // Track accounts with cost data for trend calculation
        if (accountCost > 0 && previousMonth > 0) {
          accountsWithCostData++;
        }

        // Use trend from first account with cost data (or aggregate later)
        if (costData?.trend && accountsWithCostData === 1) {
          trendFromCache = costData.trend;
        }

        // Aggregate by service from cost data
        if (costData?.costByService) {
          Object.entries(costData.costByService).forEach(([service, cost]) => {
            costsByService[service] = (costsByService[service] || 0) + (cost as number);
          });
        }
      } catch (error) {
        console.warn(`[AggregationService] Failed to fetch costs for ${account.profile}:`, error);
        // Set to 0 if cost data unavailable
        costsByAccount[account.accountId] = 0;
      }
    }

    // Aggregate security - load from persistent cache
    const securityByAccount: Record<string, any> = {};
    let criticalFindings = 0;
    let highFindings = 0;
    let totalScore = 0;
    let accountsWithData = 0;

    for (const account of accounts) {
      try {
        // Try to load the latest audit job for this profile
        const latestAudit = persistentCache.get<any>(`audit-latest:${account.profile}`);

        if (latestAudit?.jobId) {
          const auditJob = persistentCache.get<any>(`audit-job:${account.profile}:${latestAudit.jobId}`);

          if (auditJob?.summary) {
            const score = auditJob.summary.score || 0;
            const critical = auditJob.summary.critical || 0;
            const high = auditJob.summary.high || 0;

            securityByAccount[account.accountId] = { score, critical, high };
            criticalFindings += critical;
            highFindings += high;
            totalScore += score;
            accountsWithData++;
          } else {
            // No audit data - set to 0
            securityByAccount[account.accountId] = { score: 0, critical: 0, high: 0 };
          }
        } else {
          // No audit data - set to 0
          securityByAccount[account.accountId] = { score: 0, critical: 0, high: 0 };
        }
      } catch (error) {
        console.warn(`[AggregationService] Failed to fetch security data for ${account.profile}:`, error);
        securityByAccount[account.accountId] = { score: 0, critical: 0, high: 0 };
      }
    }

    // Calculate average security score from accounts that have audit data
    const avgSecurityScore = accountsWithData > 0
      ? Math.floor(totalScore / accountsWithData)
      : 0;

    // Aggregate compliance
    const complianceByAccount: Record<string, any> = {};
    const frameworkScores: Record<string, number[]> = {
      CIS_AWS: [],
      NIST_800_53: [],
      ISO_27001: [],
    };

    accounts.forEach((account) => {
      const cisScore = Math.floor(Math.random() * 20) + 80;
      const nistScore = Math.floor(Math.random() * 20) + 80;
      const isoScore = Math.floor(Math.random() * 20) + 80;

      complianceByAccount[account.accountId] = {
        score: Math.floor((cisScore + nistScore + isoScore) / 3),
        compliant: Math.floor(Math.random() * 50) + 100,
        nonCompliant: Math.floor(Math.random() * 10),
      };

      frameworkScores.CIS_AWS.push(cisScore);
      frameworkScores.NIST_800_53.push(nistScore);
      frameworkScores.ISO_27001.push(isoScore);
    });

    const avgCompliance = Math.floor(
      Object.values(complianceByAccount).reduce((sum, c) => sum + c.score, 0) / accounts.length
    );

    const metrics: AggregatedMetrics = {
      organizationId: 'org-1',
      period: new Date().toISOString().substring(0, 7), // YYYY-MM
      generatedAt: new Date().toISOString(),

      resources: {
        total: Object.values(resourcesByAccount).reduce((sum, count) => sum + count, 0),
        byType: resourcesByType,
        byRegion: resourcesByRegion,
        byAccount: resourcesByAccount,
      },

      costs: {
        total: Object.values(costsByAccount).reduce((sum, cost) => sum + cost, 0),
        byAccount: costsByAccount,
        byService: costsByService,
        byRegion: costsByRegion,
        trend: (trendFromCache as 'INCREASING' | 'DECREASING' | 'STABLE'),
      },

      security: {
        overallScore: avgSecurityScore,
        criticalFindings,
        highFindings,
        byAccount: securityByAccount,
      },

      compliance: {
        overallScore: avgCompliance,
        byFramework: {
          CIS_AWS: Math.floor(frameworkScores.CIS_AWS.reduce((a, b) => a + b, 0) / frameworkScores.CIS_AWS.length),
          NIST_800_53: Math.floor(frameworkScores.NIST_800_53.reduce((a, b) => a + b, 0) / frameworkScores.NIST_800_53.length),
          ISO_27001: Math.floor(frameworkScores.ISO_27001.reduce((a, b) => a + b, 0) / frameworkScores.ISO_27001.length),
        },
        byAccount: complianceByAccount,
      },
    };

    this.cacheService.set(cacheKey, metrics, this.CACHE_TTL);
    return metrics;
  }

  /**
   * Compare multiple accounts
   */
  async compareAccounts(accountIds: string[]): Promise<AccountComparison> {
    const accounts = accountIds
      .map((id) => this.orgService.getAccount(id))
      .filter((a): a is AccountInfo => a !== undefined);

    const metrics = await this.aggregateMetrics(accountIds);

    const comparison: AccountComparison = {
      accounts: accounts.map((a) => ({
        accountId: a.accountId,
        profile: a.profile,
        name: a.name,
      })),

      metrics: {
        resources: accounts.map((a) => ({
          accountId: a.accountId,
          total: metrics.resources.byAccount[a.accountId] || 0,
          byType: metrics.resources.byType,
        })),

        costs: accounts.map((a) => ({
          accountId: a.accountId,
          total: metrics.costs.byAccount[a.accountId] || 0,
          trend: 'STABLE',
        })),

        security: accounts.map((a) => ({
          accountId: a.accountId,
          score: metrics.security.byAccount[a.accountId]?.score || 0,
          criticalFindings: metrics.security.byAccount[a.accountId]?.critical || 0,
        })),

        compliance: accounts.map((a) => ({
          accountId: a.accountId,
          score: metrics.compliance.byAccount[a.accountId]?.score || 0,
          frameworks: metrics.compliance.byFramework,
        })),
      },

      rankings: this.calculateRankings(accounts, metrics),
    };

    return comparison;
  }

  /**
   * Calculate account rankings
   */
  private calculateRankings(accounts: AccountInfo[], metrics: AggregatedMetrics): any {
    const costRanking = accounts.sort(
      (a, b) => (metrics.costs.byAccount[a.accountId] || 0) - (metrics.costs.byAccount[b.accountId] || 0)
    );

    const securityRanking = accounts.sort(
      (a, b) =>
        (metrics.security.byAccount[b.accountId]?.score || 0) -
        (metrics.security.byAccount[a.accountId]?.score || 0)
    );

    const complianceRanking = accounts.sort(
      (a, b) =>
        (metrics.compliance.byAccount[b.accountId]?.score || 0) -
        (metrics.compliance.byAccount[a.accountId]?.score || 0)
    );

    const resourceRanking = accounts.sort(
      (a, b) => (metrics.resources.byAccount[b.accountId] || 0) - (metrics.resources.byAccount[a.accountId] || 0)
    );

    return {
      lowestCost: costRanking[0]?.accountId,
      highestSecurity: securityRanking[0]?.accountId,
      highestCompliance: complianceRanking[0]?.accountId,
      mostResources: resourceRanking[0]?.accountId,
    };
  }

  /**
   * Benchmark an account against organization averages
   */
  async benchmarkAccount(accountId: string): Promise<AccountBenchmark> {
    const account = this.orgService.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const allMetrics = await this.aggregateMetrics();
    const accountMetrics = await this.aggregateMetrics([accountId]);

    const allAccounts = this.orgService.getAllAccounts({ status: 'ACTIVE' });

    // Calculate percentiles
    const costPercentile = this.calculatePercentile(
      allAccounts.map((a) => allMetrics.costs.byAccount[a.accountId] || 0),
      accountMetrics.costs.total
    );

    const securityPercentile = this.calculatePercentile(
      allAccounts.map((a) => allMetrics.security.byAccount[a.accountId]?.score || 0),
      accountMetrics.security.overallScore
    );

    const compliancePercentile = this.calculatePercentile(
      allAccounts.map((a) => allMetrics.compliance.byAccount[a.accountId]?.score || 0),
      accountMetrics.compliance.overallScore
    );

    const resourcePercentile = this.calculatePercentile(
      allAccounts.map((a) => allMetrics.resources.byAccount[a.accountId] || 0),
      accountMetrics.resources.total
    );

    // Calculate vs average
    const avgCost = allMetrics.costs.total / allAccounts.length;
    const avgSecurity = allMetrics.security.overallScore;
    const avgCompliance = allMetrics.compliance.overallScore;
    const avgResources = allMetrics.resources.total / allAccounts.length;

    const benchmark: AccountBenchmark = {
      accountId,
      profile: account.profile,

      percentile: {
        cost: costPercentile,
        security: securityPercentile,
        compliance: compliancePercentile,
        resources: resourcePercentile,
      },

      vsAverage: {
        cost: ((accountMetrics.costs.total - avgCost) / avgCost) * 100,
        security: ((accountMetrics.security.overallScore - avgSecurity) / avgSecurity) * 100,
        compliance: ((accountMetrics.compliance.overallScore - avgCompliance) / avgCompliance) * 100,
        resources: ((accountMetrics.resources.total - avgResources) / avgResources) * 100,
      },

      vsMedian: {
        cost: 0,
        security: 0,
        compliance: 0,
        resources: 0,
      },

      recommendations: this.generateRecommendations(accountMetrics, allMetrics),
    };

    return benchmark;
  }

  /**
   * Calculate percentile
   */
  private calculatePercentile(values: number[], target: number): number {
    const sorted = values.sort((a, b) => a - b);
    const index = sorted.findIndex((v) => v >= target);
    return index === -1 ? 100 : Math.floor((index / sorted.length) * 100);
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(accountMetrics: AggregatedMetrics, orgMetrics: AggregatedMetrics): string[] {
    const recommendations: string[] = [];

    if (accountMetrics.costs.total > orgMetrics.costs.total / this.orgService.getAllAccounts().length * 1.2) {
      recommendations.push('Consider rightsizing EC2 instances to reduce costs');
    }

    if (accountMetrics.security.overallScore < 70) {
      recommendations.push('Security score is below average, review security findings');
    } else if (accountMetrics.security.overallScore > 85) {
      recommendations.push('Security score is above average, maintain current practices');
    }

    if (accountMetrics.compliance.overallScore < 80) {
      recommendations.push('Enable additional compliance controls for CIS AWS');
    }

    return recommendations;
  }

  /**
   * Generate chargeback report
   */
  async generateChargebackReport(
    startDate: string,
    endDate: string,
    allocationType: 'BY_ACCOUNT' | 'BY_TAG' | 'BY_TEAM'
  ): Promise<ChargebackReport> {
    const metrics = await this.aggregateMetrics();

    const allocations: ChargebackAllocation[] = [];

    if (allocationType === 'BY_ACCOUNT') {
      const accounts = this.orgService.getAllAccounts({ status: 'ACTIVE' });
      accounts.forEach((account) => {
        const cost = metrics.costs.byAccount[account.accountId] || 0;
        allocations.push({
          id: account.accountId,
          name: account.name || account.profile,
          cost,
          percentage: (cost / metrics.costs.total) * 100,
          accounts: [account.accountId],
        });
      });
    } else if (allocationType === 'BY_TAG') {
      // Group by environment tag
      const groups = this.orgService.getAllGroups({ type: 'ENVIRONMENT' });
      groups.forEach((group) => {
        const groupAccounts = this.orgService.getAccountsInGroup(group.id);
        const cost = groupAccounts.reduce(
          (sum, acc) => sum + (metrics.costs.byAccount[acc.accountId] || 0),
          0
        );
        allocations.push({
          id: group.id,
          name: group.name,
          cost,
          percentage: (cost / metrics.costs.total) * 100,
          accounts: groupAccounts.map((a) => a.accountId),
          tags: group.tags,
        });
      });
    }

    return {
      id: `chargeback-${Date.now()}`,
      title: `Chargeback Report - ${allocationType}`,
      period: { startDate, endDate },
      allocationType,
      allocations: allocations.sort((a, b) => b.cost - a.cost),
      totalCost: metrics.costs.total,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Search resources across accounts
   */
  async searchResources(request: FederatedSearchRequest): Promise<FederatedSearchResult> {
    const startTime = Date.now();

    const accounts = request.accountIds
      ? request.accountIds.map((id) => this.orgService.getAccount(id)).filter((a): a is AccountInfo => a !== undefined)
      : this.orgService.getAllAccounts({ status: 'ACTIVE' });

    // Simulate federated search (in real implementation, query actual resources)
    const resources: FederatedSearchResult['resources'] = [];

    accounts.forEach((account) => {
      const resourceCount = Math.floor(Math.random() * 10) + 1;
      for (let i = 0; i < resourceCount; i++) {
        const types = request.resourceTypes || ['EC2', 'S3', 'RDS', 'Lambda', 'VPC'];
        const type = types[Math.floor(Math.random() * types.length)];

        resources.push({
          id: `${type.toLowerCase()}-${Math.random().toString(36).substring(7)}`,
          type,
          name: `${type}-${account.profile}-${i}`,
          accountId: account.accountId,
          profile: account.profile,
          region: account.region,
          tags: account.tags,
        });
      }
    });

    // Filter by query
    let filteredResources = resources;
    if (request.query) {
      const query = request.query.toLowerCase();
      filteredResources = resources.filter(
        (r) => r.name.toLowerCase().includes(query) || r.id.toLowerCase().includes(query)
      );
    }

    const executionTime = Date.now() - startTime;

    return {
      resources: filteredResources,
      totalFound: filteredResources.length,
      searchedAccounts: accounts.length,
      executionTime,
    };
  }

  /**
   * Get organization trends
   */
  async getOrganizationTrends(): Promise<OrganizationTrends> {
    // Simulate trend data (in real implementation, query historical data)
    const now = new Date();
    const dailyPoints: TrendDataPoint[] = [];
    const weeklyPoints: TrendDataPoint[] = [];
    const monthlyPoints: TrendDataPoint[] = [];

    // Generate daily trend data (last 30 days)
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      dailyPoints.push({
        date: date.toISOString().substring(0, 10),
        value: Math.random() * 1000 + 5000,
      });
    }

    // Generate weekly trend data (last 12 weeks)
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i * 7);
      weeklyPoints.push({
        date: date.toISOString().substring(0, 10),
        value: Math.random() * 7000 + 30000,
      });
    }

    // Generate monthly trend data (last 12 months)
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now);
      date.setMonth(date.getMonth() - i);
      monthlyPoints.push({
        date: date.toISOString().substring(0, 7),
        value: Math.random() * 30000 + 120000,
      });
    }

    return {
      costs: {
        daily: dailyPoints,
        weekly: weeklyPoints,
        monthly: monthlyPoints,
      },
      resources: {
        daily: dailyPoints.map((p) => ({ ...p, value: Math.floor(Math.random() * 100) + 1000 })),
        weekly: weeklyPoints.map((p) => ({ ...p, value: Math.floor(Math.random() * 500) + 5000 })),
      },
      security: {
        weekly: weeklyPoints.map((p) => ({ ...p, value: Math.floor(Math.random() * 20) + 70 })),
        monthly: monthlyPoints.map((p) => ({ ...p, value: Math.floor(Math.random() * 20) + 70 })),
      },
      compliance: {
        weekly: weeklyPoints.map((p) => ({ ...p, value: Math.floor(Math.random() * 15) + 75 })),
        monthly: monthlyPoints.map((p) => ({ ...p, value: Math.floor(Math.random() * 15) + 75 })),
      },
    };
  }
}
