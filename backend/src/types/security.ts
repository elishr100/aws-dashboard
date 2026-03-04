export enum FindingSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

export enum FindingStatus {
  ACTIVE = 'ACTIVE',
  RESOLVED = 'RESOLVED',
  SUPPRESSED = 'SUPPRESSED',
  FALSE_POSITIVE = 'FALSE_POSITIVE',
}

export enum SecurityCheckType {
  // S3 Security
  S3_BUCKET_PUBLIC_ACCESS = 'S3_BUCKET_PUBLIC_ACCESS',
  S3_BUCKET_ENCRYPTION = 'S3_BUCKET_ENCRYPTION',
  S3_BUCKET_VERSIONING = 'S3_BUCKET_VERSIONING',
  S3_BUCKET_LOGGING = 'S3_BUCKET_LOGGING',

  // EC2 Security
  EC2_SECURITY_GROUP_OPEN = 'EC2_SECURITY_GROUP_OPEN',
  EC2_INSTANCE_PUBLIC_IP = 'EC2_INSTANCE_PUBLIC_IP',
  EC2_UNENCRYPTED_VOLUME = 'EC2_UNENCRYPTED_VOLUME',
  EC2_OLD_AMI = 'EC2_OLD_AMI',
  EC2_IMDSV2_NOT_REQUIRED = 'EC2_IMDSV2_NOT_REQUIRED',
  EC2_INSTANCE_STOPPED_LONG_TIME = 'EC2_INSTANCE_STOPPED_LONG_TIME',

  // RDS Security
  RDS_PUBLIC_ACCESS = 'RDS_PUBLIC_ACCESS',
  RDS_UNENCRYPTED = 'RDS_UNENCRYPTED',
  RDS_NO_BACKUP = 'RDS_NO_BACKUP',
  RDS_MINOR_VERSION_UPGRADE = 'RDS_MINOR_VERSION_UPGRADE',

  // IAM Security
  IAM_ROOT_ACCESS_KEY = 'IAM_ROOT_ACCESS_KEY',
  IAM_ROOT_ACCESS_KEYS = 'IAM_ROOT_ACCESS_KEYS',
  IAM_USER_NO_MFA = 'IAM_USER_NO_MFA',
  IAM_USER_WITHOUT_MFA = 'IAM_USER_WITHOUT_MFA',
  IAM_OLD_ACCESS_KEY = 'IAM_OLD_ACCESS_KEY',
  IAM_ACCESS_KEY_NOT_ROTATED = 'IAM_ACCESS_KEY_NOT_ROTATED',
  IAM_OVERPRIVILEGED_POLICY = 'IAM_OVERPRIVILEGED_POLICY',
  IAM_POLICY_WILDCARD = 'IAM_POLICY_WILDCARD',
  IAM_PASSWORD_POLICY_WEAK = 'IAM_PASSWORD_POLICY_WEAK',

  // VPC Security
  VPC_FLOW_LOGS_DISABLED = 'VPC_FLOW_LOGS_DISABLED',
  VPC_DEFAULT_SECURITY_GROUP = 'VPC_DEFAULT_SECURITY_GROUP',
  VPC_DEFAULT_IN_USE = 'VPC_DEFAULT_IN_USE',

  // Lambda Security
  LAMBDA_PUBLIC_ACCESS = 'LAMBDA_PUBLIC_ACCESS',
  LAMBDA_OLD_RUNTIME = 'LAMBDA_OLD_RUNTIME',
  LAMBDA_NO_VPC = 'LAMBDA_NO_VPC',

  // KMS Security
  KMS_KEY_ROTATION_DISABLED = 'KMS_KEY_ROTATION_DISABLED',

  // CloudTrail Security
  CLOUDTRAIL_NOT_ENABLED = 'CLOUDTRAIL_NOT_ENABLED',
  CLOUDTRAIL_LOGS_NOT_ENCRYPTED = 'CLOUDTRAIL_LOGS_NOT_ENCRYPTED',

  // GuardDuty Security
  GUARDDUTY_NOT_ENABLED = 'GUARDDUTY_NOT_ENABLED',

  // Audit Status
  TIMEOUT = 'TIMEOUT',
}

export interface SecurityFinding {
  id: string;
  checkType: SecurityCheckType;
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
  metadata?: Record<string, any>;
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

export interface SecurityScore {
  overall: number;
  byProfile: Record<string, number>;
  byRegion: Record<string, number>;
  trend: {
    date: string;
    score: number;
  }[];
}

export interface AuditRequest {
  profile: string;
  regions: string[];
  checkTypes?: SecurityCheckType[];
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
