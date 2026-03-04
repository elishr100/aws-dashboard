import type {
  AWSResource,
  ResourceInventory,
  EC2Instance,
  RDSInstance,
  LambdaFunction,
  S3Bucket,
  ECSCluster,
} from '../types/index.js';
import type {
  SecurityFinding,
  FindingSeverity,
  FindingStatus,
  SecurityCheckType,
} from '../types/security.js';

/**
 * SecurityAuditAgent - Analyzes cached resources for security issues
 *
 * This agent performs security checks on already-discovered resources
 * without making additional AWS API calls.
 */
export class SecurityAuditAgent {
  /**
   * Audit all resources in the inventory for security issues
   */
  async auditResources(
    inventory: ResourceInventory,
    profile: string,
    region: string
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];

    console.log(`[SecurityAuditAgent] Auditing ${inventory.resources.length} resources in ${region}`);

    // Group resources by type for efficient processing
    const resourcesByType = this.groupResourcesByType(inventory.resources);

    // Run all security checks
    findings.push(...this.checkEC2Security(resourcesByType.EC2 || [], profile, region));
    findings.push(...this.checkRDSSecurity(resourcesByType.RDS || [], profile, region));
    findings.push(...this.checkLambdaSecurity(resourcesByType.Lambda || [], profile, region));
    findings.push(...this.checkS3Security(resourcesByType.S3 || [], profile, region));
    findings.push(...this.checkECSSecurity(resourcesByType.ECS || [], profile, region));
    findings.push(...this.checkResourceTags(inventory.resources, profile, region));

    console.log(`[SecurityAuditAgent] Found ${findings.length} security issues`);

