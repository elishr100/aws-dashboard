import { ClaudeMCPService } from './ClaudeMCPService.js';
import type {
  CostSummary,
  CostTrend,
  CostByService,
  CostByRegion,
  CostAnomaly,
  CostOptimizationRecommendation,
  CostReport,
  CostQuery,
  CostForecast,
  CostDataPoint,
  ResourceCostData,
  CostDashboardSummary,
} from '../types/cost.js';
import type { AWSResource, ResourceCost } from '../types/index.js';

export class CostAnalysisService {
  private claudeService: ClaudeMCPService;
  private anomalies: Map<string, CostAnomaly> = new Map();
  private recommendations: Map<string, CostOptimizationRecommendation> = new Map();

  /**
   * Constructor with dependency injection for ClaudeMCPService
   * This ensures a single shared instance with synchronized credentials
   */
  constructor(claudeService: ClaudeMCPService) {
    this.claudeService = claudeService;
    console.log(`[CostAnalysis] Initialized with shared ClaudeMCPService instance`);
  }

  /**
   * Format date as YYYY-MM-DD without timezone conversion
   * Prevents timezone bugs where dates shift when converting to UTC
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Get comprehensive cost report
   */
  async getCostReport(query: CostQuery): Promise<CostReport> {
    console.log(`[CostAnalysis] Generating cost report for ${query.profile}`);

    this.claudeService.setProfile(query.profile);

    const [summary, byService, byRegion, trends, anomalies, recommendations] = await Promise.all([
      this.getCostSummary(query.profile, query.startDate, query.endDate),
      this.getCostByService(query.profile, query.startDate, query.endDate),
      this.getCostByRegion(query.profile, query.startDate, query.endDate),
      this.getCostTrends(query.profile, query.startDate, query.endDate),
      this.detectCostAnomalies(query.profile, query.startDate, query.endDate),
      this.generateOptimizationRecommendations(query.profile),
    ]);

    return {
      reportId: `report-${Date.now()}`,
      profile: query.profile,
      startDate: query.startDate,
      endDate: query.endDate,
      summary,
      byService,
      byRegion,
      trends,
      anomalies,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get cost summary for a profile
   */
  async getCostSummary(profile: string, startDate: string, endDate: string): Promise<CostSummary> {
    try {
      // Calculate dates dynamically from current date
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const today = this.formatDate(now);

      const currentMonthStartStr = this.formatDate(currentMonthStart);
      const previousMonthStartStr = this.formatDate(previousMonthStart);
      const previousMonthEndStr = this.formatDate(previousMonthEnd);

      const prompt = `Using AWS Cost Explorer via MCP tools, get cost summary for profile ${profile}.

CRITICAL INSTRUCTIONS - DO NOT DEVIATE:
1. Cost Explorer is GLOBAL - it returns costs for ALL regions combined
2. DO NOT filter by region
3. DO NOT group by region
4. DO NOT query multiple regions separately and sum them
5. The --region us-east-1 flag is ONLY the API endpoint, NOT a cost filter

Execute these EXACT AWS CLI commands:

**Current month cost (${currentMonthStartStr} to ${today}):**
aws ce get-cost-and-usage \\
  --time-period Start=${currentMonthStartStr},End=${today} \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --profile ${profile} \\
  --region us-east-1 \\
  --output json

**Previous month cost (${previousMonthStartStr} to ${previousMonthEndStr}):**
aws ce get-cost-and-usage \\
  --time-period Start=${previousMonthStartStr},End=${previousMonthEndStr} \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --profile ${profile} \\
  --region us-east-1 \\
  --output json

Extract the cost from ResultsByTime[0].Total.BlendedCost.Amount from EACH command.
DO NOT sum across regions - the result is already the total for all regions.

Return JSON:
{
  "currentMonth": 1234.56,
  "previousMonth": 1100.00,
  "monthToDate": 1234.56,
  "forecastedMonth": 1300.00,
  "currency": "USD"
}

If you get an AccessDenied error or lack of ce:GetCostAndUsage permission, return:
{
  "error": "NO_COST_ACCESS",
  "message": "Cost Explorer access is not available for this account. IAM role requires ce:GetCostAndUsage permission."
}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied:', data.message);
        return {
          currentMonth: 0,
          previousMonth: 0,
          monthToDate: 0,
          forecastedMonth: 0,
          currency: 'USD',
          trend: 'UNAVAILABLE' as any,
          changePercentage: 0,
          error: data.message,
        };
      }

      if (data) {
        const changePercentage = ((data.currentMonth - data.previousMonth) / data.previousMonth) * 100;
        const trend =
          changePercentage > 5
            ? 'INCREASING'
            : changePercentage < -5
            ? 'DECREASING'
            : 'STABLE';

        return {
          currentMonth: data.currentMonth || 0,
          previousMonth: data.previousMonth || 0,
          monthToDate: data.monthToDate || 0,
          forecastedMonth: data.forecastedMonth || 0,
          currency: data.currency || 'USD',
          trend,
          changePercentage: Math.abs(changePercentage),
        };
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get cost summary:', error.message);
    }

    // Return default data if query fails
    return {
      currentMonth: 0,
      previousMonth: 0,
      monthToDate: 0,
      forecastedMonth: 0,
      currency: 'USD',
      trend: 'STABLE',
      changePercentage: 0,
    };
  }

  /**
   * Get cost breakdown by service
   * IMPORTANT: Returns ALL services with cost > $0, sorted by cost descending
   */
  async getCostByService(profile: string, startDate: string, endDate: string): Promise<CostByService[]> {
    try {
      // Use provided dates or calculate from current date
      const now = new Date();
      const actualStartDate = startDate || this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const actualEndDate = endDate || this.formatDate(now);

      const prompt = `Using AWS Cost Explorer via the call_aws MCP tool, get cost breakdown by service for profile ${profile}.

CRITICAL INSTRUCTIONS:
1. Execute this exact AWS CLI command:
   aws ce get-cost-and-usage \\
     --time-period Start=${actualStartDate},End=${actualEndDate} \\
     --granularity DAILY \\
     --metrics UnblendedCost \\
     --group-by Type=DIMENSION,Key=SERVICE \\
     --region us-east-1

2. Parse the response and aggregate costs across all days for each service
3. Include EVERY service that has cost > $0
4. DO NOT filter or limit services - return ALL services
5. Sort services by cost descending (highest cost first)

Return ONLY this JSON structure (no markdown, no explanations):
{
  "services": [
    {"service": "Amazon Virtual Private Cloud", "amount": 41.07},
    {"service": "Claude Sonnet 4.5 (Amazon Bedrock Edition)", "amount": 26.94},
    {"service": "AmazonCloudWatch", "amount": 4.48},
    {"service": "Amazon Elastic Load Balancing", "amount": 4.13}
  ],
  "total": 76.62,
  "currency": "USD"
}

IMPORTANT: If Bedrock is present in the results, use its EXACT name from AWS (e.g., "Claude Sonnet 4.5 (Amazon Bedrock Edition)" or "Amazon Bedrock").

If you get an AccessDenied error or ce:GetCostAndUsage permission is missing, return:
{"error": "NO_COST_ACCESS", "services": []}`;

      const response = await this.claudeService.query(prompt, 120000); // 2 minute timeout
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for service breakdown');
        return [];
      }

      if (data?.services && Array.isArray(data.services)) {
        const total = data.total || data.services.reduce((sum: number, s: any) => sum + s.amount, 0);

        // Sort services by cost descending
        const sortedServices = data.services
          .filter((s: any) => s.amount > 0) // Only services with cost > $0
          .sort((a: any, b: any) => b.amount - a.amount);

        const services = sortedServices.map((service: any) => ({
          service: service.service,
          amount: service.amount,
          percentage: total > 0 ? (service.amount / total) * 100 : 0,
          currency: data.currency || 'USD',
        }));

        console.log(`[CostAnalysis] Found ${services.length} services with costs > $0`);
        console.log(`[CostAnalysis] Top 5 services:`, services.slice(0, 5).map(s => `${s.service}: $${s.amount.toFixed(2)}`).join(', '));

        // Check if Bedrock is present
        const bedrockService = services.find((s: any) =>
          s.service.toLowerCase().includes('bedrock')
        );

        if (!bedrockService || bedrockService.amount === 0) {
          console.log('[CostAnalysis] Bedrock cost is $0 or missing - may be billed to payer account');
          const payerInfo = await this.getPayerAccountInfo(profile);
          if (payerInfo) {
            console.log(`[CostAnalysis] Payer account detected: ${payerInfo.id} (${payerInfo.email})`);
          }
        } else {
          console.log(`[CostAnalysis] Bedrock cost found: $${bedrockService.amount.toFixed(2)} (${bedrockService.service})`);
        }

        return services;
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get cost by service:', error.message);
    }

    return [];
  }

  /**
   * Get AWS Organizations payer account information
   */
  async getPayerAccountInfo(profile: string): Promise<{ id: string; email?: string } | null> {
    try {
      const prompt = `Using AWS Organizations via MCP tools, get the payer account information for profile ${profile}.

Execute this AWS CLI command:
aws organizations describe-organization --region us-east-1

Return JSON with the master/management account ID and email:
{
  "id": "123456789012",
  "email": "aws+master@example.com"
}

If Organizations is not enabled or you get an AccessDenied error, return:
{"error": "NO_ORG_ACCESS"}`;

      const response = await this.claudeService.query(prompt, 30000); // 30 second timeout
      const data = this.extractJSON(response.content);

      if (data?.error === 'NO_ORG_ACCESS') {
        console.log('[CostAnalysis] AWS Organizations not accessible');
        return null;
      }

      if (data?.id) {
        return {
          id: data.id,
          email: data.email,
        };
      }
    } catch (error: any) {
      console.warn('[CostAnalysis] Failed to get payer account info (non-fatal):', error.message);
    }

    return null;
  }

  /**
   * Get cost breakdown by region
   */
  async getCostByRegion(profile: string, startDate: string, endDate: string): Promise<CostByRegion[]> {
    try {
      // Use provided dates or calculate from current date
      const now = new Date();
      const actualStartDate = startDate || this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const actualEndDate = endDate || this.formatDate(now);

      const prompt = `Using AWS Cost Explorer, get cost breakdown by region for ${profile}.

Use these exact dates:
- Start date: ${actualStartDate}
- End date: ${actualEndDate}

Return JSON:
{
  "regions": [
    {"region": "us-west-2", "amount": 500.00},
    {"region": "us-east-1", "amount": 300.00},
    {"region": "eu-west-1", "amount": 150.00}
  ],
  "total": 950.00,
  "currency": "USD"
}

If you get an AccessDenied error, return:
{"error": "NO_COST_ACCESS", "regions": []}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for region breakdown');
        return [];
      }

      if (data?.regions) {
        const total = data.total || data.regions.reduce((sum: number, r: any) => sum + r.amount, 0);
        return data.regions.map((region: any) => ({
          region: region.region,
          amount: region.amount,
          percentage: (region.amount / total) * 100,
          currency: data.currency || 'USD',
        }));
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get cost by region:', error.message);
    }

    return [];
  }

  /**
   * Get cost trends over time
   */
  async getCostTrends(profile: string, startDate: string, endDate: string): Promise<CostTrend> {
    try {
      // Use provided dates or calculate from current date
      const now = new Date();
      const actualStartDate = startDate || this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const actualEndDate = endDate || this.formatDate(now);

      const prompt = `Using AWS Cost Explorer, get daily cost data for ${profile}.

Use these exact dates:
- Start date: ${actualStartDate}
- End date: ${actualEndDate}

Example (use actual current dates, not this hardcoded example):
Return JSON:
{
  "data": [
    {"date": "2026-03-01", "amount": 50.00},
    {"date": "2026-03-02", "amount": 52.00},
    {"date": "2026-03-03", "amount": 48.00}
  ],
  "currency": "USD"
}

If you get an AccessDenied error, return:
{"error": "NO_COST_ACCESS", "data": []}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for trends');
        return {
          period: 'DAILY',
          data: [],
          total: 0,
          average: 0,
          currency: 'USD',
        };
      }

      if (data?.data) {
        const dataPoints: CostDataPoint[] = data.data.map((d: any) => ({
          date: d.date,
          amount: d.amount,
          currency: data.currency || 'USD',
        }));

        const total = dataPoints.reduce((sum, d) => sum + d.amount, 0);
        const average = total / dataPoints.length;

        return {
          period: 'DAILY',
          data: dataPoints,
          total,
          average,
          currency: data.currency || 'USD',
        };
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get cost trends:', error.message);
    }

    return {
      period: 'DAILY',
      data: [],
      total: 0,
      average: 0,
      currency: 'USD',
    };
  }

  /**
   * Detect cost anomalies
   */
  async detectCostAnomalies(profile: string, startDate: string, endDate: string): Promise<CostAnomaly[]> {
    try {
      // Use provided dates or calculate from current date
      const now = new Date();
      const actualStartDate = startDate || this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const actualEndDate = endDate || this.formatDate(now);

      const prompt = `Using AWS Cost Explorer, detect cost anomalies for ${profile}.

Use these exact dates:
- Start date: ${actualStartDate}
- End date: ${actualEndDate}

Look for:
1. Unexpected spikes in spending
2. Services with unusual cost increases
3. Days with significantly higher than average costs

Return JSON (use actual current dates in the anomalies):
{
  "anomalies": [
    {
      "date": "2026-03-02",
      "service": "Amazon EC2",
      "expectedAmount": 50.00,
      "actualAmount": 150.00,
      "deviation": 200
    }
  ]
}

If you get an AccessDenied error, return:
{"error": "NO_COST_ACCESS", "anomalies": []}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for anomaly detection');
        return [];
      }

      if (data?.anomalies) {
        const anomalies: CostAnomaly[] = data.anomalies.map((a: any) => {
          const severity =
            a.deviation > 100
              ? 'CRITICAL'
              : a.deviation > 50
              ? 'HIGH'
              : a.deviation > 20
              ? 'MEDIUM'
              : 'LOW';

          const anomaly: CostAnomaly = {
            id: `anomaly-${Date.now()}-${a.date}-${a.service}`,
            date: a.date,
            service: a.service,
            expectedAmount: a.expectedAmount,
            actualAmount: a.actualAmount,
            deviation: a.deviation,
            severity,
            description: `${a.service} cost increased by ${a.deviation}% on ${a.date}`,
            detectedAt: new Date().toISOString(),
          };

          this.anomalies.set(anomaly.id, anomaly);
          return anomaly;
        });

        return anomalies;
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to detect anomalies:', error.message);
    }

    return [];
  }

  /**
   * Generate cost optimization recommendations
   */
  async generateOptimizationRecommendations(profile: string): Promise<CostOptimizationRecommendation[]> {
    try {
      const prompt = `Using AWS Cost Explorer and resource data, generate cost optimization recommendations for ${profile}.
Look for:
1. Underutilized EC2 instances (right-sizing opportunities)
2. Unattached EBS volumes
3. Old snapshots that can be deleted
4. Reserved Instance opportunities
5. S3 storage class optimization

Return JSON:
{
  "recommendations": [
    {
      "type": "RIGHTSIZING",
      "service": "EC2",
      "region": "us-west-2",
      "resourceId": "i-1234567890",
      "currentCost": 100.00,
      "potentialSavings": 30.00,
      "title": "Rightsize EC2 Instance",
      "description": "Instance is consistently underutilized",
      "recommendation": "Downgrade from t3.large to t3.medium",
      "implementationEffort": "LOW"
    }
  ]
}

If you get an AccessDenied error or cannot access cost data, return:
{"error": "NO_COST_ACCESS", "recommendations": []}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for recommendations');
        return [];
      }

      if (data?.recommendations) {
        const recommendations: CostOptimizationRecommendation[] = data.recommendations.map((r: any) => {
          const savingsPercentage = (r.potentialSavings / r.currentCost) * 100;
          const severity = savingsPercentage > 30 ? 'HIGH' : savingsPercentage > 15 ? 'MEDIUM' : 'LOW';

          const recommendation: CostOptimizationRecommendation = {
            id: `rec-${Date.now()}-${r.resourceId || r.service}`,
            type: r.type,
            severity,
            resourceId: r.resourceId,
            resourceType: r.service,
            service: r.service,
            region: r.region,
            profile,
            title: r.title,
            description: r.description,
            currentCost: r.currentCost,
            potentialSavings: r.potentialSavings,
            savingsPercentage,
            recommendation: r.recommendation,
            implementationEffort: r.implementationEffort || 'MEDIUM',
            currency: 'USD',
            detectedAt: new Date().toISOString(),
          };

          this.recommendations.set(recommendation.id, recommendation);
          return recommendation;
        });

        return recommendations;
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to generate recommendations:', error.message);
    }

    return [];
  }

  /**
   * Get cost forecast
   */
  async getCostForecast(profile: string, days: number = 30): Promise<CostForecast[]> {
    try {
      const now = new Date();
      const startDate = this.formatDate(now);
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + days);
      const endDateStr = this.formatDate(endDate);

      const prompt = `Using AWS Cost Explorer forecasting, predict costs for ${profile} for the next ${days} days.

Use these exact dates:
- Start date (today): ${startDate}
- End date (forecast to): ${endDateStr}

Return JSON (use actual future dates based on current date):
{
  "forecast": [
    {
      "date": "2026-03-04",
      "predictedAmount": 50.00,
      "upperBound": 60.00,
      "lowerBound": 40.00,
      "confidence": 85
    }
  ],
  "currency": "USD"
}

If you get an AccessDenied error, return:
{"error": "NO_COST_ACCESS", "forecast": []}`;

      const response = await this.claudeService.query(prompt);
      const data = this.extractJSON(response.content);

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for forecast');
        return [];
      }

      if (data?.forecast) {
        return data.forecast.map((f: any) => ({
          date: f.date,
          predictedAmount: f.predictedAmount,
          upperBound: f.upperBound,
          lowerBound: f.lowerBound,
          confidence: f.confidence,
          currency: data.currency || 'USD',
        }));
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get forecast:', error.message);
    }

    return [];
  }

  /**
   * Get all anomalies
   */
  getAnomalies(): CostAnomaly[] {
    return Array.from(this.anomalies.values());
  }

  /**
   * Get all recommendations
   */
  getRecommendations(filters?: { severity?: string; type?: string }): CostOptimizationRecommendation[] {
    let recommendations = Array.from(this.recommendations.values());

    if (filters?.severity) {
      recommendations = recommendations.filter((r) => r.severity === filters.severity);
    }
    if (filters?.type) {
      recommendations = recommendations.filter((r) => r.type === filters.type);
    }

    return recommendations;
  }

  /**
   * Get costs for individual resources
   */
  async getResourceCosts(profile: string, resources: AWSResource[]): Promise<Map<string, ResourceCost>> {
    console.log(`[CostAnalysis] Fetching resource costs for ${resources.length} resources`);

    const costMap = new Map<string, ResourceCost>();

    try {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthStartStr = this.formatDate(currentMonthStart);
      const todayStr = this.formatDate(now);

      // Get last 3 complete months for average
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const threeMonthsAgoStr = this.formatDate(threeMonthsAgo);
      const lastMonthEndStr = this.formatDate(lastMonthEnd);

      const prompt = `Using AWS Cost Explorer via the call_aws MCP tool, get service-level costs for profile ${profile}.

IMPORTANT DATE CONTEXT:
- Today's date: ${todayStr}
- Current month start: ${currentMonthStart.getFullYear()}-${String(currentMonthStart.getMonth() + 1).padStart(2, '0')}-01
- Use these exact calculated dates for Cost Explorer queries

Execute these two AWS CLI commands:

1. Current month costs (${currentMonthStartStr} to ${todayStr}):
aws ce get-cost-and-usage \\
  --time-period Start=${currentMonthStartStr},End=${todayStr} \\
  --granularity MONTHLY \\
  --metrics UnblendedCost \\
  --group-by Type=DIMENSION,Key=SERVICE \\
  --region us-east-1

2. Last 3 months average (${threeMonthsAgoStr} to ${lastMonthEndStr}):
aws ce get-cost-and-usage \\
  --time-period Start=${threeMonthsAgoStr},End=${lastMonthEndStr} \\
  --granularity MONTHLY \\
  --metrics UnblendedCost \\
  --group-by Type=DIMENSION,Key=SERVICE \\
  --region us-east-1

IMPORTANT ERROR HANDLING:
If you get an AccessDenied error or ce:GetCostAndUsage permission is missing, return:
{
  "error": "NO_COST_ACCESS",
  "message": "Cost data is not available for this account - billing/Cost Explorer access required (ce:GetCostAndUsage permission).",
  "costs": []
}

After running both commands successfully, analyze the results and map AWS service names to these resource types:
- "Amazon Elastic Compute Cloud - Compute" -> EC2
- "Amazon Simple Storage Service" -> S3
- "Amazon Relational Database Service" -> RDS
- "AWS Lambda" -> Lambda
- "Elastic Load Balancing" or "Amazon Elastic Load Balancing" -> ELB
- "Amazon Virtual Private Cloud" or "VPC" -> Split into NAT and VPC based on usage type
  * If usage type contains "NatGateway" -> NAT
  * Otherwise -> VPC
- "Amazon EC2 Container Service" -> ECS

CRITICAL: For "Amazon Virtual Private Cloud" service, you MUST query the cost breakdown by usage type:
aws ce get-cost-and-usage \\
  --time-period Start=${currentMonthStartStr},End=${todayStr} \\
  --granularity MONTHLY \\
  --metrics UnblendedCost \\
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Virtual Private Cloud"]}}' \\
  --group-by Type=DIMENSION,Key=USAGE_TYPE \\
  --region us-east-1

Then separate NAT Gateway costs (usage types containing "NatGateway") from other VPC costs.

Resource types in this account: ${[...new Set(resources.map(r => r.type))].join(', ')}

Calculate the average monthly cost from the 3-month data by dividing total by 3.
Return ONLY valid JSON with this exact structure (no markdown, no explanations):
{
  "costs": [
    {
      "resourceType": "EC2",
      "currentMonthCost": 50.00,
      "avgMonthlyCost": 45.00
    },
    {
      "resourceType": "S3",
      "currentMonthCost": 30.00,
      "avgMonthlyCost": 28.00
    }
  ],
  "currency": "USD"
}`;

      console.log(`[CostAnalysis] Sending Cost Explorer query to Claude...`);
      const response = await this.claudeService.query(prompt, 120000); // 2 minute timeout
      console.log(`[CostAnalysis] Received Cost Explorer response, length: ${response.content.length}`);

      const data = this.extractJSON(response.content);

      if (!data) {
        console.warn(`[CostAnalysis] Failed to extract JSON from Cost Explorer response`);
        return costMap;
      }

      // Handle AccessDenied case
      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied:', data.message || 'No permission to access billing data');
        console.warn('[CostAnalysis] Cost data will not be available for resources');
        return costMap; // Return empty map - costs will be absent from resources
      }

      console.log(`[CostAnalysis] Extracted cost data:`, JSON.stringify(data, null, 2).substring(0, 500));

      if (data?.costs && Array.isArray(data.costs)) {
        console.log(`[CostAnalysis] Processing ${data.costs.length} cost entries`);

        // Build service cost map
        const serviceCostMap = new Map<string, { current: number; avg: number; total: number }>();
        for (const costItem of data.costs) {
          console.log(`[CostAnalysis] Mapping cost: ${costItem.resourceType}, current: $${costItem.currentMonthCost}, avg: $${costItem.avgMonthlyCost}`);
          serviceCostMap.set(costItem.resourceType, {
            current: costItem.currentMonthCost || 0,
            avg: costItem.avgMonthlyCost || 0,
            total: costItem.serviceTotal || 1,
          });
        }

        // Distribute costs to resources proportionally by service
        const resourceCountByType = new Map<string, number>();
        resources.forEach(r => {
          resourceCountByType.set(r.type, (resourceCountByType.get(r.type) || 0) + 1);
        });

        console.log(`[CostAnalysis] Resource counts:`, Object.fromEntries(resourceCountByType));

        // Assign costs to each resource
        let assignedCount = 0;
        for (const resource of resources) {
          const serviceCost = serviceCostMap.get(resource.type);

          if (serviceCost) {
            const resourceCount = resourceCountByType.get(resource.type) || 1;
            const perResourceCurrentCost = serviceCost.current / resourceCount;
            const perResourceAvgCost = serviceCost.avg / resourceCount;

            if (perResourceCurrentCost > 0 || perResourceAvgCost > 0) {
              costMap.set(resource.id, {
                currentMonthCost: perResourceCurrentCost,
                avgMonthlyCost: perResourceAvgCost,
                currency: data.currency || 'USD',
                lastUpdated: new Date().toISOString(),
              });
              assignedCount++;
            }
          }
        }

        console.log(`[CostAnalysis] Successfully mapped costs for ${costMap.size} resources (assigned to ${assignedCount} resources)`);
      } else {
        console.warn(`[CostAnalysis] No costs array found in response`);
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get resource costs (non-fatal):', error.message);
      // Return empty map instead of throwing - costs are optional
    }

    return costMap;
  }

  /**
   * Get average cost for last 3 months
   */
  async getAverageLast3MonthsCost(profile: string): Promise<number> {
    try {
      const now = new Date();
      // Get start of 3 months ago
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      // Get end of last month (not current month)
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const startDate = this.formatDate(threeMonthsAgo);
      const endDate = this.formatDate(lastMonthEnd);

      const prompt = `Using AWS Cost Explorer via MCP tools, get total cost for the last 3 complete months for profile ${profile}.

IMPORTANT: Use these exact date ranges:
- Start date: ${startDate} (3 months ago)
- End date: ${endDate} (end of last month)

Execute this AWS CLI command:
aws ce get-cost-and-usage \\
  --time-period Start=${startDate},End=${endDate} \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --region us-east-1

Sum up the costs for all 3 months and divide by 3 to get the average.

Return JSON:
{
  "averageMonthlyCost": 1234.56,
  "totalCost": 3703.68,
  "months": 3,
  "currency": "USD"
}

If you get an AccessDenied error or lack of ce:GetCostAndUsage permission, return:
{
  "error": "NO_COST_ACCESS",
  "averageMonthlyCost": 0
}`;

      const response = await this.claudeService.query(prompt, 60000);
      const data = this.extractJSON(response.content);

      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] Cost Explorer access denied for average 3-month cost');
        return 0;
      }

      if (data?.averageMonthlyCost !== undefined) {
        console.log(`[CostAnalysis] Average last 3 months cost: $${data.averageMonthlyCost.toFixed(2)}`);
        return data.averageMonthlyCost;
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get average last 3 months cost:', error.message);
    }

    return 0;
  }

  /**
   * Get cost dashboard summary
   */
  async getCostDashboardSummary(profile: string, resources: AWSResource[]): Promise<CostDashboardSummary> {
    console.log(`[CostAnalysis] Generating cost dashboard summary for ${profile}`);

    try {
      // Calculate total current month spend from resources
      let totalCurrentMonth = 0;
      const resourcesWithCost: Array<{
        resourceId: string;
        resourceType: string;
        resourceName?: string;
        cost: number;
      }> = [];

      for (const resource of resources) {
        if (resource.cost?.currentMonthCost) {
          totalCurrentMonth += resource.cost.currentMonthCost;
          resourcesWithCost.push({
            resourceId: resource.id,
            resourceType: resource.type,
            resourceName: resource.name,
            cost: resource.cost.currentMonthCost,
          });
        }
      }

      // Sort by cost descending and take top 5
      resourcesWithCost.sort((a, b) => b.cost - a.cost);
      const topExpensiveResources = resourcesWithCost.slice(0, 5);

      // Calculate projected month-end cost
      const now = new Date();
      const daysElapsed = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const projectedMonthEnd = (totalCurrentMonth / daysElapsed) * daysInMonth;

      // Get average last 3 months cost
      const averageLast3Months = await this.getAverageLast3MonthsCost(profile);

      console.log(`[CostAnalysis] Total current month: $${totalCurrentMonth.toFixed(2)}, Projected: $${projectedMonthEnd.toFixed(2)}, Avg 3 months: $${averageLast3Months.toFixed(2)}`);

      // Check for Bedrock costs and add note if missing
      const bedrockNote = await this.checkBedrockBilling(profile);

      return {
        totalCurrentMonth,
        projectedMonthEnd,
        averageLast3Months,
        topExpensiveResources,
        currency: 'USD',
        notes: bedrockNote ? [bedrockNote] : undefined,
      };
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to generate dashboard summary:', error.message);
      return {
        totalCurrentMonth: 0,
        projectedMonthEnd: 0,
        averageLast3Months: 0,
        topExpensiveResources: [],
        currency: 'USD',
      };
    }
  }

  /**
   * Check if Bedrock costs are present, and if not, add a note about payer account billing
   */
  async checkBedrockBilling(profile: string): Promise<string | null> {
    try {
      const now = new Date();
      const startDate = this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const endDate = this.formatDate(now);

      const prompt = `Using AWS Cost Explorer, check if there are any Bedrock costs for profile ${profile}.

Execute this AWS CLI command:
aws ce get-cost-and-usage \\
  --time-period Start=${startDate},End=${endDate} \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --group-by Type=DIMENSION,Key=SERVICE \\
  --region us-east-1

Look for "Amazon Bedrock" or any service with "Bedrock" in the name.

Return JSON:
{
  "bedrockCost": 123.45
}

If Bedrock cost is $0 or missing, return:
{
  "bedrockCost": 0
}

If AccessDenied, return:
{"error": "NO_COST_ACCESS"}`;

      const response = await this.claudeService.query(prompt, 30000);
      const data = this.extractJSON(response.content);

      if (data?.error === 'NO_COST_ACCESS') {
        return null;
      }

      if (data && (data.bedrockCost === 0 || data.bedrockCost === undefined)) {
        // Bedrock cost is $0, check for payer account
        const payerInfo = await this.getPayerAccountInfo(profile);

        if (payerInfo) {
          return `⚠️ Bedrock costs ($0 in this account) may be billed to the organization payer account: ${payerInfo.id}${payerInfo.email ? ` (${payerInfo.email})` : ''}`;
        } else {
          return `⚠️ Bedrock costs ($0 in this account) may be billed to the organization payer/management account. Check the billing account for actual Bedrock usage.`;
        }
      }
    } catch (error: any) {
      console.warn('[CostAnalysis] Failed to check Bedrock billing (non-fatal):', error.message);
    }

    return null;
  }

  /**
   * Get detailed NAT Gateway cost breakdown
   */
  async getNATGatewayCostBreakdown(profile: string): Promise<{
    hourlyCharges: number;
    dataProcessing: number;
    total: number;
    currency: string;
  } | null> {
    try {
      const now = new Date();
      const startDate = this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const endDate = this.formatDate(now);

      const prompt = `Using AWS Cost Explorer, get detailed NAT Gateway cost breakdown for profile ${profile}.

Execute this AWS CLI command:
aws ce get-cost-and-usage \\
  --time-period Start=${startDate},End=${endDate} \\
  --granularity MONTHLY \\
  --metrics UnblendedCost \\
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Virtual Private Cloud"]}}' \\
  --group-by Type=DIMENSION,Key=USAGE_TYPE \\
  --region us-east-1

Look for usage types:
- Containing "NatGateway-Hours" -> NAT Gateway hourly charges
- Containing "NatGateway-Bytes" -> NAT Gateway data processing charges

Return JSON:
{
  "hourlyCharges": 12.34,
  "dataProcessing": 28.73,
  "total": 41.07,
  "currency": "USD"
}

If no NAT Gateway costs found or AccessDenied, return:
{"error": "NO_COST_ACCESS", "total": 0}`;

      const response = await this.claudeService.query(prompt, 60000);
      const data = this.extractJSON(response.content);

      if (data?.error === 'NO_COST_ACCESS') {
        console.warn('[CostAnalysis] NAT Gateway cost data not available');
        return null;
      }

      if (data?.total !== undefined) {
        console.log(`[CostAnalysis] NAT Gateway costs: $${data.total.toFixed(2)} (hourly: $${data.hourlyCharges?.toFixed(2)}, data: $${data.dataProcessing?.toFixed(2)})`);
        return data;
      }
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to get NAT Gateway cost breakdown:', error.message);
    }

    return null;
  }

  /**
   * Extract JSON from Claude response with aggressive parsing
   * Finds the first '{' and last '}' to extract JSON even when wrapped in conversational text
   */
  private extractJSON(text: string): any {
    try {
      // Strategy 1: Try to extract from markdown code blocks first
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        console.log('[CostAnalysis] Extracted JSON from markdown code block');
        return parsed;
      }

      // Strategy 2: Try to extract from generic code blocks
      const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        try {
          const parsed = JSON.parse(codeBlockMatch[1]);
          console.log('[CostAnalysis] Extracted JSON from generic code block');
          return parsed;
        } catch {
          // Not valid JSON, continue to next strategy
        }
      }

      // Strategy 3: Aggressive extraction - find first '{' and last '}'
      // This handles cases where Claude wraps JSON in conversational text
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = text.substring(firstBrace, lastBrace + 1);
        try {
          const parsed = JSON.parse(jsonStr);
          console.log('[CostAnalysis] Extracted JSON using aggressive first/last brace extraction');
          return parsed;
        } catch (parseError) {
          console.warn('[CostAnalysis] Failed to parse JSON from first/last brace extraction:', parseError);
        }
      }

      // Strategy 4: Try to find any JSON object with standard regex
      const objectMatch = text.match(/\{[\s\S]*?\}/);
      if (objectMatch) {
        try {
          const parsed = JSON.parse(objectMatch[0]);
          console.log('[CostAnalysis] Extracted JSON using standard regex');
          return parsed;
        } catch {
          // Not valid JSON
        }
      }

      console.warn('[CostAnalysis] No valid JSON found in response');
      console.warn('[CostAnalysis] Response preview:', text.substring(0, 200));
      return null;
    } catch (error: any) {
      console.error('[CostAnalysis] Failed to parse JSON:', error.message);
      console.error('[CostAnalysis] Text preview:', text.substring(0, 200));
      return null;
    }
  }
}
