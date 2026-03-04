export interface ClaudeResponse {
  content: string;
  raw?: string;
  error?: string;
}

export interface VPCListResponse {
  vpcs: Array<{
    VpcId: string;
    CidrBlock: string;
    State: string;
    Tags?: Array<{ Key: string; Value: string }>;
  }>;
  region: string;
  fetchedAt: string;
}

export interface AWSAccount {
  profileName: string;
  region?: string;
  roleArn?: string;
  sourceProfile?: string;
}

export interface SessionStatus {
  valid: boolean;
  expiresAt?: Date;
  minutesRemaining?: number;
  expired: boolean;
  needsRefresh: boolean;
}

export interface ResourceCost {
  currentMonthCost: number;
  avgMonthlyCost: number;
  currency: string;
  lastUpdated: string;
}

export interface AWSResource {
  id: string;
  name?: string;
  type: 'EC2' | 'VPC' | 'S3' | 'RDS' | 'Lambda' | 'ELB' | 'NAT' | 'SecurityGroup' | 'DynamoDB' | 'IAMRole' |
        'IAMUser' | 'IAMPolicy' | 'ECR' | 'SQS' | 'SNS' | 'CloudWatchAlarm' | 'SecretsManager' | 'KMS' |
        'GuardDuty' | 'WAF' | 'Route53' | 'CloudTrail' | 'ClassicELB';
  region: string;
  state?: string;
  vpcId?: string;
  tags?: Record<string, string>;
  metadata?: any;
  cost?: ResourceCost;
}

export interface ResourceInventory {
  resources: AWSResource[];
  fetchedAt: string;
  profile: string;
  region: string;
  errors?: string[];
}

export interface ScanRequest {
  profile: string;
  regions: string[];
}

export interface ScanJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  profile: string;
  regions: string[];
  startedAt: string;
  completedAt?: string;
  progress: number; // 0-100
  currentRegion?: string;
  resourcesFound: number;
  errors?: string[];
}

// Re-export security types
export * from './security.js';

// Re-export cost types
export * from './cost.js';

// Re-export compliance types
export * from './compliance.js';

// Re-export organization types
export * from './organization.js';
