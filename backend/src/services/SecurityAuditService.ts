import { ClaudeMCPService } from './ClaudeMCPService.js';
import { cacheService, CacheService } from './CacheService.js';
import type {
  SecurityFinding,
  SecurityCheckType,
  FindingSeverity,
  FindingStatus,
  AuditRequest,
  AuditResult,
  ComplianceReport,
} from '../types/security.js';

export class SecurityAuditService {
  private claudeService: ClaudeMCPService;
  private findings: Map<string, SecurityFinding> = new Map();

  /**
   * Constructor with dependency injection for ClaudeMCPService
   * This ensures a single shared instance with synchronized credentials
   */
  constructor(claudeService: ClaudeMCPService) {
    this.claudeService = claudeService;
    console.log(`[SecurityAudit] Initialized with shared ClaudeMCPService instance`);
  }

  /**
   * Perform comprehensive security audit on AWS account
   */
  async performAudit(request: AuditRequest): Promise<AuditResult> {
    const auditId = `audit-${Date.now()}`;
    const startedAt = new Date().toISOString();

    console.log(`[SecurityAudit] Starting audit ${auditId} for ${request.profile}`);

    const allFindings: SecurityFinding[] = [];

    try {
      // Update Claude service to use the requested profile
      this.claudeService.setProfile(request.profile);

      // Overall audit timeout: 3 minutes
      const auditPromise = this.performAuditChecks(request, allFindings);
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Audit timeout after 3 minutes')), 180000);
      });

      await Promise.race([auditPromise, timeoutPromise]);

      // Store findings
      allFindings.forEach((finding) => {
        this.findings.set(finding.id, finding);
      });

      // Calculate summary
      const summary = {
        total: allFindings.length,
        critical: allFindings.filter((f) => f.severity === 'CRITICAL').length,
        high: allFindings.filter((f) => f.severity === 'HIGH').length,
        medium: allFindings.filter((f) => f.severity === 'MEDIUM').length,
        low: allFindings.filter((f) => f.severity === 'LOW').length,
        info: allFindings.filter((f) => f.severity === 'INFO').length,
      };

      console.log(`[SecurityAudit] Completed audit ${auditId}: ${summary.total} findings`);

