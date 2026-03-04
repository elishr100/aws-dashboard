import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface SessionStatus {
  valid: boolean;
  expiresAt?: Date;
  minutesRemaining?: number;
  expired: boolean;
  needsRefresh: boolean; // true if < 30 minutes remaining
}

export class SessionService {
  private awsCredentialsPath: string;
  private sessionProfileName: string;

  constructor(
    credentialsPath?: string,
    sessionProfileName: string = 'dev-ah-dashboard'
  ) {
    this.awsCredentialsPath = credentialsPath || join(homedir(), '.aws', 'credentials');
    this.sessionProfileName = sessionProfileName;
  }

  /**
   * Read session expiry from ~/.aws/credentials profile section
   * Returns expiration timestamp if available
   * @param profile - Optional profile name to check. If not provided, uses the instance's sessionProfileName
   */
  getSessionStatus(profile?: string): SessionStatus {
    const profileToCheck = profile || this.sessionProfileName;

    try {
      const credentialsContent = readFileSync(this.awsCredentialsPath, 'utf-8');
      const lines = credentialsContent.split('\n');

      let inSessionProfile = false;
      let expirationStr: string | null = null;

      for (const line of lines) {
        const trimmed = line.trim();

        // Check if we're in the session profile section
        if (trimmed === `[${profileToCheck}]`) {
          inSessionProfile = true;
          continue;
        }

        // Check if we've moved to another profile section
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          inSessionProfile = false;
          continue;
        }

        // Look for expiration field
        if (inSessionProfile) {
          const expirationMatch = trimmed.match(/^expiration\s*=\s*(.+)$/);
          if (expirationMatch) {
            expirationStr = expirationMatch[1].trim();
            break;
          }
        }
      }

      if (!expirationStr) {
        console.warn(`[Session] No expiration found for profile ${profileToCheck}`);
        return {
          valid: false,
          expired: true,
          needsRefresh: true,
        };
      }

      // Parse expiration (format: 2026-03-02 01:04:14)
      const expiresAt = new Date(expirationStr.replace(" ", "T"));
      const now = new Date();
      const minutesRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);

      const expired = minutesRemaining <= 0;
      const needsRefresh = minutesRemaining < 30;

      console.log(`[Session] Expiration: ${expiresAt.toISOString()}`);
      console.log(`[Session] Minutes remaining: ${minutesRemaining}`);
      console.log(`[Session] Status: ${expired ? 'EXPIRED' : needsRefresh ? 'NEEDS REFRESH' : 'VALID'}`);

      return {
        valid: !expired,
        expiresAt,
        minutesRemaining,
        expired,
        needsRefresh,
      };
    } catch (error) {
      console.error('[Session] Error reading ~/.aws/credentials:', error);
      return {
        valid: false,
        expired: true,
        needsRefresh: true,
      };
    }
  }

  /**
   * Format session status as human-readable string
   */
  formatStatus(status: SessionStatus): string {
    if (status.expired) {
      return '❌ Session EXPIRED - run "wfo" to refresh';
    }
    if (status.needsRefresh) {
      return `⚠️  Session expires in ${status.minutesRemaining} minutes - refresh soon`;
    }
    if (status.minutesRemaining) {
      const hours = Math.floor(status.minutesRemaining / 60);
      const mins = status.minutesRemaining % 60;
      return `✅ Session valid for ${hours}h ${mins}m`;
    }
    return '⚠️  Session status unknown';
  }
}
