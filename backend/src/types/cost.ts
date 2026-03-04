export interface CostDataPoint {
  date: string;
  amount: number;
  currency: string;
}

export interface CostByService {
  service: string;
  amount: number;
  percentage: number;
  currency: string;
}

export interface CostByAccount {
  profile: string;
  accountId?: string;
  amount: number;
  percentage: number;
  currency: string;
}

export interface CostByRegion {
  region: string;
  amount: number;
  percentage: number;
  currency: string;
}

export interface CostTrend {
  period: string; // 'DAILY' | 'WEEKLY' | 'MONTHLY'
  data: CostDataPoint[];
  total: number;
  average: number;
  currency: string;
}

export interface CostForecast {
  date: string;
  predictedAmount: number;
  upperBound: number;
  lowerBound: number;
  confidence: number; // 0-100
  currency: string;
}

export interface CostAnomaly {
  id: string;
  date: string;
  service: string;
  expectedAmount: number;
  actualAmount: number;
  deviation: number; // percentage
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  detectedAt: string;
}

export interface CostSummary {
  currentMonth: number;
  previousMonth: number;
  monthToDate: number;
  forecastedMonth: number;
  currency: string;
  trend: 'INCREASING' | 'DECREASING' | 'STABLE' | 'UNAVAILABLE';
  changePercentage: number;
  error?: string; // Optional error message when cost data is not available
}

export interface Budget {
  id: string;
  name: string;
  amount: number;
  currency: string;
  period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  startDate: string;
  endDate?: string;
  profile?: string;
  services?: string[];
  alertThresholds: {
    percentage: number;
    enabled: boolean;
  }[];
  currentSpend: number;
  percentageUsed: number;
  status: 'OK' | 'WARNING' | 'EXCEEDED';
  createdAt: string;
  updatedAt: string;
}

export interface BudgetAlert {
  id: string;
  budgetId: string;
  budgetName: string;
  threshold: number;
  currentSpend: number;
  budgetAmount: number;
  percentageUsed: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  triggeredAt: string;
  acknowledged: boolean;
}

export interface CostOptimizationRecommendation {
  id: string;
  type: 'RIGHTSIZING' | 'RESERVED_INSTANCE' | 'SAVINGS_PLAN' | 'UNUSED_RESOURCE' | 'STORAGE_OPTIMIZATION';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  resourceId?: string;
  resourceType?: string;
  service: string;
  region: string;
  profile: string;
  title: string;
  description: string;
  currentCost: number;
  potentialSavings: number;
  savingsPercentage: number;
  recommendation: string;
  implementationEffort: 'LOW' | 'MEDIUM' | 'HIGH';
  currency: string;
  detectedAt: string;
}

export interface CostReport {
  reportId: string;
  profile: string;
  startDate: string;
  endDate: string;
  summary: CostSummary;
  byService: CostByService[];
  byRegion: CostByRegion[];
  trends: CostTrend;
  anomalies: CostAnomaly[];
  recommendations: CostOptimizationRecommendation[];
  generatedAt: string;
}

export interface CostQuery {
  profile: string;
  startDate: string;
  endDate: string;
  granularity?: 'DAILY' | 'MONTHLY';
  groupBy?: 'SERVICE' | 'REGION' | 'USAGE_TYPE';
  filter?: {
    services?: string[];
    regions?: string[];
  };
}

export interface ResourceCostQuery {
  profile: string;
  resourceId: string;
  resourceType: string;
  tags?: Record<string, string>;
}

export interface ResourceCostData {
  resourceId: string;
  resourceType: string;
  currentMonthCost: number;
  avgMonthlyCost: number;
  currency: string;
  breakdown?: {
    usageType: string;
    amount: number;
  }[];
}

export interface CostDashboardSummary {
  totalCurrentMonth: number;
  projectedMonthEnd: number;
  averageLast3Months?: number; // Average monthly cost over last 3 complete months
  topExpensiveResources: Array<{
    resourceId: string;
    resourceType: string;
    resourceName?: string;
    cost: number;
  }>;
  currency: string;
  notes?: string[]; // Optional notes (e.g., Bedrock billing info, payer account details)
}
