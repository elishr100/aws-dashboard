import { ClaudeMCPService } from '../services/ClaudeMCPService.js';

export interface AWSResource {
  id: string;
  name?: string;
  type: 'EC2' | 'VPC' | 'S3' | 'RDS' | 'Lambda' | 'ELB' | 'NAT' | 'SecurityGroup' | 'DynamoDB' | 'IAMRole' |
        'IAMUser' | 'IAMPolicy' | 'ECR' | 'SQS' | 'SNS' | 'CloudWatchAlarm' | 'SecretsManager' | 'KMS' |
        'GuardDuty' | 'WAF' | 'Route53' | 'CloudTrail' | 'ClassicELB' | 'Bedrock';
  region: string;
  state?: string;
  vpcId?: string;
  tags?: Record<string, string>;
  metadata?: any;
}

export interface ResourceInventory {
  resources: AWSResource[];
  fetchedAt: string;
  profile: string;
  region: string;
  errors?: string[];
}

export class ResourceDiscoveryAgent {
  private claudeService: ClaudeMCPService;
  private static readonly TOOL_CALL_TIMEOUT = 300000; // 300 seconds (5 minutes) per tool call - needed for IAM with many roles
  private static readonly REGION_SCAN_TIMEOUT = 600000; // 600 seconds per region
  private progressCallback?: (resourceCount: number) => void;

  /**
   * Constructor with dependency injection for ClaudeMCPService
   * This ensures a single shared instance with synchronized credentials
   */
  constructor(claudeService: ClaudeMCPService) {
    this.claudeService = claudeService;
    console.log(`[ResourceDiscovery] Initialized with shared ClaudeMCPService instance`);
  }

