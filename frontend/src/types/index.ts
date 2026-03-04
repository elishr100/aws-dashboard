export interface AWSAccount {
  profile: string;
  region: string;
  accountId?: string;
}

export interface SessionStatus {
  valid: boolean;
  expiresAt?: string;
  profile: string;
  error?: string;
}

export interface ResourceCost {
  currentMonthCost: number;
  avgMonthlyCost: number;
  currency: string;
  lastUpdated: string;
}

export interface Resource {
  id: string;
  type: string;
  name: string;
  region: string;
  profile: string;
  vpcId?: string;
  cidr?: string;
  state?: string;
  instanceType?: string;
  launchTime?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
  cost?: ResourceCost;
}

export interface ResourceStats {
  total: number;
  byType: Record<string, number>;
  byRegion: Record<string, number>;
  byProfile: Record<string, number>;
}

export interface ScanRequest {
  profile: string;
  regions: string[];
}

export interface ScanJob {
  jobId: string;
  profile: string;
  regions: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  progress?: {
    current: number;
    total: number;
    message: string;
  };
  error?: string;
}

export interface ScanProgressEvent {
  type: 'progress' | 'complete' | 'error';
  data: {
    jobId: string;
    message: string;
    progress?: {
      current: number;
      total: number;
    };
    error?: string;
    resources?: Resource[];
  };
}

// Security types
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type FindingStatus = 'ACTIVE' | 'RESOLVED' | 'SUPPRESSED' | 'FALSE_POSITIVE';

export interface SecurityFinding {
  id: string;
  checkType: string;
  severity: FindingSeverity;
  status: FindingStatus;
  resourceId: string;
  resourceType: string;
  resourceName?: string;
  region: string;
  profile: string;
  accountId?: string;
  title: string;
  description: string;
  recommendation: string;
  detectedAt: string;
  updatedAt: string;
  resolvedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityAlert {
  id: string;
  findingId: string;
  severity: FindingSeverity;
  title: string;
  message: string;
  resourceId: string;
  profile: string;
  region: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  createdAt: string;
}

export interface ComplianceReport {
  profile: string;
  region: string;
  scanDate: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  complianceScore: number;
  findingsBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  findingsByType: Record<string, number>;
}

export interface AuditRequest {
  profile: string;
  regions: string[];
  checkTypes?: string[];
}

export interface AuditResult {
  auditId: string;
  profile: string;
  regions: string[];
  startedAt: string;
  completedAt?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  findings: SecurityFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

// Organization types
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
  metadata?: Record<string, unknown>;
  joinedAt?: string;
  lastActivity?: string;
}

export interface AccountGroup {
  id: string;
  name: string;
  description?: string;
  type: 'ORGANIZATIONAL_UNIT' | 'CUSTOM' | 'ENVIRONMENT' | 'BUSINESS_UNIT';
  accounts: string[];
  parentGroupId?: string;
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationNode {
  id: string;
  name: string;
  type: 'ROOT' | 'OU' | 'ACCOUNT';
  accountId?: string;
  children: OrganizationNode[];
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

export interface AccountHealthScore {
  accountId: string;
  profile: string;
  overallScore: number;
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
