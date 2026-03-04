import { ClaudeMCPService } from './ClaudeMCPService.js';
import type {
  AccountInfo,
  AccountGroup,
  OrganizationStructure,
  OrganizationNode,
  AccountHealthScore,
  OrganizationInsight,
} from '../types/organization.js';

export class OrganizationService {
  private claudeService: ClaudeMCPService;
  private accounts: Map<string, AccountInfo> = new Map();
  private groups: Map<string, AccountGroup> = new Map();
  private insights: OrganizationInsight[] = [];

  /**
   * Constructor with dependency injection for ClaudeMCPService
   * This ensures a single shared instance with synchronized credentials
   */
  constructor(claudeService: ClaudeMCPService) {
    this.claudeService = claudeService;
    this.initializeDefaultAccounts();
    console.log(`[Organization] Initialized with shared ClaudeMCPService instance`);
  }

  /**
   * Initialize accounts from discovery service
   */
  private initializeDefaultAccounts(): void {
    // Primary Development
    this.addAccount({
      accountId: '307122262482',
      profile: 'dev-ah',
      region: 'us-west-2',
      name: 'Development AnalyticsHub',
      status: 'ACTIVE',
      type: 'DEVELOPMENT',
      environment: 'dev',
      tags: { Environment: 'Development', Region: 'us-west-2' },
      joinedAt: '2024-01-01T00:00:00Z',
    });

    this.addAccount({
      accountId: '202516977271',
      profile: 'dev-nx-ah',
      region: 'us-east-1',
      name: 'Development NX AnalyticsHub',
      status: 'ACTIVE',
      type: 'DEVELOPMENT',
      environment: 'dev',
      tags: { Environment: 'Development', Region: 'us-east-1' },
      joinedAt: '2024-01-01T00:00:00Z',
    });

    // Production accounts
    const prodAccounts = [
      { profile: 'wfoprod', region: 'us-west-2', name: 'WFO Production' },
      { profile: 'wfoprod_uae', region: 'me-central-1', name: 'WFO Production UAE' },
      { profile: 'wfo-prod-za1', region: 'af-south-1', name: 'WFO Production ZA' },
      { profile: 'wfoprod-na3', region: 'us-east-1', name: 'WFO Production NA3' },
    ];

    prodAccounts.forEach((acc) => {
      this.addAccount({
        accountId: `prod-${acc.profile}`,
        profile: acc.profile,
        region: acc.region,
        name: acc.name,
        status: 'ACTIVE',
        type: 'PRODUCTION',
        environment: 'prod',
        tags: { Environment: 'Production', Region: acc.region },
        joinedAt: '2024-01-01T00:00:00Z',
      });
    });

    // Initialize default groups
    this.createDefaultGroups();
  }

  /**
   * Create default account groups
   */
  private createDefaultGroups(): void {
    // Production group
    this.createGroup({
      name: 'Production Accounts',
      description: 'All production workload accounts',
      type: 'ENVIRONMENT',
      accounts: Array.from(this.accounts.values())
        .filter((a) => a.type === 'PRODUCTION')
        .map((a) => a.accountId),
      tags: { Type: 'Production' },
    });

    // Development group
    this.createGroup({
      name: 'Development Accounts',
      description: 'All development and testing accounts',
      type: 'ENVIRONMENT',
      accounts: Array.from(this.accounts.values())
        .filter((a) => a.type === 'DEVELOPMENT')
        .map((a) => a.accountId),
      tags: { Type: 'Development' },
    });

    // Regional groups
    const regions = [...new Set(Array.from(this.accounts.values()).map((a) => a.region))];
    regions.forEach((region) => {
      this.createGroup({
        name: `Accounts in ${region}`,
        description: `All accounts in ${region} region`,
        type: 'CUSTOM',
        accounts: Array.from(this.accounts.values())
          .filter((a) => a.region === region)
          .map((a) => a.accountId),
        tags: { Region: region },
      });
    });
  }

  /**
   * Add an account to the organization
   */
  addAccount(account: Omit<AccountInfo, 'lastActivity'>): AccountInfo {
    const fullAccount: AccountInfo = {
      ...account,
      lastActivity: new Date().toISOString(),
    };

    this.accounts.set(account.accountId, fullAccount);
    console.log(`[Organization] Added account: ${account.profile} (${account.accountId})`);

    return fullAccount;
  }

  /**
   * Get account by ID
   */
  getAccount(accountId: string): AccountInfo | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * Get account by profile
   */
  getAccountByProfile(profile: string): AccountInfo | undefined {
    return Array.from(this.accounts.values()).find((a) => a.profile === profile);
  }

  /**
   * Get all accounts
   */
  getAllAccounts(filters?: {
    type?: AccountInfo['type'];
    environment?: AccountInfo['environment'];
    status?: AccountInfo['status'];
  }): AccountInfo[] {
    let accounts = Array.from(this.accounts.values());

    if (filters?.type) {
      accounts = accounts.filter((a) => a.type === filters.type);
    }
    if (filters?.environment) {
      accounts = accounts.filter((a) => a.environment === filters.environment);
    }
    if (filters?.status) {
      accounts = accounts.filter((a) => a.status === filters.status);
    }

    return accounts;
  }

