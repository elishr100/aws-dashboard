import { Router } from 'express';
import { AccountDiscoveryService } from '../services/AccountDiscoveryService.js';

const router = Router();
const accountService = new AccountDiscoveryService();

/**
 * GET /api/accounts
 *
 * List all available AWS accounts from ~/.aws/config
 * Returns all profiles with source_profile=nice-identity-session
 */
router.get('/', (req, res) => {
  try {
    console.log('[API] GET /accounts');

    const accounts = accountService.discoverAccounts();

    // Extract account ID from role ARN if possible
    const accountsWithId = accounts.map(acc => {
      let accountId: string | undefined;

      if (acc.roleArn) {
        // Extract account ID from ARN: arn:aws:iam::123456789012:role/RoleName
        const match = acc.roleArn.match(/:(\d{12}):/);
        if (match) {
          accountId = match[1];
        }
      }

      return {
        profile: acc.profileName,
        region: acc.region,
        roleArn: acc.roleArn,
        accountId,
      };
    });

    res.json({
      success: true,
      accounts: accountsWithId,
      count: accountsWithId.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /accounts:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/accounts/:profileName
 *
 * Get details for a specific account
 */
router.get('/:profileName', (req, res) => {
  try {
    const { profileName } = req.params;
    console.log(`[API] GET /accounts/${profileName}`);

    const account = accountService.getAccount(profileName);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: `Account profile '${profileName}' not found`,
      });
    }

    // Extract account ID from role ARN
    let accountId: string | undefined;
    if (account.roleArn) {
      const match = account.roleArn.match(/:(\d{12}):/);
      if (match) {
        accountId = match[1];
      }
    }

    res.json({
      success: true,
      account: {
        profile: account.profileName,
        region: account.region,
        roleArn: account.roleArn,
        accountId,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Error in GET /accounts/:profileName:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