    return findings;
  }

  /**
   * Check EC2 instance security
   */
  private checkEC2Security(
    instances: AWSResource[],
    profile: string,
    region: string
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const resource of instances) {
      const instance = resource.details as EC2Instance;

      // Check for unencrypted EBS volumes
      if (instance.blockDeviceMappings) {
        const unencryptedVolumes = instance.blockDeviceMappings.filter(
          (device: any) => device.ebs && device.ebs.encrypted === false
        );

        if (unencryptedVolumes.length > 0) {
          findings.push({
            id: `finding-${Date.now()}-${resource.id}-unencrypted-ebs`,
            checkType: 'EC2_UNENCRYPTED_VOLUME' as SecurityCheckType,
            severity: 'CRITICAL' as FindingSeverity,
            status: 'ACTIVE' as FindingStatus,
            resourceId: resource.id,
            resourceType: 'EC2',
            resourceName: resource.name,
            region,
            profile,
            title: 'Unencrypted EBS Volumes',
            description: `EC2 instance "${resource.name || resource.id}" has ${unencryptedVolumes.length} unencrypted EBS volume(s). This exposes data at rest to potential security risks.`,
            recommendation: 'Enable EBS encryption for all volumes. Create encrypted snapshots and restore them as encrypted volumes, then detach unencrypted volumes and attach encrypted ones.',
            detectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {
              unencryptedVolumes: unencryptedVolumes.map((v: any) => v.ebs?.volumeId).filter(Boolean),
            },
          });
        }
      }

      // Check for IMDSv2 not enforced
      if (instance.metadataOptions?.httpTokens !== 'required') {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-imdsv2`,
          checkType: 'EC2_INSTANCE_PUBLIC_IP' as SecurityCheckType,
          severity: 'HIGH' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'EC2',
          resourceName: resource.name,
          region,
          profile,
          title: 'IMDSv2 Not Enforced',
          description: `EC2 instance "${resource.name || resource.id}" does not require IMDSv2. IMDSv1 is vulnerable to SSRF attacks that can leak instance credentials.`,
          recommendation: 'Modify instance metadata options to require IMDSv2 by setting HttpTokens to "required". Use AWS CLI: aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            currentSetting: instance.metadataOptions?.httpTokens || 'optional',
          },
        });
      }
    }

    return findings;
  }

  /**
   * Check RDS security
   */
  private checkRDSSecurity(
    instances: AWSResource[],
    profile: string,
    region: string
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const resource of instances) {
      const db = resource.details as RDSInstance;

      // Check for single-AZ configuration
      if (!db.multiAZ) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-single-az`,
          checkType: 'RDS_PUBLIC_ACCESS' as SecurityCheckType,
          severity: 'MEDIUM' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'RDS',
          resourceName: resource.name,
          region,
          profile,
          title: 'RDS Single-AZ Configuration',
          description: `RDS instance "${resource.name || resource.id}" is configured with single-AZ deployment. This provides no failover capability in case of AZ failure.`,
          recommendation: 'Enable Multi-AZ deployment for production databases to ensure high availability and automatic failover.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Check backup retention
      const backupRetention = db.backupRetentionPeriod || 0;
      if (backupRetention < 7) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-backup-retention`,
          checkType: 'RDS_NO_BACKUP' as SecurityCheckType,
          severity: 'LOW' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'RDS',
          resourceName: resource.name,
          region,
          profile,
          title: 'Insufficient RDS Backup Retention',
          description: `RDS instance "${resource.name || resource.id}" has backup retention period of ${backupRetention} days. Recommended minimum is 7 days for compliance and disaster recovery.`,
          recommendation: 'Increase backup retention period to at least 7 days. For production databases, consider 14-30 days.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            currentRetention: backupRetention,
            recommendedRetention: 7,
          },
        });
      }

      // Check for public accessibility
      if (db.publiclyAccessible) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-public`,
          checkType: 'RDS_PUBLIC_ACCESS' as SecurityCheckType,
          severity: 'HIGH' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'RDS',
          resourceName: resource.name,
          region,
          profile,
          title: 'RDS Instance Publicly Accessible',
          description: `RDS instance "${resource.name || resource.id}" is publicly accessible. This exposes the database to potential attacks from the internet.`,
          recommendation: 'Disable public accessibility and use VPN or AWS PrivateLink for remote access.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Check for encryption
      if (!db.storageEncrypted) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-encryption`,
          checkType: 'RDS_UNENCRYPTED' as SecurityCheckType,
          severity: 'CRITICAL' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'RDS',
          resourceName: resource.name,
          region,
          profile,
          title: 'RDS Instance Not Encrypted',
          description: `RDS instance "${resource.name || resource.id}" does not have storage encryption enabled.`,
          recommendation: 'Enable encryption at rest. Note: You must create an encrypted snapshot and restore it as encryption cannot be enabled on existing instances.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Check Lambda function security
   */
  private checkLambdaSecurity(
    functions: AWSResource[],
    profile: string,
    region: string
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    const deprecatedRuntimes = [
      'nodejs16.x', 'nodejs14.x', 'nodejs12.x', 'nodejs10.x',
      'python3.7', 'python3.6', 'python2.7',
      'ruby2.7', 'ruby2.5',
      'dotnetcore3.1', 'dotnetcore2.1',
      'go1.x'
    ];

    for (const resource of functions) {
      const lambda = resource.details as LambdaFunction;

      // Check for deprecated runtimes
      if (lambda.runtime && deprecatedRuntimes.includes(lambda.runtime)) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-runtime`,
          checkType: 'LAMBDA_OLD_RUNTIME' as SecurityCheckType,
          severity: 'MEDIUM' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'Lambda',
          resourceName: resource.name,
          region,
          profile,
          title: 'Lambda Function Using Deprecated Runtime',
          description: `Lambda function "${resource.name || resource.id}" is using deprecated runtime ${lambda.runtime}. Deprecated runtimes no longer receive security updates and may stop working.`,
          recommendation: `Update to a supported runtime version. For Node.js, use nodejs20.x or nodejs18.x. For Python, use python3.12 or python3.11.`,
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            currentRuntime: lambda.runtime,
          },
        });
      }
    }

    return findings;
  }

  /**
   * Check S3 bucket security
   */
  private checkS3Security(
    buckets: AWSResource[],
    profile: string,
    region: string
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const resource of buckets) {
      const bucket = resource.details as S3Bucket;

      // Check for versioning
      if (!bucket.versioning || bucket.versioning.status !== 'Enabled') {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-versioning`,
          checkType: 'S3_BUCKET_VERSIONING' as SecurityCheckType,
          severity: 'MEDIUM' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'S3',
          resourceName: resource.name,
          region,
          profile,
          title: 'S3 Bucket Versioning Disabled',
          description: `S3 bucket "${resource.name || resource.id}" does not have versioning enabled. Without versioning, deleted or overwritten objects cannot be recovered.`,
          recommendation: 'Enable versioning to protect against accidental deletion and provide audit trail. Use lifecycle policies to manage old versions.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Check for encryption
      if (!bucket.encryption) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-encryption`,
          checkType: 'S3_BUCKET_ENCRYPTION' as SecurityCheckType,
          severity: 'HIGH' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'S3',
          resourceName: resource.name,
          region,
          profile,
          title: 'S3 Bucket Not Encrypted',
          description: `S3 bucket "${resource.name || resource.id}" does not have default encryption enabled.`,
          recommendation: 'Enable default encryption using AWS KMS or AES-256 (SSE-S3).',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // Check for public access
      if (bucket.publicAccessBlock === false || !bucket.publicAccessBlock) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-public`,
          checkType: 'S3_BUCKET_PUBLIC_ACCESS' as SecurityCheckType,
          severity: 'CRITICAL' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'S3',
          resourceName: resource.name,
          region,
          profile,
          title: 'S3 Bucket Public Access Not Blocked',
          description: `S3 bucket "${resource.name || resource.id}" may allow public access. This could expose sensitive data.`,
          recommendation: 'Enable Block Public Access settings unless public access is explicitly required.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Check ECS security
   */
  private checkECSSecurity(
    clusters: AWSResource[],
    profile: string,
    region: string
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const resource of clusters) {
      const cluster = resource.details as ECSCluster;

      // Check if monitoring is disabled
      const hasMonitoring = cluster.settings?.some(
        (setting: any) => setting.name === 'containerInsights' && setting.value === 'enabled'
      );

      if (!hasMonitoring) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-monitoring`,
          checkType: 'EC2_INSTANCE_PUBLIC_IP' as SecurityCheckType,
          severity: 'LOW' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: 'ECS',
          resourceName: resource.name,
          region,
          profile,
          title: 'ECS Container Insights Disabled',
          description: `ECS cluster "${resource.name || resource.id}" does not have Container Insights enabled. This limits visibility into container performance and metrics.`,
          recommendation: 'Enable Container Insights for better monitoring and troubleshooting. Note: This incurs additional CloudWatch costs.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Check for missing required tags
   */
  private checkResourceTags(
    resources: AWSResource[],
    profile: string,
    region: string
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    const requiredTags = ['Environment', 'Owner', 'Project', 'CostCenter'];

    for (const resource of resources) {
      const tags = resource.tags || [];
      const tagKeys = tags.map(t => t.key);
      const missingTags = requiredTags.filter(tag => !tagKeys.includes(tag));

      if (missingTags.length > 0) {
        findings.push({
          id: `finding-${Date.now()}-${resource.id}-tags`,
          checkType: 'EC2_OLD_AMI' as SecurityCheckType,
          severity: 'MEDIUM' as FindingSeverity,
          status: 'ACTIVE' as FindingStatus,
          resourceId: resource.id,
          resourceType: resource.type,
          resourceName: resource.name,
          region,
          profile,
          title: 'Missing Required Tags',
          description: `Resource "${resource.name || resource.id}" is missing required tags: ${missingTags.join(', ')}. Tags are essential for cost allocation, governance, and automation.`,
          recommendation: 'Add required tags to all resources following your organization\'s tagging strategy.',
          detectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            missingTags,
            existingTags: tagKeys,
          },
        });
      }
    }

    return findings;
  }

  /**
   * Group resources by type for efficient processing
   */
  private groupResourcesByType(resources: AWSResource[]): Record<string, AWSResource[]> {
    const grouped: Record<string, AWSResource[]> = {};

    for (const resource of resources) {
      if (!grouped[resource.type]) {
        grouped[resource.type] = [];
      }
      grouped[resource.type].push(resource);
    }

    return grouped;
  }
}