  /**
   * Set progress callback for real-time updates
   */
  setProgressCallback(callback: (resourceCount: number) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Discover all resources in the specified region using parallel tool calls
   *
   * ⚠️  CRITICAL: IAM IS GLOBAL - DO NOT PUT IN REGION LOOP ⚠️
   * IAM roles must be discovered ONCE per account using discoverIAMRoles()
   * Adding IAM here will cause it to be scanned multiple times (once per region)
   * resulting in duplicate entries and inflated counts. IAM is called separately
   * in the scan route (scan.ts) BEFORE the region loop starts.
   */
  async discoverAll(region: string): Promise<ResourceInventory> {
    console.log(`[ResourceDiscovery] Starting parallel discovery for ${this.claudeService.getProfile()} in ${region}`);

    const errors: string[] = [];
    const resources: AWSResource[] = [];

    // Create individual discovery tasks for each resource type
    // Using --query to limit fields and reduce response size for large resource types
    // NOTE: IAM, Route53, CloudTrail, and WAF Global ARE NOT INCLUDED HERE - THEY'RE GLOBAL SERVICES SCANNED SEPARATELY
    const discoveryTasks = [
      // VPC and Network
      this.discoverResourceType('VPC', region, `aws ec2 describe-vpcs --region ${region}`),
      this.discoverResourceType('NAT', region, `aws ec2 describe-nat-gateways --region ${region}`),
      this.discoverResourceType(
        'SecurityGroup',
        region,
        `aws ec2 describe-security-groups --region ${region} --query 'SecurityGroups[].{GroupId:GroupId,GroupName:GroupName,Description:Description,VpcId:VpcId,IpPermissions:IpPermissions}' --output json`
      ),

      // Compute
      this.discoverResourceType(
        'EC2',
        region,
        `aws ec2 describe-instances --region ${region} --query 'Reservations[].Instances[].{InstanceId:InstanceId,State:State.Name,VpcId:VpcId,InstanceType:InstanceType,PrivateIpAddress:PrivateIpAddress,PublicIpAddress:PublicIpAddress,MetadataOptions:MetadataOptions,BlockDeviceMappings:BlockDeviceMappings,Tags:Tags}' --output json`
      ),
      this.discoverResourceType(
        'Lambda',
        region,
        `aws lambda list-functions --region ${region} --query 'Functions[].{FunctionName:FunctionName,Runtime:Runtime,VpcConfig:VpcConfig.VpcId,State:State}' --output json`
      ),

      // Load Balancers
      this.discoverResourceType(
        'ELB',
        region,
        `aws elbv2 describe-load-balancers --region ${region} --query 'LoadBalancers[].{LoadBalancerArn:LoadBalancerArn,LoadBalancerName:LoadBalancerName,State:State.Code,Type:Type,VpcId:VpcId}' --output json`
      ),
      this.discoverResourceType(
        'ClassicELB',
        region,
        `aws elb describe-load-balancers --region ${region} --query 'LoadBalancerDescriptions[].{LoadBalancerName:LoadBalancerName,DNSName:DNSName,VPCId:VPCId}' --output json`
      ),

      // Storage
      this.discoverResourceType(
        'S3',
        region,
        `aws s3api list-buckets --query 'Buckets[].{Name:Name,CreationDate:CreationDate}' --output json`
      ),
      this.discoverResourceType(
        'ECR',
        region,
        `aws ecr describe-repositories --region ${region} --query 'repositories[].{repositoryName:repositoryName,repositoryArn:repositoryArn,createdAt:createdAt}' --output json`
      ),

      // Database
      this.discoverResourceType(
        'RDS',
        region,
        `aws rds describe-db-instances --region ${region} --query 'DBInstances[].{DBInstanceIdentifier:DBInstanceIdentifier,DBInstanceStatus:DBInstanceStatus,Engine:Engine,DBInstanceClass:DBInstanceClass,VpcId:DBSubnetGroup.VpcId,PubliclyAccessible:PubliclyAccessible,StorageEncrypted:StorageEncrypted,MultiAZ:MultiAZ}' --output json`
      ),
      this.discoverResourceType(
        'DynamoDB',
        region,
        `aws dynamodb list-tables --region ${region} --query 'TableNames' --output json`
      ),

      // Messaging
      this.discoverResourceType(
        'SQS',
        region,
        `aws sqs list-queues --region ${region} --output json`
      ),
      this.discoverResourceType(
        'SNS',
        region,
        `aws sns list-topics --region ${region} --output json`
      ),

      // Monitoring & Security
      this.discoverResourceType(
        'CloudWatchAlarm',
        region,
        `aws cloudwatch describe-alarms --region ${region} --query 'MetricAlarms[].{AlarmName:AlarmName,AlarmArn:AlarmArn,StateValue:StateValue}' --output json`
      ),
      this.discoverResourceType(
        'SecretsManager',
        region,
        `aws secretsmanager list-secrets --region ${region} --query 'SecretList[].{Name:Name,ARN:ARN,LastChangedDate:LastChangedDate}' --output json`
      ),
      // KMS - will need to filter for customer-managed keys in post-processing
      this.discoverKMSKeys(region),
      this.discoverResourceType(
        'GuardDuty',
        region,
        `aws guardduty list-detectors --region ${region} --output json`
      ),
      this.discoverResourceType(
        'WAF',
        region,
        `aws wafv2 list-web-acls --scope REGIONAL --region ${region} --query 'WebACLs[].{Name:Name,Id:Id,ARN:ARN}' --output json`
      ),
    ];

    // Wrap all tasks with region-level timeout
    const regionTimeoutPromise = this.withTimeout(
      Promise.allSettled(discoveryTasks),
      ResourceDiscoveryAgent.REGION_SCAN_TIMEOUT,
      `Region scan timeout for ${region}`
    );

    try {
      const results = await regionTimeoutPromise;

      // Process results from all parallel tasks and report progress in real-time
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          resources.push(...result.value.resources);

          // Report progress after each resource type is discovered
          if (this.progressCallback && result.value.resources.length > 0) {
            this.progressCallback(resources.length);
          }

          if (result.value.errors && result.value.errors.length > 0) {
            errors.push(...result.value.errors);
          }
        } else if (result.status === 'rejected') {
          errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      }
    } catch (error) {
      console.error('[ResourceDiscovery] Region scan timeout or error:', error);
      errors.push(error instanceof Error ? error.message : 'Region scan timeout');
    }

    // Summarize results with clear error indication
    const credentialErrors = errors.filter(e => e.includes('CREDENTIAL_ERROR'));
    const otherErrors = errors.filter(e => !e.includes('CREDENTIAL_ERROR'));

    console.log(`\n[ResourceDiscovery] ========== SUMMARY for ${region} ==========`);
    console.log(`[ResourceDiscovery] Total resources found: ${resources.length}`);
    console.log(`[ResourceDiscovery] Total errors: ${errors.length}`);

    if (credentialErrors.length > 0) {
      console.error(`[ResourceDiscovery] ⚠️  CRITICAL: ${credentialErrors.length} credential error(s):`);
      credentialErrors.forEach((err, idx) => {
        console.error(`[ResourceDiscovery]   ${idx + 1}. ${err}`);
      });
    }

    if (otherErrors.length > 0) {
      console.log(`[ResourceDiscovery] Other errors (${otherErrors.length}):`);
      otherErrors.forEach((err, idx) => {
        console.log(`[ResourceDiscovery]   ${idx + 1}. ${err}`);
      });
    }

    if (errors.length === 0) {
      console.log(`[ResourceDiscovery] ✅ All resource types scanned successfully (no errors)`);
    }
    console.log(`[ResourceDiscovery] ==========================================\n`);

    return {
      resources,
      fetchedAt: new Date().toISOString(),
      profile: this.claudeService.getProfile(),
      region,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Discover a specific resource type with timeout
   */
  private async discoverResourceType(
    resourceType: string,
    region: string,
    awsCommand: string
  ): Promise<{ resources: AWSResource[]; errors: string[] }> {
    const errors: string[] = [];
    const resources: AWSResource[] = [];

    console.log(`[ResourceDiscovery] Discovering ${resourceType} in ${region}`);

    const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${awsCommand}

Parse the AWS CLI output and return ONLY a JSON object with this structure:
{
  "resources": [
    {
      "id": "resource-id",
      "name": "resource-name",
      "type": "${resourceType}",
      "region": "${region}",
      "state": "state",
      "vpcId": "vpc-xxx",
      "tags": {},
      "metadata": {}
    }
  ]
}

Notes:
- For EC2: Use InstanceId as id, State as state
- For SecurityGroup: Use GroupId as id, GroupName as name
- For S3: Use bucket Name as both id and name
- For RDS: Use DBInstanceIdentifier as both id and name, DBInstanceStatus as state
- For Lambda: Use FunctionName as both id and name, State as state
- For ELB: Use LoadBalancerArn as id, LoadBalancerName as name, State as state
- For DynamoDB: Use table name as both id and name
- For IAMRole: Use RoleId as id, RoleName as name, and region should be "global"
- Extract and map all available fields from the AWS CLI response
- If there are no resources, return: {"resources": []}
- If there's an error, return: {"resources": [], "error": "error message"}

Do NOT include markdown formatting, explanations, or code fences. Return ONLY valid JSON.`;

    try {
      const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
      const parsed = this.parseResourceResponse(response.content, resourceType, region);
      resources.push(...parsed.resources);

      if (parsed.error) {
        errors.push(`${resourceType}: ${parsed.error}`);
      }

      console.log(`[ResourceDiscovery] ${resourceType} in ${region}: Found ${resources.length} resources`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // CRITICAL: Check for credential failures explicitly
      const isCredentialError =
        errorMsg.includes('ExpiredToken') ||
        errorMsg.includes('InvalidClientTokenId') ||
        errorMsg.includes('UnrecognizedClientException') ||
        errorMsg.includes('RequestExpired') ||
        errorMsg.includes('credential') ||
        errorMsg.includes('expired');

      // Extract AWS error code if present for better debugging
      const errorCodeMatch = errorMsg.match(/\[(ExpiredToken|InvalidClientTokenId|AccessDenied|UnauthorizedOperation|RequestExpired|UnrecognizedClientException)\]/);
      const errorCode = errorCodeMatch ? errorCodeMatch[1] : null;

      if (isCredentialError) {
        console.error(`[ResourceDiscovery] CREDENTIAL ERROR discovering ${resourceType}:`, errorMsg);
        errors.push(`${resourceType} [CREDENTIAL_ERROR]: ${errorMsg}`);
      } else if (errorCode) {
        console.error(`[ResourceDiscovery] Error discovering ${resourceType} [${errorCode}]:`, errorMsg);
        errors.push(`${resourceType} [${errorCode}]: ${errorMsg}`);
      } else {
        console.error(`[ResourceDiscovery] Error discovering ${resourceType}:`, errorMsg);
        errors.push(`${resourceType}: ${errorMsg}`);
      }

      // Log zero resources as a warning
      console.warn(`[ResourceDiscovery] ${resourceType} in ${region}: 0 resources (ERROR occurred)`);
    }

    return { resources, errors };
  }

  /**
   * Utility to wrap a promise with a timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
      ),
    ]);
  }

  /**
   * Parse response from a single resource type query
   */
  private parseResourceResponse(
    content: string,
    expectedType: string,
    region: string
  ): { resources: AWSResource[]; error?: string } {
    try {
      // Remove markdown code fences if present
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
      }

      const json = JSON.parse(cleaned);

      if (json.error) {
        return { resources: [], error: json.error };
      }

      if (json.resources && Array.isArray(json.resources)) {
        return {
          resources: json.resources.map((r: any) => ({
            ...r,
            type: expectedType,
            region,
          })),
        };
      }

      return { resources: [] };
    } catch (parseError) {
      console.warn(`[ResourceDiscovery] Failed to parse ${expectedType} response, attempting fallback`);
      return {
        resources: this.extractResourcesFromText(content, expectedType, region),
        error: 'Failed to parse JSON response',
      };
    }
  }

  /**
   * Extract resources from text for a specific type (fallback)
   */
  private extractResourcesFromText(text: string, type: string, region: string): AWSResource[] {
    const resources: AWSResource[] = [];

    switch (type) {
      case 'VPC':
        const vpcMatches = text.matchAll(/vpc-[a-f0-9]+/gi);
        for (const match of vpcMatches) {
          resources.push({ id: match[0], type: 'VPC', region, state: 'available' });
        }
        break;

      case 'EC2':
        const instanceMatches = text.matchAll(/i-[a-f0-9]+/gi);
        for (const match of instanceMatches) {
          resources.push({ id: match[0], type: 'EC2', region, state: 'running' });
        }
        break;

      case 'RDS':
        const rdsMatches = text.matchAll(/db-[a-zA-Z0-9-]+/gi);
        for (const match of rdsMatches) {
          resources.push({ id: match[0], type: 'RDS', region, state: 'available' });
        }
        break;

      case 'Lambda':
        const lambdaMatches = text.matchAll(/function[:\s]+([a-zA-Z0-9_-]+)/gi);
        for (const match of lambdaMatches) {
          if (match[1]) {
            resources.push({ id: match[1], name: match[1], type: 'Lambda', region });
          }
        }
        break;

      case 'NAT':
        const natMatches = text.matchAll(/nat-[a-f0-9]+/gi);
        for (const match of natMatches) {
          resources.push({ id: match[0], type: 'NAT', region, state: 'available' });
        }
        break;

      case 'SecurityGroup':
        const sgMatches = text.matchAll(/sg-[a-f0-9]+/gi);
        for (const match of sgMatches) {
          resources.push({ id: match[0], type: 'SecurityGroup', region });
        }
        break;

      case 'DynamoDB':
        // DynamoDB tables are returned as an array of strings
        const tableMatches = text.matchAll(/"([a-zA-Z0-9_.-]+)"/gi);
        for (const match of tableMatches) {
          if (match[1] && match[1].length > 0) {
            resources.push({ id: match[1], name: match[1], type: 'DynamoDB', region });
          }
        }
        break;

      case 'IAMRole':
        // IAM roles are returned as an array of strings (role names)
        const roleMatches = text.matchAll(/"([a-zA-Z0-9_+=,.@-]+)"/gi);
        for (const match of roleMatches) {
          if (match[1] && match[1].length > 0 && !match[1].includes('{')) {
            resources.push({ id: match[1], name: match[1], type: 'IAMRole', region: 'global' });
          }
        }
        break;
    }

    return resources;
  }


  /**
   * Discover IAM roles (global service - call once per account)
   * Handles pagination to fetch all roles (AWS returns max 100 per page by default)
   */
  async discoverIAMRoles(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering IAM roles (global service) with pagination`);

    const allRoles: AWSResource[] = [];
    let nextToken: string | undefined = undefined;
    let pageCount = 0;
    const maxPages = 20; // Safety limit (20 pages × 100 roles = 2000 roles max)
    let isTruncated = true;

    while (isTruncated && pageCount < maxPages) {
      pageCount++;
      console.log(`[ResourceDiscovery] Fetching IAM roles page ${pageCount}${nextToken ? ` (marker present)` : ''}`);

      // Build command WITHOUT --query to preserve NextToken and IsTruncated in response
      // This is critical for pagination to work
      const command = nextToken
        ? `aws iam list-roles --max-items 100 --starting-token "${nextToken}" --output json`
        : `aws iam list-roles --max-items 100 --output json`;

      // Use a custom prompt that instructs Claude to return both roles AND pagination info
      const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${command}

Parse the AWS CLI output and return ONLY a JSON object with this structure:
{
  "roles": [
    {
      "id": "RoleId",
      "name": "RoleName",
      "type": "IAMRole",
      "region": "global",
      "metadata": {
        "arn": "Arn",
        "createDate": "CreateDate"
      }
    }
  ],
  "nextToken": "value-of-NextToken-field-or-null",
  "isTruncated": true-or-false
}

IMPORTANT:
- Extract ALL roles from the Roles array in the response
- If the response contains a "NextToken" field, include its EXACT value in the nextToken field
- If the response contains "IsTruncated": true, set isTruncated to true
- For each role, use RoleId as id, RoleName as name, and region should be "global"
- If there are no more results, set nextToken to null and isTruncated to false

Do NOT include markdown formatting, explanations, or code fences. Return ONLY valid JSON.`;

      try {
        const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
        const parsed = this.parsePaginatedRoleResponse(response.content);

        // Add roles from this page
        allRoles.push(...parsed.roles);
        console.log(`[ResourceDiscovery] Page ${pageCount}: Found ${parsed.roles.length} roles (total so far: ${allRoles.length})`);

        // Update pagination state
        nextToken = parsed.nextToken || undefined;
        isTruncated = parsed.isTruncated && !!nextToken;

        // Log pagination state
        if (isTruncated && nextToken) {
          console.log(`[ResourceDiscovery] More pages available (IsTruncated=true, NextToken present)`);
        } else {
          console.log(`[ResourceDiscovery] Last page reached (IsTruncated=${parsed.isTruncated}, NextToken=${nextToken ? 'present' : 'null'})`);
        }
      } catch (error) {
        console.error(`[ResourceDiscovery] Error fetching page ${pageCount}:`, error);
        // Continue with what we have so far
        break;
      }
    }

    if (pageCount >= maxPages) {
      console.warn(`[ResourceDiscovery] Reached maximum page limit (${maxPages}), there may be more roles`);
    }

    // Deduplicate by RoleId (use id field which contains RoleId)
    const seenIds = new Set<string>();
    const uniqueRoles = allRoles.filter(role => {
      if (seenIds.has(role.id)) {
        console.warn(`[ResourceDiscovery] Duplicate IAM role detected: ${role.id} (${role.name})`);
        return false;
      }
      seenIds.add(role.id);
      return true;
    });

    console.log(`[ResourceDiscovery] IAM role discovery complete: Found ${uniqueRoles.length} unique IAM roles across ${pageCount} pages`);
    return uniqueRoles;
  }

  /**
   * Parse paginated role response with NextToken and IsTruncated
   */
  private parsePaginatedRoleResponse(content: string): {
    roles: AWSResource[];
    nextToken: string | null;
    isTruncated: boolean;
  } {
    try {
      // Remove markdown code fences if present
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
      }

      const json = JSON.parse(cleaned);

      return {
        roles: Array.isArray(json.roles) ? json.roles : [],
        nextToken: json.nextToken || json.NextToken || null,
        isTruncated: json.isTruncated || json.IsTruncated || false,
      };
    } catch (error) {
      console.warn(`[ResourceDiscovery] Failed to parse paginated role response:`, error);
      return { roles: [], nextToken: null, isTruncated: false };
    }
  }

  /**
   * Discover IAM users (global service - call once per account)
   * Handles pagination to fetch all users
   */
  async discoverIAMUsers(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering IAM users (global service) with pagination`);

    const allUsers: AWSResource[] = [];
    let nextToken: string | undefined = undefined;
    let pageCount = 0;
    const maxPages = 20;
    let isTruncated = true;

    while (isTruncated && pageCount < maxPages) {
      pageCount++;
      console.log(`[ResourceDiscovery] Fetching IAM users page ${pageCount}${nextToken ? ` (marker present)` : ''}`);

      const command = nextToken
        ? `aws iam list-users --max-items 100 --starting-token "${nextToken}" --output json`
        : `aws iam list-users --max-items 100 --output json`;

      const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${command}

Parse the AWS CLI output and return ONLY a JSON object with this structure:
{
  "users": [
    {
      "id": "UserId",
      "name": "UserName",
      "type": "IAMUser",
      "region": "global",
      "metadata": {
        "arn": "Arn",
        "createDate": "CreateDate"
      }
    }
  ],
  "nextToken": "value-of-NextToken-field-or-null",
  "isTruncated": true-or-false
}

Do NOT include markdown formatting. Return ONLY valid JSON.`;

      try {
        const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
        const parsed = this.parsePaginatedResponse(response.content, 'users');

        allUsers.push(...parsed.resources);
        console.log(`[ResourceDiscovery] Page ${pageCount}: Found ${parsed.resources.length} users (total: ${allUsers.length})`);

        nextToken = parsed.nextToken || undefined;
        isTruncated = parsed.isTruncated && !!nextToken;
      } catch (error) {
        console.error(`[ResourceDiscovery] Error fetching IAM users page ${pageCount}:`, error);
        break;
      }
    }

    console.log(`[ResourceDiscovery] IAM user discovery complete: Found ${allUsers.length} users across ${pageCount} pages`);
    return this.deduplicateResources(allUsers);
  }

  /**
   * Discover IAM policies (global service - call once per account)
   * Only fetches customer-managed policies (not AWS-managed)
   */
  async discoverIAMPolicies(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering IAM policies (customer-managed, global service)`);

    const allPolicies: AWSResource[] = [];
    let nextToken: string | undefined = undefined;
    let pageCount = 0;
    const maxPages = 20;
    let isTruncated = true;

    while (isTruncated && pageCount < maxPages) {
      pageCount++;

      const command = nextToken
        ? `aws iam list-policies --scope Local --max-items 100 --starting-token "${nextToken}" --output json`
        : `aws iam list-policies --scope Local --max-items 100 --output json`;

      const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${command}

Parse the AWS CLI output and return ONLY a JSON object with this structure:
{
  "policies": [
    {
      "id": "PolicyId",
      "name": "PolicyName",
      "type": "IAMPolicy",
      "region": "global",
      "metadata": {
        "arn": "Arn"
      }
    }
  ],
  "nextToken": "value-of-NextToken-field-or-null",
  "isTruncated": true-or-false
}

Do NOT include markdown formatting. Return ONLY valid JSON.`;

      try {
        const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
        const parsed = this.parsePaginatedResponse(response.content, 'policies');

        allPolicies.push(...parsed.resources);
        console.log(`[ResourceDiscovery] Page ${pageCount}: Found ${parsed.resources.length} policies (total: ${allPolicies.length})`);

        nextToken = parsed.nextToken || undefined;
        isTruncated = parsed.isTruncated && !!nextToken;
      } catch (error) {
        console.error(`[ResourceDiscovery] Error fetching IAM policies page ${pageCount}:`, error);
        break;
      }
    }

    console.log(`[ResourceDiscovery] IAM policy discovery complete: Found ${allPolicies.length} policies`);
    return this.deduplicateResources(allPolicies);
  }

  /**
   * Discover Route53 hosted zones (global service - call once per account)
   */
  async discoverRoute53Zones(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering Route53 hosted zones (global service)`);

    const command = `aws route53 list-hosted-zones --output json`;

    const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${command}

Parse the AWS CLI output and return ONLY a JSON object:
{
  "resources": [
    {
      "id": "HostedZoneId",
      "name": "Name",
      "type": "Route53",
      "region": "global"
    }
  ]
}

Do NOT include markdown formatting. Return ONLY valid JSON.`;

    try {
      const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
      const parsed = this.parseResourceResponse(response.content, 'Route53', 'global');
      console.log(`[ResourceDiscovery] Found ${parsed.resources.length} Route53 hosted zones`);
      return parsed.resources;
    } catch (error) {
      console.error(`[ResourceDiscovery] Error discovering Route53 zones:`, error);
      return [];
    }
  }

  /**
   * Discover CloudTrail trails (global service - call once per account)
   */
  async discoverCloudTrailTrails(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering CloudTrail trails (global service)`);

    const command = `aws cloudtrail describe-trails --output json`;

    const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${command}

Parse the AWS CLI output and return ONLY a JSON object:
{
  "resources": [
    {
      "id": "TrailARN",
      "name": "Name",
      "type": "CloudTrail",
      "region": "global"
    }
  ]
}

Do NOT include markdown formatting. Return ONLY valid JSON.`;

    try {
      const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
      const parsed = this.parseResourceResponse(response.content, 'CloudTrail', 'global');
      console.log(`[ResourceDiscovery] Found ${parsed.resources.length} CloudTrail trails`);
      return parsed.resources;
    } catch (error) {
      console.error(`[ResourceDiscovery] Error discovering CloudTrail trails:`, error);
      return [];
    }
  }

  /**
   * Discover WAF Global Web ACLs (CloudFront scope - call once per account)
   */
  async discoverWAFGlobal(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering WAF Global Web ACLs (CloudFront scope, us-east-1)`);

