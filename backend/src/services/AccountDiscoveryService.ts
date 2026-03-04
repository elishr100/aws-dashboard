import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface AWSAccount {
  profileName: string;
  region?: string;
  roleArn?: string;
  sourceProfile?: string;
}

export class AccountDiscoveryService {
  private awsConfigPath: string;

  constructor(configPath?: string) {
    this.awsConfigPath = configPath || join(homedir(), '.aws', 'config');
  }

  /**
   * Parse ~/.aws/config and return ALL profiles
   * FIXED: No longer filters by source_profile - returns all profiles found
   * This allows the dashboard to work with any AWS configuration
   */
  discoverAccounts(): AWSAccount[] {
    try {
      const configContent = readFileSync(this.awsConfigPath, 'utf-8');
      const accounts: AWSAccount[] = [];

      const lines = configContent.split('\n');
      let currentProfile: string | null = null;
      let currentAccount: Partial<AWSAccount> = {};

      for (const line of lines) {
        const trimmed = line.trim();

        // Match [profile name] or [default]
        const profileMatch = trimmed.match(/^\[profile\s+(.+)\]$/);
        if (profileMatch) {
          // Save previous profile (no filtering - save all profiles)
          if (currentProfile) {
            accounts.push({
              profileName: currentProfile,
              region: currentAccount.region,
              roleArn: currentAccount.roleArn,
              sourceProfile: currentAccount.sourceProfile,
            });
          }

          // Start new profile
          currentProfile = profileMatch[1];
          currentAccount = {};
          continue;
        }

        // Parse profile properties
        if (currentProfile) {
          const regionMatch = trimmed.match(/^region\s*=\s*(.+)$/);
          if (regionMatch) {
            currentAccount.region = regionMatch[1].trim();
          }

          const sourceProfileMatch = trimmed.match(/^source_profile\s*=\s*(.+)$/);
          if (sourceProfileMatch) {
            currentAccount.sourceProfile = sourceProfileMatch[1].trim();
          }

          const roleArnMatch = trimmed.match(/^role_arn\s*=\s*(.+)$/);
          if (roleArnMatch) {
            currentAccount.roleArn = roleArnMatch[1].trim();
          }
        }
      }

      // Don't forget the last profile
      if (currentProfile) {
        accounts.push({
          profileName: currentProfile,
          region: currentAccount.region,
          roleArn: currentAccount.roleArn,
          sourceProfile: currentAccount.sourceProfile,
        });
      }

      console.log(`[AccountDiscovery] ✅ Found ${accounts.length} profiles in ~/.aws/config:`);
      accounts.forEach(acc => {
        console.log(`  - ${acc.profileName} (${acc.region || 'no region'})`);
      });

      return accounts;
    } catch (error) {
      console.error('[AccountDiscovery] Error reading ~/.aws/config:', error);
      return [];
    }
  }

  /**
   * Get a specific account by profile name
   */
  getAccount(profileName: string): AWSAccount | undefined {
    const accounts = this.discoverAccounts();
    return accounts.find(acc => acc.profileName === profileName);
  }

  /**
   * Check if a profile exists and is assumable
   */
  isValidProfile(profileName: string): boolean {
    return this.getAccount(profileName) !== undefined;
  }

  /**
   * Extract account ID from role ARN
   * Format: arn:aws:iam::123456789012:role/RoleName
   */
  private extractAccountIdFromRoleArn(roleArn: string): string | null {
    const match = roleArn.match(/arn:aws:iam::(\d+):/);
    return match ? match[1] : null;
  }

  /**
   * Build a map of account ID to profile name
   * This allows resolving account IDs in cost reports to human-readable profile names
   */
  getAccountIdToProfileMap(): Map<string, string> {
    const accounts = this.discoverAccounts();
    const map = new Map<string, string>();

    for (const account of accounts) {
      if (account.roleArn) {
        const accountId = this.extractAccountIdFromRoleArn(account.roleArn);
        if (accountId) {
          map.set(accountId, account.profileName);
          console.log(`[AccountDiscovery] Mapped account ${accountId} → ${account.profileName}`);
        }
      }
    }

    console.log(`[AccountDiscovery] Built account ID map with ${map.size} entries`);
    return map;
  }

  /**
   * Resolve account ID to profile name
   * Returns profile name if found, otherwise returns formatted string with both
   */
  resolveAccountIdToProfile(accountId: string): string {
    const map = this.getAccountIdToProfileMap();
    const profileName = map.get(accountId);

    if (profileName) {
      return `${profileName} (${accountId})`;
    }

    return accountId;
  }
}
