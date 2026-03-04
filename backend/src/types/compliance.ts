export enum ComplianceFramework {
  CIS_AWS = 'CIS_AWS',
  NIST_800_53 = 'NIST_800_53',
  ISO_27001 = 'ISO_27001',
  PCI_DSS = 'PCI_DSS',
  HIPAA = 'HIPAA',
  SOC2 = 'SOC2',
}

export enum ControlStatus {
  COMPLIANT = 'COMPLIANT',
  NON_COMPLIANT = 'NON_COMPLIANT',
  PARTIAL = 'PARTIAL',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  NOT_EVALUATED = 'NOT_EVALUATED',
}

export interface ComplianceControl {
  id: string;
  framework: ComplianceFramework;
  controlId: string;
  title: string;
  description: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: ControlStatus;
  evaluatedAt?: string;
  evidence?: string[];
  remediationSteps?: string[];
}

export interface ComplianceFrameworkDefinition {
  framework: ComplianceFramework;
  name: string;
  description: string;
  version: string;
  controls: Omit<ComplianceControl, 'status' | 'evaluatedAt' | 'evidence'>[];
}

export interface ComplianceEvaluation {
  id: string;
  framework: ComplianceFramework;
  profile: string;
  region?: string;
  evaluatedAt: string;
  score: number; // 0-100
  totalControls: number;
  compliant: number;
  nonCompliant: number;
  partial: number;
  notApplicable: number;
  notEvaluated: number;
  controls: ComplianceControl[];
  summary: string;
}

export interface ComplianceTrend {
  date: string;
  framework: ComplianceFramework;
  score: number;
  compliant: number;
  nonCompliant: number;
}

export interface GovernancePolicy {
  id: string;
  name: string;
  description: string;
  type: 'TAGGING' | 'NAMING' | 'RESOURCE_LIMIT' | 'SECURITY' | 'COST';
  enabled: boolean;
  rules: GovernancePolicyRule[];
  enforcement: 'ADVISORY' | 'MANDATORY';
  createdAt: string;
  updatedAt: string;
}

export interface GovernancePolicyRule {
  id: string;
  condition: string;
  action: 'ALLOW' | 'DENY' | 'WARN';
  parameters: Record<string, any>;
  message?: string;
}

export interface PolicyViolation {
  id: string;
  policyId: string;
  policyName: string;
  resourceId: string;
  resourceType: string;
  profile: string;
  region: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  detectedAt: string;
  resolvedAt?: string;
  status: 'OPEN' | 'RESOLVED' | 'SUPPRESSED';
}

export interface ComplianceReport {
  id: string;
  type: 'COMPLIANCE' | 'SECURITY' | 'COST' | 'RESOURCE' | 'GOVERNANCE';
  format: 'PDF' | 'CSV' | 'JSON' | 'HTML';
  title: string;
  description?: string;
  profile?: string;
  framework?: ComplianceFramework;
  startDate: string;
  endDate: string;
  generatedAt: string;
  generatedBy?: string;
  status: 'GENERATING' | 'COMPLETED' | 'FAILED';
  downloadUrl?: string;
  fileSize?: number;
  metadata?: Record<string, any>;
}

export interface ReportSchedule {
  id: string;
  name: string;
  reportType: ComplianceReport['type'];
  format: ComplianceReport['format'];
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  recipients: string[]; // email addresses
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceDashboardStats {
  overallScore: number;
  byFramework: {
    framework: ComplianceFramework;
    score: number;
    compliant: number;
    nonCompliant: number;
  }[];
  criticalViolations: number;
  openViolations: number;
  recentEvaluations: ComplianceEvaluation[];
  trends: ComplianceTrend[];
}
