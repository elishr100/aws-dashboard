export interface AccountInfo {
  accountId: string;
  profile: string;
  region: string;
  name?: string;
  email?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  type: 'PRODUCTION' | 'NON_PRODUCTION' | 'INFRASTRUCTURE' | 'INTEGRATION' | 'DEVELOPMENT';
  environment?: 'prod' | 'staging' | 'dev' | 'test';
  tags: Record<string, string>;
  metadata?: Record<string, any>;
  joinedAt?: string;
  lastActivity?: string;
}

export interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  type: 'ORGANIZATIONAL_UNIT' | 'CUSTOM' | 'ENVIRONMENT' | 'BUSINESS_UNIT';
  accounts: string[]; // account IDs
  parentGroupId?: string;
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationStructure {
  id: string;
  name: string;
  masterAccountId: string;
  totalAccounts: number;
  activeAccounts: number;
  groups: AccountGroup[];
  accounts: AccountInfo[];
  hierarchy: OrganizationNode;
}

export interface OrganizationNode {
  id: string;
  name: string;
  type: 'ROOT' | 'OU' | 'ACCOUNT';
  accountId?: string;
  children: OrganizationNode[];
}

export interface AggregatedMetrics {
  organizationId: string;
  period: string;
  generatedAt: string;

  resources: {
    total: number;
    byType: Record<string, number>;
    byRegion: Record<string, number>;
    byAccount: Record<string, number>;
  };

  costs: {
    total: number;
    byAccount: Record<string, number>;
    byService: Record<string, number>;
    byRegion: Record<string, number>;
    trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  };

  security: {
    overallScore: number;
    criticalFindings: number;
    highFindings: number;
    byAccount: Record<string, {
      score: number;
      critical: number;
      high: number;
    }>;
  };

  compliance: {
    overallScore: number;
    byFramework: Record<string, number>;
    byAccount: Record<string, {
      score: number;
      compliant: number;
      nonCompliant: number;
    }>;
  };
}

export interface AccountComparison {
  accounts: {
    accountId: string;
    profile: string;
    name?: string;
  }[];

  metrics: {
    resources: {
      accountId: string;
      total: number;
      byType: Record<string, number>;
    }[];

    costs: {
      accountId: string;
      total: number;
      trend: string;
    }[];

    security: {
      accountId: string;
      score: number;
      criticalFindings: number;
    }[];

    compliance: {
      accountId: string;
      score: number;
      frameworks: Record<string, number>;
    }[];
  };

  rankings: {
    lowestCost: string;
    highestSecurity: string;
    highestCompliance: string;
    mostResources: string;
  };
}

export interface AccountBenchmark {
  accountId: string;
  profile: string;

  percentile: {
    cost: number; // 0-100
    security: number;
    compliance: number;
    resources: number;
  };

  vsAverage: {
    cost: number; // % difference
    security: number;
    compliance: number;
    resources: number;
  };

  vsMedian: {
    cost: number;
    security: number;
    compliance: number;
    resources: number;
  };

  recommendations: string[];
}

export interface ConsolidatedReport {
  id: string;
  title: string;
  type: 'EXECUTIVE' | 'OPERATIONAL' | 'SECURITY' | 'COST' | 'COMPLIANCE';
  scope: 'ORGANIZATION' | 'GROUP' | 'ACCOUNTS';
  groupId?: string;
  accountIds?: string[];

  period: {
    startDate: string;
    endDate: string;
  };

  summary: {
    totalAccounts: number;
    totalResources: number;
    totalCost: number;
    averageSecurityScore: number;
    averageComplianceScore: number;
  };

  sections: ConsolidatedReportSection[];

  generatedAt: string;
  generatedBy?: string;
  status: 'GENERATING' | 'COMPLETED' | 'FAILED';
  downloadUrl?: string;
}

export interface ConsolidatedReportSection {
  id: string;
  title: string;
  type: 'SUMMARY' | 'DETAIL' | 'CHART' | 'TABLE' | 'RECOMMENDATION';
  content: any;
  order: number;
}

export interface CrossAccountQuery {
  accountIds?: string[];
  groupId?: string;
  profiles?: string[];
  regions?: string[];
  startDate?: string;
  endDate?: string;
  metrics: ('resources' | 'costs' | 'security' | 'compliance')[];
}

export interface AccountHealthScore {
  accountId: string;
  profile: string;
  overallScore: number; // 0-100

  scores: {
    security: number;
    compliance: number;
    costOptimization: number;
    resourceUtilization: number;
    governance: number;
  };

  status: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  issues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };

  lastEvaluated: string;
}

export interface OrganizationInsight {
  id: string;
  type: 'COST_ANOMALY' | 'SECURITY_RISK' | 'COMPLIANCE_GAP' | 'RESOURCE_WASTE' | 'BEST_PRACTICE';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  affectedAccounts: string[];
  impact: {
    cost?: number;
    securityScore?: number;
    affectedResources?: number;
  };
  recommendation: string;
  detectedAt: string;
}