    const command = `aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --output json`;

    const prompt = `Use the aws-mcp tool to execute this AWS CLI command:
${command}

Parse the AWS CLI output and return ONLY a JSON object:
{
  "resources": [
    {
      "id": "Id",
      "name": "Name",
      "type": "WAF",
      "region": "global"
    }
  ]
}

Do NOT include markdown formatting. Return ONLY valid JSON.`;

    try {
      const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
      const parsed = this.parseResourceResponse(response.content, 'WAF', 'global');
      console.log(`[ResourceDiscovery] Found ${parsed.resources.length} WAF Global Web ACLs`);
      return parsed.resources;
    } catch (error) {
      console.error(`[ResourceDiscovery] Error discovering WAF Global:`, error);
      return [];
    }
  }

  /**
   * Discover KMS customer-managed keys (filters for KeyManager=CUSTOMER and KeyState=Enabled)
   */
  private async discoverKMSKeys(region: string): Promise<{ resources: AWSResource[]; errors: string[] }> {
    console.log(`[ResourceDiscovery] Discovering KMS customer-managed keys in ${region}`);

    const errors: string[] = [];
    const resources: AWSResource[] = [];

    const prompt = `Use the aws-mcp tool to execute these AWS CLI commands to discover KMS keys:

1. First, list all KMS keys:
   aws kms list-keys --region ${region} --output json

2. For each key in the list, get its metadata to check if it's customer-managed and enabled:
   aws kms describe-key --key-id <KeyId> --region ${region} --output json

3. Filter to include ONLY keys where:
   - KeyMetadata.KeyManager == "CUSTOMER" (not "AWS")
   - KeyMetadata.KeyState == "Enabled"

Return ONLY a JSON object with this structure:
{
  "resources": [
    {
      "id": "KeyId",
      "name": "KeyId or Alias",
      "type": "KMS",
      "region": "${region}",
      "state": "Enabled",
      "metadata": {
        "arn": "Arn",
        "keyManager": "CUSTOMER",
        "keyState": "Enabled",
        "creationDate": "CreationDate"
      }
    }
  ]
}

IMPORTANT:
- Only include keys where KeyManager is "CUSTOMER" (skip AWS-managed keys)
- Only include keys where KeyState is "Enabled" (skip PendingDeletion, Disabled, etc.)
- If there are no customer-managed enabled keys, return: {"resources": []}

Do NOT include markdown formatting. Return ONLY valid JSON.`;

    try {
      const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
      const parsed = this.parseResourceResponse(response.content, 'KMS', region);
      resources.push(...parsed.resources);

      if (parsed.error) {
        errors.push(`KMS: ${parsed.error}`);
      }

      console.log(`[ResourceDiscovery] KMS in ${region}: Found ${resources.length} customer-managed enabled keys`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ResourceDiscovery] Error discovering KMS keys:`, errorMsg);
      errors.push(`KMS: ${errorMsg}`);
    }

    return { resources, errors };
  }

  /**
   * Generic paginated response parser
   */
  private parsePaginatedResponse(content: string, arrayKey: string): {
    resources: AWSResource[];
    nextToken: string | null;
    isTruncated: boolean;
  } {
    try {
      let cleaned = content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?$/g, '');
      }

      const json = JSON.parse(cleaned);

      return {
        resources: Array.isArray(json[arrayKey]) ? json[arrayKey] : [],
        nextToken: json.nextToken || json.NextToken || null,
        isTruncated: json.isTruncated || json.IsTruncated || false,
      };
    } catch (error) {
      console.warn(`[ResourceDiscovery] Failed to parse paginated response:`, error);
      return { resources: [], nextToken: null, isTruncated: false };
    }
  }

  /**
   * Deduplicate resources by ID
   */
  private deduplicateResources(resources: AWSResource[]): AWSResource[] {
    const seenIds = new Set<string>();
    return resources.filter(resource => {
      if (seenIds.has(resource.id)) {
        console.warn(`[ResourceDiscovery] Duplicate resource detected: ${resource.id} (${resource.name})`);
        return false;
      }
      seenIds.add(resource.id);
      return true;
    });
  }

  /**
   * Discover Bedrock usage as a global resource
   * Queries AWS Cost Explorer for current month Bedrock costs
   */
  async discoverBedrockUsage(): Promise<AWSResource[]> {
    console.log(`[ResourceDiscovery] Discovering Bedrock usage (global service)`);

    const resources: AWSResource[] = [];
    const profile = this.claudeService.getProfile();

    // Get first and last day of current month for Cost Explorer query
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const startDate = startOfMonth.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];

    const command = `aws ce get-cost-and-usage \
      --time-period Start=${startDate},End=${endDate} \
      --granularity MONTHLY \
      --metrics BlendedCost \
      --group-by Type=DIMENSION,Key=SERVICE \
      --output json`;

    try {
      const result = await this.discoverResourceType('Bedrock', 'global', command);

      if (result.resources.length > 0) {
        // Parse Cost Explorer response to extract Bedrock costs
        const costData = result.resources[0].metadata;

        if (costData && costData.ResultsByTime && costData.ResultsByTime.length > 0) {
          const services = costData.ResultsByTime[0].Groups || [];

          // Find Bedrock-related services
          const bedrockServices = services.filter((group: any) => {
            const serviceName = group.Keys?.[0] || '';
            return serviceName.toLowerCase().includes('bedrock');
          });

          if (bedrockServices.length > 0) {
            // Sum up all Bedrock costs
            let totalCost = 0;
            const models: string[] = [];

            for (const service of bedrockServices) {
              const serviceName = service.Keys?.[0] || '';
              const cost = parseFloat(service.Metrics?.BlendedCost?.Amount || '0');
              totalCost += cost;

              if (serviceName) {
                models.push(serviceName);
              }
            }

            // Create Bedrock resource
            resources.push({
              id: `bedrock-${profile}`,
              name: 'Amazon Bedrock',
              type: 'Bedrock' as any, // Will need to add to type union
              region: 'global',
              metadata: {
                monthlyCost: totalCost.toFixed(2),
                currency: 'USD',
                models: models,
                billingPeriod: `${startDate} to ${endDate}`,
                note: totalCost === 0 ? 'Bedrock costs may be consolidated under payer account' : undefined,
              },
            });

            console.log(`[ResourceDiscovery] Found Bedrock usage: $${totalCost.toFixed(2)} (${models.length} services)`);
          } else {
            console.log(`[ResourceDiscovery] No Bedrock usage found in current month`);
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ResourceDiscovery] Error discovering Bedrock usage:`, errorMsg);
      // Don't fail the entire scan if Bedrock discovery fails
    }

    return resources;
  }

  /**
   * Discover specific resource types (convenience methods)
   */
  async discoverVPCs(region: string): Promise<AWSResource[]> {
    const result = await this.discoverResourceType('VPC', region, `aws ec2 describe-vpcs --region ${region}`);
    return result.resources;
  }

  async discoverEC2Instances(region: string): Promise<AWSResource[]> {
    const result = await this.discoverResourceType('EC2', region, `aws ec2 describe-instances --region ${region}`);
    return result.resources;
  }

  /**
   * Change the AWS profile for subsequent discoveries
   */
  setProfile(profile: string): void {
    this.claudeService.setProfile(profile);
  }
}
