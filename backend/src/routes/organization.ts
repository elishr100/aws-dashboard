import { Router, Request, Response } from 'express';
import { ServiceFactory } from '../services/ServiceFactory.js';
import type { AccountInfo, AccountGroup } from '../types/organization.js';

const router = Router();

// Get OrganizationService from ServiceFactory with default profile/region
// OrganizationService is cross-account, so we use a default profile
const DEFAULT_PROFILE = 'dev-ah';
const DEFAULT_REGION = 'us-west-2';

/**
 * GET /api/organization
 * Get organization structure with all accounts and groups
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const orgService = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION);
    const structure = orgService.getOrganizationStructure();
    res.json(structure);
  } catch (error) {
    console.error('Error fetching organization structure:', error);
    res.status(500).json({ error: 'Failed to fetch organization structure' });
  }
});

/**
 * GET /api/organization/accounts
 * List all accounts with optional filters
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const { type, environment, status } = req.query;

    const filters: any = {};
    if (type) filters.type = type as AccountInfo['type'];
    if (environment) filters.environment = environment as AccountInfo['environment'];
    if (status) filters.status = status as AccountInfo['status'];

    const accounts = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getAllAccounts(filters);
    res.json({ accounts, count: accounts.length });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

/**
 * GET /api/organization/accounts/:accountId
 * Get account details by ID
 */
router.get('/accounts/:accountId', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const account = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getAccount(accountId);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(account);
  } catch (error) {
    console.error('Error fetching account:', error);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
});

/**
 * GET /api/organization/accounts/:accountId/health
 * Get account health score
 */
router.get('/accounts/:accountId/health', async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    const account = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getAccount(accountId);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // TODO: Integrate with actual security/compliance services
    const healthScore = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).calculateAccountHealth(accountId, {
      securityScore: 75,
      complianceScore: 85,
      costOptimization: 70,
      resourceUtilization: 80,
    });

    res.json(healthScore);
  } catch (error) {
    console.error('Error calculating account health:', error);
    res.status(500).json({ error: 'Failed to calculate account health' });
  }
});

/**
 * POST /api/organization/accounts
 * Add a new account to the organization
 */
router.post('/accounts', async (req: Request, res: Response) => {
  try {
    const accountData = req.body;

    // Validate required fields
    if (!accountData.accountId || !accountData.profile || !accountData.region) {
      return res.status(400).json({
        error: 'Missing required fields: accountId, profile, region',
      });
    }

    const account = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).addAccount(accountData);
    res.status(201).json(account);
  } catch (error) {
    console.error('Error adding account:', error);
    res.status(500).json({ error: 'Failed to add account' });
  }
});

/**
 * GET /api/organization/groups
 * List all account groups
 */
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    const filters: any = {};
    if (type) filters.type = type as AccountGroup['type'];

    const groups = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getAllGroups(filters);
    res.json({ groups, count: groups.length });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

/**
 * GET /api/organization/groups/:groupId
 * Get group details by ID
 */
router.get('/groups/:groupId', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const group = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getGroup(groupId);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(group);
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

/**
 * GET /api/organization/groups/:groupId/accounts
 * Get all accounts in a group
 */
router.get('/groups/:groupId/accounts', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const accounts = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getAccountsInGroup(groupId);

    res.json({ accounts, count: accounts.length });
  } catch (error) {
    console.error('Error fetching group accounts:', error);
    res.status(500).json({ error: 'Failed to fetch group accounts' });
  }
});

/**
 * POST /api/organization/groups
 * Create a new account group
 */
router.post('/groups', async (req: Request, res: Response) => {
  try {
    const groupData = req.body;

    // Validate required fields
    if (!groupData.name || !groupData.type || !groupData.accounts) {
      return res.status(400).json({
        error: 'Missing required fields: name, type, accounts',
      });
    }

    const group = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).createGroup(groupData);
    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

/**
 * PATCH /api/organization/groups/:groupId
 * Update a group
 */
router.patch('/groups/:groupId', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const updates = req.body;

    const updatedGroup = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).updateGroup(groupId, updates);

    if (!updatedGroup) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(updatedGroup);
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

/**
 * DELETE /api/organization/groups/:groupId
 * Delete a group
 */
router.delete('/groups/:groupId', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const deleted = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).deleteGroup(groupId);

    if (!deleted) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, message: 'Group deleted' });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

/**
 * GET /api/organization/insights
 * Get organization-wide insights
 */
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const insights = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).generateInsights();
    res.json({ insights, count: insights.length });
  } catch (error) {
    console.error('Error generating insights:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

/**
 * GET /api/organization/hierarchy
 * Get organization hierarchy tree
 */
router.get('/hierarchy', async (req: Request, res: Response) => {
  try {
    const structure = ServiceFactory.getOrganizationService(DEFAULT_PROFILE, DEFAULT_REGION).getOrganizationStructure();
    res.json(structure.hierarchy);
  } catch (error) {
    console.error('Error fetching hierarchy:', error);
    res.status(500).json({ error: 'Failed to fetch hierarchy' });
  }
});

export default router;
