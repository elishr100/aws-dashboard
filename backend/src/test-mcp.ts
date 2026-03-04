#!/usr/bin/env tsx
/**
 * Standalone test script to verify Claude MCP bridge
 * Run with: npm test
 */

import { ClaudeMCPService } from './services/ClaudeMCPService.js';

async function testMCPBridge() {
  console.log('='.repeat(60));
  console.log('🧪 Testing Claude MCP Bridge');
  console.log('='.repeat(60));

  const service = new ClaudeMCPService('dev-ah', 'us-west-2');

  console.log(`\n📍 Profile: ${service.getProfile()}`);
  console.log(`📍 Region: us-west-2`);

  const prompt = `Use the aws-mcp tool to list all VPCs in us-west-2 region.
Execute this AWS CLI command through MCP:
aws ec2 describe-vpcs --region us-west-2

Return the VPC information in a clear, structured format.
Include VPC IDs, CIDR blocks, state, and any Name tags if present.`;

  console.log(`\n📤 Sending prompt to Claude CLI...\n`);

  try {
    const response = await service.query(prompt);

    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS - Claude Response:');
    console.log('='.repeat(60));
    console.log(response.content);
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ FAILED - Error:');
    console.error('='.repeat(60));
    console.error(error);
    console.error('='.repeat(60));

    process.exit(1);
  }
}

testMCPBridge();