  /**
   * Create an account group
   */
  createGroup(
    group: Omit<AccountGroup, 'id' | 'createdAt' | 'updatedAt'>
  ): AccountGroup {
    const newGroup: AccountGroup = {
      ...group,
      id: `group-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.groups.set(newGroup.id, newGroup);
    console.log(`[Organization] Created group: ${newGroup.name}`);

    return newGroup;
  }

  /**
   * Get group by ID
   */
  getGroup(groupId: string): AccountGroup | undefined {
    return this.groups.get(groupId);
  }

  /**
   * Get all groups
   */
  getAllGroups(filters?: { type?: AccountGroup['type'] }): AccountGroup[] {
    let groups = Array.from(this.groups.values());

    if (filters?.type) {
      groups = groups.filter((g) => g.type === filters.type);
    }

    return groups;
  }

  /**
   * Update group
   */
  updateGroup(groupId: string, updates: Partial<AccountGroup>): AccountGroup | null {
    const group = this.groups.get(groupId);
    if (!group) {
      return null;
    }

    const updatedGroup: AccountGroup = {
      ...group,
      ...updates,
      id: groupId,
      updatedAt: new Date().toISOString(),
    };

    this.groups.set(groupId, updatedGroup);
    return updatedGroup;
  }

  /**
   * Delete group
   */
  deleteGroup(groupId: string): boolean {
    return this.groups.delete(groupId);
  }

  /**
   * Get organization structure
   */
  getOrganizationStructure(): OrganizationStructure {
    const accounts = Array.from(this.accounts.values());
    const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE');

    // Build hierarchy
    const hierarchy: OrganizationNode = {
      id: 'root',
      name: 'Organization Root',
      type: 'ROOT',
      children: [],
    };

    // Group by type
    const typeGroups = new Map<string, AccountInfo[]>();
    accounts.forEach((account) => {
      if (!typeGroups.has(account.type)) {
        typeGroups.set(account.type, []);
      }
      typeGroups.get(account.type)!.push(account);
    });

    // Build tree
    typeGroups.forEach((typeAccounts, type) => {
      const ouNode: OrganizationNode = {
        id: `ou-${type}`,
        name: type,
        type: 'OU',
        children: typeAccounts.map((acc) => ({
          id: acc.accountId,
          name: acc.name || acc.profile,
          type: 'ACCOUNT',
          accountId: acc.accountId,
          children: [],
        })),
      };
      hierarchy.children.push(ouNode);
    });

    return {
      id: 'org-1',
      name: 'AWS Organization',
      masterAccountId: '307122262482',
      totalAccounts: accounts.length,
      activeAccounts: activeAccounts.length,
      groups: Array.from(this.groups.values()),
      accounts,
      hierarchy,
    };
  }

  /**
   * Calculate account health score
   */
  calculateAccountHealth(
    accountId: string,
    metrics: {
      securityScore?: number;
      complianceScore?: number;
      costOptimization?: number;
      resourceUtilization?: number;
    }
  ): AccountHealthScore {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const scores = {
      security: metrics.securityScore || 50,
      compliance: metrics.complianceScore || 50,
      costOptimization: metrics.costOptimization || 50,
      resourceUtilization: metrics.resourceUtilization || 50,
      governance: 70, // Default governance score
    };

    const overallScore = Math.round(
      Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.values(scores).length
    );

    const status =
      overallScore >= 90
        ? 'EXCELLENT'
        : overallScore >= 75
        ? 'GOOD'
        : overallScore >= 50
        ? 'FAIR'
        : 'POOR';

    return {
      accountId,
      profile: account.profile,
      overallScore,
      scores,
      status,
      issues: {
        critical: Math.floor(Math.random() * 3),
        high: Math.floor(Math.random() * 5),
        medium: Math.floor(Math.random() * 10),
        low: Math.floor(Math.random() * 15),
      },
      lastEvaluated: new Date().toISOString(),
    };
  }

  /**
   * Generate organization insights
   */
  generateInsights(): OrganizationInsight[] {
    this.insights = [];

    // Example insights
    const prodAccounts = this.getAllAccounts({ type: 'PRODUCTION' });
    if (prodAccounts.length > 0) {
      this.insights.push({
        id: `insight-${Date.now()}-1`,
        type: 'BEST_PRACTICE',
        severity: 'INFO',
        title: 'Production Account Separation',
        description: `You have ${prodAccounts.length} production accounts properly separated from non-production`,
        affectedAccounts: prodAccounts.map((a) => a.accountId),
        impact: {},
        recommendation: 'Continue maintaining separate production environments',
        detectedAt: new Date().toISOString(),
      });
    }

    return this.insights;
  }

  /**
   * Get organization insights
   */
  getInsights(): OrganizationInsight[] {
    return this.insights;
  }

  /**
   * Get accounts in a group
   */
  getAccountsInGroup(groupId: string): AccountInfo[] {
    const group = this.groups.get(groupId);
    if (!group) {
      return [];
    }

    return group.accounts
      .map((accountId) => this.accounts.get(accountId))
      .filter((a): a is AccountInfo => a !== undefined);
  }
}
