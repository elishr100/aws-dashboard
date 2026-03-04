import { Router } from 'express';
import { ClaudeMCPService } from '../services/ClaudeMCPService.js';

const router = Router();
const claudeService = new ClaudeMCPService('dev-ah', 'us-west-2');

/**
 * Test endpoint: List VPCs using Claude MCP bridge
 */
router.get('/vpcs', async (req, res) => {
  try {
    console.log('[API] /test/vpcs called');

    const prompt = `Use the aws-mcp tool to list all VPCs in us-west-2 region.
Execute this AWS CLI command through MCP:
aws ec2 describe-vpcs --region us-west-2

Return the VPC information in a clear, structured format.
Include VPC IDs, CIDR blocks, state, and any Name tags if present.`;

    const response = await claudeService.query(prompt);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      profile: claudeService.getProfile(),
      region: 'us-west-2',
      claudeResponse: response.content,
      raw: response.raw,
    });
  } catch (error) {
    console.error('[API] Error in /test/vpcs:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