      return {
        auditId,
        profile: request.profile,
        regions: request.regions,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'COMPLETED',
        findings: allFindings,
        summary,
      };
    } catch (error: any) {
      console.error(`[SecurityAudit] Audit failed:`, error.message);
      return {
        auditId,
        profile: request.profile,
        regions: request.regions,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'FAILED',
        findings: allFindings,
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          info: 0,
        },
      };
    }
  }

  /**
   * Execute an async function with timeout
   * Returns null if timeout occurs
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    taskName: string
  ): Promise<T | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        console.warn(`[SecurityAudit] ${taskName} timed out after ${timeoutMs}ms`);
        resolve(null);
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Create a finding for a timed-out check
   */
  private createTimeoutFinding(
    resourceType: string,
    region: string,
    profile: string,
    description: string
  ): SecurityFinding {
    return {
      id: `finding-${Date.now()}-timeout-${resourceType}`,
      checkType: 'TIMEOUT' as SecurityCheckType,
      severity: 'INFO' as FindingSeverity,
      status: 'ACTIVE' as FindingStatus,
      resourceId: 'UNKNOWN',
      resourceType,
      region,
      profile,
      title: `${resourceType} Check Timed Out`,
      description,
      recommendation: 'Check network connectivity and AWS API latency. Re-run the audit to try again.',
      detectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Perform audit checks for all regions (called by performAudit)
   * Includes timeout handling and comprehensive security checks
   */
  private async performAuditChecks(request: AuditRequest, allFindings: SecurityFinding[]): Promise<void> {
    // 1. GLOBAL CHECKS (run once, not per region)
    console.log(`[SecurityAudit] Running global security checks`);
    const [iamFindings, cloudTrailFindings, guardDutyGlobalFindings] = await Promise.all([
      this.auditIAMSecurity(request.profile),
      this.auditCloudTrailSecurity(request.profile),
      this.auditGuardDutySecurity(request.profile, 'us-east-1'), // Check at least one region
    ]);
    allFindings.push(...iamFindings, ...cloudTrailFindings, ...guardDutyGlobalFindings);

    // 2. REGIONAL CHECKS (run in parallel for all regions)
    const regionPromises = request.regions.map(async (region) => {
      console.log(`[SecurityAudit] Scanning region ${region}`);

      // Run all checks in parallel for this region with 60-second timeout per category
      const [s3Findings, ec2Findings, rdsFindings, vpcFindings, kmsFindings, guardDutyFindings] = await Promise.all([
        this.withTimeout(this.auditS3Buckets(request.profile, region), 60000, `S3 audit for ${region}`).then(r => r || []),
        this.withTimeout(this.auditEC2Security(request.profile, region), 60000, `EC2 audit for ${region}`).then(r => r || []),
        this.withTimeout(this.auditRDSSecurity(request.profile, region), 60000, `RDS audit for ${region}`).then(r => r || []),
        this.withTimeout(this.auditVPCSecurity(request.profile, region), 60000, `VPC audit for ${region}`).then(r => r || []),
        this.withTimeout(this.auditKMSSecurity(request.profile, region), 60000, `KMS audit for ${region}`).then(r => r || []),
        this.withTimeout(this.auditGuardDutySecurity(request.profile, region), 60000, `GuardDuty audit for ${region}`).then(r => r || []),
      ]);

      allFindings.push(...s3Findings, ...ec2Findings, ...rdsFindings, ...vpcFindings, ...kmsFindings, ...guardDutyFindings);
    });

    await Promise.all(regionPromises);
  }

  /**
   * Audit S3 bucket security
   */
  private async auditS3Buckets(
    profile: string,
    region: string
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, list all S3 buckets in the ${region} region for profile ${profile}.
For each bucket, check:
1. Is the bucket publicly accessible?
2. Is encryption enabled?
3. Is versioning enabled?
4. Is access logging enabled?

IMPORTANT: Run these checks IN PARALLEL for all buckets using Promise.all() to minimize time.
Each individual AWS API call should complete within 10 seconds.

Return the results in JSON format with structure:
{
  "buckets": [
    {
      "name": "bucket-name",
      "publicAccess": true/false,
      "encryption": true/false,
      "versioning": true/false,
      "logging": true/false
    }
  ]
}`;

      const responsePromise = this.claudeService.query(prompt);
      const response = await this.withTimeout(responsePromise, 60000, `S3 audit for ${region}`);

      if (!response) {
        console.warn(`[SecurityAudit] S3 audit timed out for ${region}, marking as UNKNOWN`);
        findings.push(this.createTimeoutFinding('S3', region, profile, 'S3 bucket security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      if (data?.buckets) {
        for (const bucket of data.buckets) {
          // Check for public access
          if (bucket.publicAccess) {
            findings.push({
              id: `finding-${Date.now()}-${bucket.name}-public`,
              checkType: 'S3_BUCKET_PUBLIC_ACCESS' as SecurityCheckType,
              severity: 'CRITICAL' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: bucket.name,
              resourceType: 'S3',
              resourceName: bucket.name,
              region,
              profile,
              title: 'S3 Bucket Publicly Accessible',
              description: `S3 bucket "${bucket.name}" allows public access, potentially exposing sensitive data.`,
              recommendation: 'Disable public access unless explicitly required. Use bucket policies and ACLs to restrict access.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Check for encryption
          if (!bucket.encryption) {
            findings.push({
              id: `finding-${Date.now()}-${bucket.name}-encryption`,
              checkType: 'S3_BUCKET_ENCRYPTION' as SecurityCheckType,
              severity: 'HIGH' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: bucket.name,
              resourceType: 'S3',
              resourceName: bucket.name,
              region,
              profile,
              title: 'S3 Bucket Not Encrypted',
              description: `S3 bucket "${bucket.name}" does not have default encryption enabled.`,
              recommendation: 'Enable default encryption using AWS KMS or AES-256.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          // Check for versioning
          if (!bucket.versioning) {
            findings.push({
              id: `finding-${Date.now()}-${bucket.name}-versioning`,
              checkType: 'S3_BUCKET_VERSIONING' as SecurityCheckType,
              severity: 'MEDIUM' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: bucket.name,
              resourceType: 'S3',
              resourceName: bucket.name,
              region,
              profile,
              title: 'S3 Bucket Versioning Disabled',
              description: `S3 bucket "${bucket.name}" does not have versioning enabled.`,
              recommendation: 'Enable versioning to protect against accidental deletion and provide audit trail.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[SecurityAudit] S3 audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit EC2 security groups and instances
   */
  private async auditEC2Security(
    profile: string,
    region: string
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, analyze EC2 security in ${region} for profile ${profile}.

Execute these AWS CLI commands:
1. aws ec2 describe-security-groups --region ${region}
2. aws ec2 describe-instances --region ${region}
3. aws ec2 describe-volumes --region ${region}

Check:
1. Security groups with 0.0.0.0/0 open on ports 22, 3389, or other sensitive ports
2. EC2 instances with public IP addresses
3. Unencrypted EBS volumes
4. EC2 instances without IMDSv2 enforced (HttpTokens != "required")
5. Stopped EC2 instances older than 30 days

IMPORTANT: Run these checks IN PARALLEL using Promise.all() to minimize time.

Return JSON:
{
  "securityGroups": [
    {"id": "sg-xxx", "name": "sg-name", "openPorts": [22, 3389]}
  ],
  "publicInstances": [
    {"id": "i-xxx", "name": "instance-name", "publicIp": "x.x.x.x"}
  ],
  "unencryptedVolumes": [
    {"id": "vol-xxx", "instanceId": "i-xxx"}
  ],
  "instancesWithoutIMDSv2": [
    {"id": "i-xxx", "name": "instance-name"}
  ],
  "stoppedInstances": [
    {"id": "i-xxx", "name": "instance-name", "daysStopped": 45}
  ]
}`;

      const responsePromise = this.claudeService.query(prompt);
      const response = await this.withTimeout(responsePromise, 60000, `EC2 audit for ${region}`);

      if (!response) {
        console.warn(`[SecurityAudit] EC2 audit timed out for ${region}, marking as UNKNOWN`);
        findings.push(this.createTimeoutFinding('EC2', region, profile, 'EC2 security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      // Check security groups
      if (data?.securityGroups) {
        for (const sg of data.securityGroups) {
          if (sg.openPorts && sg.openPorts.length > 0) {
            findings.push({
              id: `finding-${Date.now()}-${sg.id}`,
              checkType: 'EC2_SECURITY_GROUP_OPEN' as SecurityCheckType,
              severity: 'HIGH' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: sg.id,
              resourceType: 'SecurityGroup',
              resourceName: sg.name,
              region,
              profile,
              title: 'Security Group Open to Internet',
              description: `Security group "${sg.name}" has open access from 0.0.0.0/0 on ports: ${sg.openPorts.join(', ')}`,
              recommendation: 'Restrict access to specific IP ranges or use VPN/bastion hosts.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              metadata: { openPorts: sg.openPorts },
            });
          }
        }
      }

      // Check public instances
      if (data?.publicInstances) {
        for (const instance of data.publicInstances) {
          findings.push({
            id: `finding-${Date.now()}-${instance.id}-public`,
            checkType: 'EC2_INSTANCE_PUBLIC_IP' as SecurityCheckType,
            severity: 'MEDIUM' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: instance.id,
            resourceType: 'EC2',
            resourceName: instance.name,
            region,
            profile,
            title: 'EC2 Instance Has Public IP',
            description: `Instance "${instance.name || instance.id}" has public IP ${instance.publicIp}`,
            recommendation: 'Use private subnets and NAT gateways unless public access is required.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Check unencrypted volumes
      if (data?.unencryptedVolumes) {
        for (const volume of data.unencryptedVolumes) {
          findings.push({
            id: `finding-${Date.now()}-${volume.id}`,
            checkType: 'EC2_UNENCRYPTED_VOLUME' as SecurityCheckType,
            severity: 'HIGH' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: volume.id,
            resourceType: 'EBS',
            region,
            profile,
            title: 'Unencrypted EBS Volume',
            description: `EBS volume "${volume.id}" is not encrypted`,
            recommendation: 'Enable EBS encryption for all volumes to protect data at rest.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: { instanceId: volume.instanceId },
          });
        }
      }

      // Check IMDSv2
      if (data?.instancesWithoutIMDSv2) {
        for (const instance of data.instancesWithoutIMDSv2) {
          findings.push({
            id: `finding-${Date.now()}-${instance.id}-imdsv2`,
            checkType: 'EC2_IMDSV2_NOT_REQUIRED' as SecurityCheckType,
            severity: 'MEDIUM' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: instance.id,
            resourceType: 'EC2',
            resourceName: instance.name,
            region,
            profile,
            title: 'IMDSv2 Not Enforced',
            description: `EC2 instance "${instance.name || instance.id}" does not require IMDSv2`,
            recommendation: 'Enforce IMDSv2 to prevent SSRF attacks. Use: aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Check stopped instances
      if (data?.stoppedInstances) {
        for (const instance of data.stoppedInstances) {
          findings.push({
            id: `finding-${Date.now()}-${instance.id}-stopped`,
            checkType: 'EC2_INSTANCE_STOPPED_LONG_TIME' as SecurityCheckType,
            severity: 'LOW' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: instance.id,
            resourceType: 'EC2',
            resourceName: instance.name,
            region,
            profile,
            title: 'EC2 Instance Stopped for Extended Period',
            description: `EC2 instance "${instance.name || instance.id}" has been stopped for ${instance.daysStopped} days`,
            recommendation: 'Review and terminate unused instances to reduce costs and maintain clean infrastructure.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: { daysStopped: instance.daysStopped },
          });
        }
      }
    } catch (error: any) {
      console.error('[SecurityAudit] EC2 audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit RDS security
   */
  private async auditRDSSecurity(
    profile: string,
    region: string
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, check RDS instances in ${region} for profile ${profile}.
Check:
1. Publicly accessible RDS instances
2. Unencrypted RDS instances
3. RDS instances without automated backups

IMPORTANT: Run these checks IN PARALLEL using Promise.all() to minimize time.
Each individual AWS API call should complete within 10 seconds.

Return JSON:
{
  "instances": [
    {
      "id": "db-instance-id",
      "name": "db-name",
      "publiclyAccessible": true/false,
      "encrypted": true/false,
      "backupEnabled": true/false
    }
  ]
}`;

      const responsePromise = this.claudeService.query(prompt);
      const response = await this.withTimeout(responsePromise, 60000, `RDS audit for ${region}`);

      if (!response) {
        console.warn(`[SecurityAudit] RDS audit timed out for ${region}, marking as UNKNOWN`);
        findings.push(this.createTimeoutFinding('RDS', region, profile, 'RDS security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      if (data?.instances) {
        for (const db of data.instances) {
          if (db.publiclyAccessible) {
            findings.push({
              id: `finding-${Date.now()}-${db.id}-public`,
              checkType: 'RDS_PUBLIC_ACCESS' as SecurityCheckType,
              severity: 'CRITICAL' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: db.id,
              resourceType: 'RDS',
              resourceName: db.name,
              region,
              profile,
              title: 'RDS Instance Publicly Accessible',
              description: `RDS instance "${db.name}" is publicly accessible`,
              recommendation: 'Disable public access and use VPN or private connections.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          if (!db.encrypted) {
            findings.push({
              id: `finding-${Date.now()}-${db.id}-encryption`,
              checkType: 'RDS_UNENCRYPTED' as SecurityCheckType,
              severity: 'HIGH' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: db.id,
              resourceType: 'RDS',
              resourceName: db.name,
              region,
              profile,
              title: 'RDS Instance Not Encrypted',
              description: `RDS instance "${db.name}" is not encrypted`,
              recommendation: 'Enable encryption at rest for database instances.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          if (!db.backupEnabled) {
            findings.push({
              id: `finding-${Date.now()}-${db.id}-backup`,
              checkType: 'RDS_NO_BACKUP' as SecurityCheckType,
              severity: 'HIGH' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: db.id,
              resourceType: 'RDS',
              resourceName: db.name,
              region,
              profile,
              title: 'RDS Instance Without Automated Backups',
              description: `RDS instance "${db.name}" does not have automated backups enabled`,
              recommendation: 'Enable automated backups with appropriate retention period.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[SecurityAudit] RDS audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit VPC security
   */
  private async auditVPCSecurity(
    profile: string,
    region: string
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, check VPCs in ${region} for profile ${profile}.

Execute these AWS CLI commands:
1. aws ec2 describe-vpcs --region ${region}
2. aws ec2 describe-flow-logs --region ${region}

Check:
1. If VPC Flow Logs are enabled for each VPC
2. If default VPC is present (IsDefault=true)

Return JSON:
{
  "vpcs": [
    {"id": "vpc-xxx", "flowLogsEnabled": true/false, "isDefault": false}
  ]
}`;

      const responsePromise = this.claudeService.query(prompt);
      const response = await this.withTimeout(responsePromise, 60000, `VPC audit for ${region}`);

      if (!response) {
        console.warn(`[SecurityAudit] VPC audit timed out for ${region}, marking as UNKNOWN`);
        findings.push(this.createTimeoutFinding('VPC', region, profile, 'VPC security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      if (data?.vpcs) {
        for (const vpc of data.vpcs) {
          if (!vpc.flowLogsEnabled) {
            findings.push({
              id: `finding-${Date.now()}-${vpc.id}-flowlogs`,
              checkType: 'VPC_FLOW_LOGS_DISABLED' as SecurityCheckType,
              severity: 'MEDIUM' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: vpc.id,
              resourceType: 'VPC',
              region,
              profile,
              title: 'VPC Flow Logs Disabled',
              description: `VPC "${vpc.id}" does not have flow logs enabled`,
              recommendation: 'Enable VPC Flow Logs for network traffic monitoring and security analysis.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          if (vpc.isDefault) {
            findings.push({
              id: `finding-${Date.now()}-${vpc.id}-default`,
              checkType: 'VPC_DEFAULT_IN_USE' as SecurityCheckType,
              severity: 'LOW' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: vpc.id,
              resourceType: 'VPC',
              region,
              profile,
              title: 'Default VPC In Use',
              description: `Default VPC "${vpc.id}" is present and may be in use`,
              recommendation: 'Create custom VPCs with proper CIDR blocks and security controls instead of using default VPC.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[SecurityAudit] VPC audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit IAM security (global checks)
   */
  private async auditIAMSecurity(profile: string): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, check IAM security for profile ${profile}.

Execute these AWS CLI commands:
1. aws iam list-access-keys --user-name root (check for root access keys)
2. aws iam get-credential-report (check users without MFA)
3. aws iam list-policies --scope Local (check for wildcard policies)
4. aws iam get-account-password-policy (check password policy)

Check:
1. Root account has access keys
2. IAM users without MFA enabled
3. IAM policies with "*" actions and "*" resources (overly permissive)
4. Access keys not rotated in 90+ days
5. Password policy not configured or weak

Return JSON:
{
  "rootAccessKeys": true/false,
  "usersWithoutMFA": [{"userName": "user1"}],
  "wildcardPolicies": [{"policyName": "policy1", "policyArn": "arn"}],
  "oldAccessKeys": [{"userName": "user1", "daysSinceRotation": 120}],
  "passwordPolicy": {"configured": true/false, "minimumLength": 8}
}`;

      const responsePromise = this.claudeService.query(prompt, 90000); // 90 second timeout for IAM
      const response = await this.withTimeout(responsePromise, 90000, `IAM audit`);

      if (!response) {
        console.warn(`[SecurityAudit] IAM audit timed out`);
        findings.push(this.createTimeoutFinding('IAM', 'global', profile, 'IAM security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      // Check for root access keys
      if (data?.rootAccessKeys) {
        findings.push({
          id: `finding-${Date.now()}-root-keys`,
          checkType: 'IAM_ROOT_ACCESS_KEYS' as SecurityCheckType,
          severity: 'CRITICAL' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: 'root',
          resourceType: 'IAM',
          region: 'global',
          profile,
          title: 'Root Account Has Access Keys',
          description: `Root account has active access keys. This is a critical security risk.`,
          recommendation: 'Delete all root account access keys immediately. Use IAM users with appropriate permissions instead.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Check users without MFA
      if (data?.usersWithoutMFA && data.usersWithoutMFA.length > 0) {
        for (const user of data.usersWithoutMFA) {
          findings.push({
            id: `finding-${Date.now()}-${user.userName}-mfa`,
            checkType: 'IAM_USER_WITHOUT_MFA' as SecurityCheckType,
            severity: 'HIGH' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: user.userName,
            resourceType: 'IAM',
            region: 'global',
            profile,
            title: 'IAM User Without MFA',
            description: `IAM user "${user.userName}" does not have MFA enabled`,
            recommendation: 'Enable MFA for all IAM users, especially those with console access.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Check wildcard policies
      if (data?.wildcardPolicies && data.wildcardPolicies.length > 0) {
        for (const policy of data.wildcardPolicies) {
          findings.push({
            id: `finding-${Date.now()}-${policy.policyName}-wildcard`,
            checkType: 'IAM_POLICY_WILDCARD' as SecurityCheckType,
            severity: 'HIGH' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: policy.policyArn,
            resourceType: 'IAM',
            resourceName: policy.policyName,
            region: 'global',
            profile,
            title: 'IAM Policy With Wildcard Permissions',
            description: `IAM policy "${policy.policyName}" has wildcard (*) for both actions and resources`,
            recommendation: 'Follow principle of least privilege. Grant only specific permissions needed.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Check old access keys
      if (data?.oldAccessKeys && data.oldAccessKeys.length > 0) {
        for (const key of data.oldAccessKeys) {
          findings.push({
            id: `finding-${Date.now()}-${key.userName}-oldkey`,
            checkType: 'IAM_ACCESS_KEY_NOT_ROTATED' as SecurityCheckType,
            severity: 'MEDIUM' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: key.userName,
            resourceType: 'IAM',
            region: 'global',
            profile,
            title: 'IAM Access Key Not Rotated',
            description: `IAM user "${key.userName}" has access key not rotated in ${key.daysSinceRotation} days`,
            recommendation: 'Rotate access keys at least every 90 days as a security best practice.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Check password policy
      if (data?.passwordPolicy && !data.passwordPolicy.configured) {
        findings.push({
          id: `finding-${Date.now()}-password-policy`,
          checkType: 'IAM_PASSWORD_POLICY_WEAK' as SecurityCheckType,
          severity: 'MEDIUM' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: 'account',
          resourceType: 'IAM',
          region: 'global',
          profile,
          title: 'IAM Password Policy Not Configured',
          description: `Account password policy is not configured or is weak`,
          recommendation: 'Configure a strong password policy with minimum length 14, require uppercase, lowercase, numbers, and symbols.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      console.error('[SecurityAudit] IAM audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit KMS key security
   */
  private async auditKMSSecurity(profile: string, region: string): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, check KMS keys in ${region} for profile ${profile}.

Execute:
1. aws kms list-keys --region ${region}
2. For each customer-managed key, check: aws kms get-key-rotation-status --key-id <KeyId> --region ${region}

Return JSON:
{
  "keys": [
    {"keyId": "key-id", "rotationEnabled": true/false}
  ]
}`;

      const responsePromise = this.claudeService.query(prompt);
      const response = await this.withTimeout(responsePromise, 60000, `KMS audit for ${region}`);

      if (!response) {
        console.warn(`[SecurityAudit] KMS audit timed out for ${region}`);
        findings.push(this.createTimeoutFinding('KMS', region, profile, 'KMS security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      if (data?.keys) {
        for (const key of data.keys) {
          if (!key.rotationEnabled) {
            findings.push({
              id: `finding-${Date.now()}-${key.keyId}-rotation`,
              checkType: 'KMS_KEY_ROTATION_DISABLED' as SecurityCheckType,
              severity: 'MEDIUM' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: key.keyId,
              resourceType: 'KMS',
              region,
              profile,
              title: 'KMS Key Rotation Disabled',
              description: `KMS key "${key.keyId}" does not have automatic rotation enabled`,
              recommendation: 'Enable automatic key rotation for customer-managed KMS keys to improve security.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[SecurityAudit] KMS audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit CloudTrail security (global check)
   */
  private async auditCloudTrailSecurity(profile: string): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, check CloudTrail for profile ${profile}.

Execute:
1. aws cloudtrail describe-trails
2. aws cloudtrail get-trail-status --name <TrailName> for each trail

Check:
1. If CloudTrail is enabled in all regions (IsMultiRegionTrail=true, IsLogging=true)
2. If CloudTrail logs are encrypted (KmsKeyId present)

Return JSON:
{
  "trails": [
    {
      "name": "trail-name",
      "isMultiRegion": true/false,
      "isLogging": true/false,
      "encrypted": true/false
    }
  ]
}`;

      const responsePromise = this.claudeService.query(prompt, 60000);
      const response = await this.withTimeout(responsePromise, 60000, `CloudTrail audit`);

      if (!response) {
        console.warn(`[SecurityAudit] CloudTrail audit timed out`);
        findings.push(this.createTimeoutFinding('CloudTrail', 'global', profile, 'CloudTrail security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      if (!data?.trails || data.trails.length === 0) {
        findings.push({
          id: `finding-${Date.now()}-cloudtrail-missing`,
          checkType: 'CLOUDTRAIL_NOT_ENABLED' as SecurityCheckType,
          severity: 'HIGH' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: 'account',
          resourceType: 'CloudTrail',
          region: 'global',
          profile,
          title: 'CloudTrail Not Enabled',
          description: `No CloudTrail trails found in the account`,
          recommendation: 'Enable CloudTrail in all regions for comprehensive audit logging.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        for (const trail of data.trails) {
          if (!trail.isMultiRegion || !trail.isLogging) {
            findings.push({
              id: `finding-${Date.now()}-${trail.name}-multiregion`,
              checkType: 'CLOUDTRAIL_NOT_ENABLED' as SecurityCheckType,
              severity: 'HIGH' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: trail.name,
              resourceType: 'CloudTrail',
              region: 'global',
              profile,
              title: 'CloudTrail Not Enabled in All Regions',
              description: `CloudTrail trail "${trail.name}" is not logging or not multi-region`,
              recommendation: 'Enable multi-region CloudTrail to capture events across all regions.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          if (!trail.encrypted) {
            findings.push({
              id: `finding-${Date.now()}-${trail.name}-encryption`,
              checkType: 'CLOUDTRAIL_LOGS_NOT_ENCRYPTED' as SecurityCheckType,
              severity: 'MEDIUM' as FindingSeverity,
              status: 'ACTIVE' as FindingStatus,
              resourceId: trail.name,
              resourceType: 'CloudTrail',
              region: 'global',
              profile,
              title: 'CloudTrail Logs Not Encrypted',
              description: `CloudTrail trail "${trail.name}" does not encrypt logs with KMS`,
              recommendation: 'Enable CloudTrail log encryption using AWS KMS for enhanced security.',
              detectedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[SecurityAudit] CloudTrail audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Audit GuardDuty status
   */
  private async auditGuardDutySecurity(profile: string, region: string): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    try {
      const prompt = `Using AWS MCP tools, check GuardDuty status in ${region} for profile ${profile}.

Execute:
1. aws guardduty list-detectors --region ${region}
2. If detectors found, check status: aws guardduty get-detector --detector-id <DetectorId> --region ${region}

Return JSON:
{
  "enabled": true/false,
  "detectorId": "detector-id-or-null"
}`;

      const responsePromise = this.claudeService.query(prompt);
      const response = await this.withTimeout(responsePromise, 60000, `GuardDuty audit for ${region}`);

      if (!response) {
        console.warn(`[SecurityAudit] GuardDuty audit timed out for ${region}`);
        findings.push(this.createTimeoutFinding('GuardDuty', region, profile, 'GuardDuty security check timed out'));
        return findings;
      }

      const data = this.extractJSON(response.content);

      if (!data?.enabled) {
        findings.push({
          id: `finding-${Date.now()}-guardduty-${region}`,
          checkType: 'GUARDDUTY_NOT_ENABLED' as SecurityCheckType,
          severity: 'HIGH' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: region,
          resourceType: 'GuardDuty',
          region,
          profile,
          title: 'GuardDuty Not Enabled',
          description: `GuardDuty is not enabled in region ${region}`,
          recommendation: 'Enable GuardDuty for intelligent threat detection and continuous monitoring.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      console.error('[SecurityAudit] GuardDuty audit failed:', error.message);
    }

    return findings;
  }

  /**
   * Get all findings
   * Reads from cache first, falls back to in-memory Map
   */
  getFindings(filters?: {
    profile?: string;
    region?: string;
    severity?: FindingSeverity;
    status?: FindingStatus;
  }): SecurityFinding[] {
    let findings: SecurityFinding[] = [];

    // Try to get findings from cache if profile is specified
    if (filters?.profile) {
      if (filters.region) {
        // Get findings for specific profile and region from cache
        const cacheKey = `security:${filters.profile}:${filters.region}`;
        const cachedFindings = cacheService.get<SecurityFinding[]>(cacheKey);
        if (cachedFindings) {
          findings = cachedFindings;
          console.log(`[SecurityAudit] Retrieved ${findings.length} findings from cache for ${filters.profile}/${filters.region}`);
        }
      } else {
        // Get findings for all regions of a profile from cache
        const cacheKeys = cacheService.getKeys().filter(key => key.startsWith(`security:${filters.profile}:`));
        for (const key of cacheKeys) {
          const cachedFindings = cacheService.get<SecurityFinding[]>(key);
          if (cachedFindings) {
            findings.push(...cachedFindings);
          }
        }
        console.log(`[SecurityAudit] Retrieved ${findings.length} findings from cache for profile ${filters.profile}`);
      }
    }

    // Fall back to in-memory Map if no cache results
    if (findings.length === 0) {
      findings = Array.from(this.findings.values());
      console.log(`[SecurityAudit] Retrieved ${findings.length} findings from in-memory Map`);
    }

    // Apply filters
    if (filters?.profile && findings.length > 0) {
      findings = findings.filter((f) => f.profile === filters.profile);
    }
    if (filters?.region && findings.length > 0) {
      findings = findings.filter((f) => f.region === filters.region);
    }
    if (filters?.severity) {
      findings = findings.filter((f) => f.severity === filters.severity);
    }
    if (filters?.status) {
      findings = findings.filter((f) => f.status === filters.status);
    }

    return findings;
  }

  /**
   * Get compliance report
   * Reads findings from cache (via getFindings which checks cache first)
   */
  getComplianceReport(profile: string, region: string): ComplianceReport {
    // Get findings from cache first, then in-memory Map
    const findings = this.getFindings({ profile, region, status: 'ACTIVE' as FindingStatus });

    console.log(`[SecurityAudit] Compliance report for ${profile}/${region}: ${findings.length} active findings`);

    // Define compliance rules (each rule represents a specific security requirement)
    const complianceRules = {
      'S3_ENCRYPTION': 'S3_BUCKET_ENCRYPTION',
      'S3_VERSIONING': 'S3_BUCKET_VERSIONING',
      'S3_PUBLIC_ACCESS': 'S3_BUCKET_PUBLIC_ACCESS',
      'EBS_ENCRYPTION': 'EC2_UNENCRYPTED_VOLUME',
      'VPC_FLOW_LOGS': 'VPC_FLOW_LOGS_DISABLED',
      'RDS_ENCRYPTION': 'RDS_UNENCRYPTED',
      'RDS_PUBLIC_ACCESS': 'RDS_PUBLIC_ACCESS',
      'RDS_BACKUP': 'RDS_NO_BACKUP',
      'LAMBDA_RUNTIME': 'LAMBDA_OLD_RUNTIME',
      'IAM_MFA': 'IAM_USER_NO_MFA',
    };

    const totalRules = Object.keys(complianceRules).length;

    // Count which rules have violations
    const rulesWithViolations = new Set<string>();
    findings.forEach((finding) => {
      Object.entries(complianceRules).forEach(([ruleName, checkType]) => {
        if (finding.checkType === checkType) {
          rulesWithViolations.add(ruleName);
        }
      });
    });

    const failedRules = rulesWithViolations.size;
    const passedRules = totalRules - failedRules;

    // Calculate compliance score as percentage of rules that passed
    const complianceScore = totalRules === 0 ? 0 : Math.round((passedRules / totalRules) * 100);

    console.log(`[SecurityAudit] Compliance score: ${passedRules}/${totalRules} rules passed = ${complianceScore}%`);

    // For backwards compatibility, also track total checks (individual findings)
    const totalChecks = totalRules; // Use rules count as check count
    const failedChecks = failedRules;
    const passedChecks = passedRules;

    const findingsBySeverity = {
      critical: findings.filter((f) => f.severity === 'CRITICAL').length,
      high: findings.filter((f) => f.severity === 'HIGH').length,
      medium: findings.filter((f) => f.severity === 'MEDIUM').length,
      low: findings.filter((f) => f.severity === 'LOW').length,
      info: findings.filter((f) => f.severity === 'INFO').length,
    };

    const findingsByType: Record<string, number> = {};
    findings.forEach((f) => {
      findingsByType[f.checkType] = (findingsByType[f.checkType] || 0) + 1;
    });

    return {
      profile,
      region,
      scanDate: new Date().toISOString(),
      totalChecks,
      passedChecks,
      failedChecks,
      complianceScore,
      findingsBySeverity,
      findingsByType,
    };
  }

  /**
   * Update finding status
   */
  updateFinding(findingId: string, status: FindingStatus): boolean {
    const finding = this.findings.get(findingId);
    if (!finding) {
      return false;
    }

    finding.status = status;
    finding.updatedAt = new Date().toISOString();
    if (status === 'RESOLVED') {
      finding.resolvedAt = new Date().toISOString();
    }

    this.findings.set(findingId, finding);
    return true;
  }

  /**
   * Extract JSON from Claude response
   */
  private extractJSON(text: string): any {
    try {
      // Try to find JSON in code blocks
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // Try to find JSON object directly
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        return JSON.parse(objectMatch[0]);
      }

      return null;
    } catch (error) {
      console.error('[SecurityAudit] Failed to parse JSON:', error);
      return null;
    }
  }
}
