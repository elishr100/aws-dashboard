import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { SessionService } from '../services/SessionService.js';

const router = Router();
const sessionService = new SessionService();
const execAsync = promisify(exec);

/**
 * GET /api/session/status
 *
 * Get current AWS session status
 * Returns validity, expiration time, and minutes remaining
 */
router.get('/status', (req, res) => {
  try {
    console.log('[API] GET /session/status');

    // Get profile from environment or use default
    const profile = process.env.AWS_PROFILE || 'dev-ah';
    const status = sessionService.getSessionStatus(profile);

    res.json({
      success: true,
      session: {
        valid: status.valid,
        expired: status.expired,
        needsRefresh: status.needsRefresh,
        expiresAt: status.expiresAt?.toISOString(),
        minutesRemaining: status.minutesRemaining,
        profile,
      },
      message: sessionService.formatStatus(status),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /session/status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/session/refresh
 *
 * Refresh AWS session by using AWS STS assume-role
 * Body: { profile: "dev-ah" }
 */
router.post('/refresh', async (req, res) => {
  try {
    // Use profile from request body, or default to dev-ah
    const profile = req.body?.profile || process.env.AWS_PROFILE || 'dev-ah';

    console.log(`[API] POST /session/refresh - profile: ${profile}`);

    // Read ~/.aws/config to get role_arn and source_profile for this profile
    const configPath = join(homedir(), '.aws', 'config');
    let roleArn: string;
    let sourceProfile: string;

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const lines = configContent.split('\n');
      let inProfile = false;
      let foundRoleArn = '';
      let foundSourceProfile = '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for the target profile section
        const profileMatch = trimmed.match(/^\[profile\s+(.+)\]$/);
        if (profileMatch && profileMatch[1] === profile) {
          inProfile = true;
          continue;
        } else if (profileMatch) {
          // We've moved to a different profile section
          inProfile = false;
        }

        if (inProfile) {
          const roleArnMatch = trimmed.match(/^role_arn\s*=\s*(.+)$/);
          if (roleArnMatch) {
            foundRoleArn = roleArnMatch[1].trim();
          }

          const sourceProfileMatch = trimmed.match(/^source_profile\s*=\s*(.+)$/);
          if (sourceProfileMatch) {
            foundSourceProfile = sourceProfileMatch[1].trim();
          }
        }
      }

      if (!foundRoleArn || !foundSourceProfile) {
        throw new Error(`Profile ${profile} not found in ~/.aws/config or missing role_arn/source_profile`);
      }

      roleArn = foundRoleArn;
      sourceProfile = foundSourceProfile;
    } catch (error: any) {
      console.error(`[API] Failed to read config for profile ${profile}:`, error);
      return res.status(500).json({
        success: false,
        error: `Failed to read profile configuration: ${error.message}`,
      });
    }

    const roleSessionName = 'dashboard-session';

    // Use AWS STS assume-role with the source profile
    const command = `aws sts assume-role --role-arn ${roleArn} --role-session-name ${roleSessionName} --profile ${sourceProfile}`;
    console.log(`[API] Executing: ${command}`);
    console.log(`[API] Will write credentials to profile: [${profile}]`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000, // 30 second timeout
      });

      if (stderr) {
        console.warn(`[API] assume-role stderr: ${stderr}`);
      }

      // Parse the credentials from the JSON response
      const assumeRoleResponse = JSON.parse(stdout);
      const credentials = assumeRoleResponse.Credentials;

      if (!credentials) {
        throw new Error('No credentials returned from assume-role');
      }

      console.log(`[API] Successfully assumed role for ${profile}`);
      console.log(`[API] Credentials expire at: ${credentials.Expiration}`);

      // CRITICAL FIX: Write credentials to ~/.aws/credentials under [{profile}] NOT [{profile}-dashboard]
      const credentialsPath = join(homedir(), '.aws', 'credentials');
      let credentialsContent = '';

      try {
        credentialsContent = readFileSync(credentialsPath, 'utf-8');
      } catch (readError) {
        console.warn('[API] Could not read existing credentials file, will create new one');
      }

      // Remove existing [{profile}] section if it exists
      const profileRegex = new RegExp(`\\[${profile}\\][\\s\\S]*?(?=\\n\\[|$)`, 'g');
      credentialsContent = credentialsContent.replace(profileRegex, '').trim();

      // Append new credentials to the correct profile name
      const newCredentials = `
[${profile}]
aws_access_key_id = ${credentials.AccessKeyId}
aws_secret_access_key = ${credentials.SecretAccessKey}
aws_session_token = ${credentials.SessionToken}
expiration = ${credentials.Expiration}
`;

      credentialsContent += '\n' + newCredentials;
      writeFileSync(credentialsPath, credentialsContent, 'utf-8');

      console.log(`[API] ✅ Wrote credentials to ${credentialsPath} under profile [${profile}]`);

      // Set environment variables for the backend process
      process.env.AWS_ACCESS_KEY_ID = credentials.AccessKeyId;
      process.env.AWS_SECRET_ACCESS_KEY = credentials.SecretAccessKey;
      process.env.AWS_SESSION_TOKEN = credentials.SessionToken;
      process.env.AWS_PROFILE = profile;

      console.log(`[API] Updated environment variables for backend process`);

      // Get updated session status from the refreshed profile
      const status = sessionService.getSessionStatus(profile);

      res.json({
        success: true,
        message: `Session refreshed for profile: ${profile}`,
        session: {
          valid: status.valid,
          expired: status.expired,
          needsRefresh: status.needsRefresh,
          expiresAt: status.expiresAt?.toISOString(),
          minutesRemaining: status.minutesRemaining,
          profile: profile,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (execError: any) {
      console.error('[API] assume-role failed:', execError);

      return res.status(500).json({
        success: false,
        error: `Failed to refresh session: ${execError.message}`,
        stderr: execError.stderr,
      });
    }
  } catch (error) {
    console.error('[API] Error in POST /session/refresh:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/session/switch
 *
 * Switch to a different AWS account by assuming its role
 * Body: { profile: "target-profile-name" }
 */
router.post('/switch', async (req, res) => {
  try {
    const { profile } = req.body;

    if (!profile) {
      return res.status(400).json({
        success: false,
        error: 'Profile name is required',
      });
    }

    console.log(`[API] POST /session/switch - switching to profile: ${profile}`);

    // Read ~/.aws/config to get role_arn and source_profile for this profile
    const configPath = join(homedir(), '.aws', 'config');
    let roleArn: string;
    let sourceProfile: string;

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const lines = configContent.split('\n');
      let inProfile = false;
      let foundRoleArn = '';
      let foundSourceProfile = '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for the target profile section
        const profileMatch = trimmed.match(/^\[profile\s+(.+)\]$/);
        if (profileMatch && profileMatch[1] === profile) {
          inProfile = true;
          continue;
        } else if (profileMatch) {
          inProfile = false;
        }

        if (inProfile) {
          const roleArnMatch = trimmed.match(/^role_arn\s*=\s*(.+)$/);
          if (roleArnMatch) {
            foundRoleArn = roleArnMatch[1].trim();
          }

          const sourceProfileMatch = trimmed.match(/^source_profile\s*=\s*(.+)$/);
          if (sourceProfileMatch) {
            foundSourceProfile = sourceProfileMatch[1].trim();
          }
        }
      }

      if (!foundRoleArn || !foundSourceProfile) {
        return res.status(404).json({
          success: false,
          error: `Profile ${profile} not found in ~/.aws/config or missing role_arn/source_profile`,
        });
      }

      roleArn = foundRoleArn;
      sourceProfile = foundSourceProfile;
    } catch (error: any) {
      console.error(`[API] Failed to read config for profile ${profile}:`, error);
      return res.status(500).json({
        success: false,
        error: `Failed to read profile configuration: ${error.message}`,
      });
    }

    const roleSessionName = 'dashboard-session';

    // Assume the role using AWS CLI
    const command = `aws sts assume-role --role-arn ${roleArn} --role-session-name ${roleSessionName} --profile ${sourceProfile}`;
    console.log(`[API] Assuming role: ${roleArn}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
      });

      if (stderr) {
        console.warn(`[API] assume-role stderr: ${stderr}`);
      }

      const assumeRoleResponse = JSON.parse(stdout);
      const credentials = assumeRoleResponse.Credentials;

      if (!credentials) {
        throw new Error('No credentials returned from assume-role');
      }

      console.log(`[API] Successfully assumed role for ${profile}`);

      // Write credentials to ~/.aws/credentials under [{profile}]
      const credentialsPath = join(homedir(), '.aws', 'credentials');
      let credentialsContent = '';

      try {
        credentialsContent = readFileSync(credentialsPath, 'utf-8');
      } catch (readError) {
        credentialsContent = '';
      }

      // Remove existing profile section
      const profileRegex = new RegExp(`\\[${profile}\\][\\s\\S]*?(?=\\n\\[|$)`, 'g');
      credentialsContent = credentialsContent.replace(profileRegex, '').trim();

      // Append new credentials
      const newCredentials = `
[${profile}]
aws_access_key_id = ${credentials.AccessKeyId}
aws_secret_access_key = ${credentials.SecretAccessKey}
aws_session_token = ${credentials.SessionToken}
expiration = ${credentials.Expiration}
`;

      credentialsContent += '\n' + newCredentials;
      writeFileSync(credentialsPath, credentialsContent, 'utf-8');

      console.log(`[API] ✅ Switched to profile [${profile}]`);

      // Update backend active profile
      process.env.AWS_PROFILE = profile;
      process.env.AWS_ACCESS_KEY_ID = credentials.AccessKeyId;
      process.env.AWS_SECRET_ACCESS_KEY = credentials.SecretAccessKey;
      process.env.AWS_SESSION_TOKEN = credentials.SessionToken;

      res.json({
        success: true,
        message: `Successfully switched to profile: ${profile}`,
        profile,
        expiresAt: credentials.Expiration,
        timestamp: new Date().toISOString(),
      });
    } catch (execError: any) {
      console.error('[API] Failed to assume role:', execError);

      // Check if it's a permission error
      if (execError.stderr && execError.stderr.includes('AccessDenied')) {
        return res.status(403).json({
          success: false,
          error: `Cannot access account ${profile} - insufficient permissions`,
        });
      }

      return res.status(500).json({
        success: false,
        error: `Failed to switch to profile ${profile}: ${execError.message}`,
        stderr: execError.stderr,
      });
    }
  } catch (error) {
    console.error('[API] Error in POST /session/switch:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
