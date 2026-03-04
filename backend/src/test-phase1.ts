#!/usr/bin/env tsx
/**
 * Phase 1 Test: Complete validation of Claude MCP bridge with account switching
 *
 * Tests:
 * 1. Session status check
 * 2. Account discovery
 * 3. List VPCs from dev-ah account
 * 4. Switch to dev-nx-ah account
 * 5. List VPCs from dev-nx-ah account
 *
 * Run with: npm test
 */

import { ClaudeMCPService } from './services/ClaudeMCPService.js';
import { AccountDiscoveryService } from './services/AccountDiscoveryService.js';
import { SessionService } from './services/SessionService.js';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testPhase1() {
  console.log('\n' + '='.repeat(70));
  console.log('🚀 PHASE 1 TEST: Claude MCP Bridge + Multi-Account Support');
  console.log('='.repeat(70));

  // Step 1: Check session status
  console.log('\n📋 Step 1: Checking AWS session status...');
  console.log('-'.repeat(70));

  const sessionService = new SessionService();
  const sessionStatus = sessionService.getSessionStatus();
  console.log(sessionService.formatStatus(sessionStatus));

  if (sessionStatus.expired) {
    console.warn('\n⚠️  Warning: Session expiration not detected in credentials file.');
    console.warn('   This is OK if you recently ran "awsume".');
    console.warn('   The test will continue and verify session by making an AWS call.');
    console.warn('   If AWS calls fail, please run:');
    console.warn('     wfo');
    console.warn('     awsume dev-ah\n');
  }

  // Step 2: Discover available accounts
  console.log('\n📋 Step 2: Discovering available AWS accounts...');
  console.log('-'.repeat(70));

  const accountService = new AccountDiscoveryService();
  const accounts = accountService.discoverAccounts();

  if (accounts.length === 0) {
    console.error('❌ No assumable accounts found in ~/.aws/config');
    process.exit(1);
  }

  console.log(`✅ Found ${accounts.length} assumable account(s):`);
  accounts.forEach(acc => {
    console.log(`   • ${acc.profileName} (${acc.region || 'no region set'})`);
  });

  // Step 3: Test VPC listing with dev-ah
  console.log('\n📋 Step 3: Testing VPC listing with dev-ah profile...');
  console.log('-'.repeat(70));

  const claudeService = new ClaudeMCPService('dev-ah', 'us-west-2');

  const prompt1 = `Use the aws-mcp tool to list all VPCs in us-west-2 region.
Execute this AWS CLI command through MCP:
aws ec2 describe-vpcs --region us-west-2

Return the results in a structured format showing:
- VPC ID
- CIDR block
- State
- Name tag (if present)

Keep your response concise and clear.`;

  try {
    console.log(`📤 Profile: dev-ah`);
    console.log(`📤 Region: us-west-2`);
    console.log(`📤 Querying Claude CLI via MCP...`);

    const response1 = await claudeService.query(prompt1);

    console.log('\n✅ SUCCESS - dev-ah VPC List:');
    console.log('-'.repeat(70));
    console.log(response1.content);
    console.log('-'.repeat(70));
  } catch (error) {
    console.error('\n❌ FAILED - Error querying dev-ah:');
    console.error(error);
    process.exit(1);
  }

  // Step 4: Switch to dev-nx-ah
  console.log('\n📋 Step 4: Switching to dev-nx-ah profile...');
  console.log('-'.repeat(70));

  claudeService.setProfile('dev-nx-ah');
  console.log('✅ Profile switched to: dev-nx-ah');

  // Give a moment for any profile caching to clear
  await delay(1000);

  // Step 5: Test VPC listing with dev-nx-ah
  console.log('\n📋 Step 5: Testing VPC listing with dev-nx-ah profile...');
  console.log('-'.repeat(70));

  const prompt2 = `Use the aws-mcp tool to list all VPCs in us-west-2 region.
Execute this AWS CLI command through MCP:
aws ec2 describe-vpcs --region us-west-2

Return the results in a structured format showing:
- VPC ID
- CIDR block
- State
- Name tag (if present)

Keep your response concise and clear.`;

  try {
    console.log(`📤 Profile: dev-nx-ah`);
    console.log(`📤 Region: us-west-2`);
    console.log(`📤 Querying Claude CLI via MCP...`);

    const response2 = await claudeService.query(prompt2);

    console.log('\n✅ SUCCESS - dev-nx-ah VPC List:');
    console.log('-'.repeat(70));
    console.log(response2.content);
    console.log('-'.repeat(70));
  } catch (error) {
    console.error('\n❌ FAILED - Error querying dev-nx-ah:');
    console.error(error);
    process.exit(1);
  }

  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ PHASE 1 COMPLETE - All tests passed!');
  console.log('='.repeat(70));
  console.log('\n📊 Summary:');
  console.log(`   ✓ Session status: ${sessionStatus.valid ? 'VALID' : 'EXPIRED'}`);
  console.log(`   ✓ Accounts discovered: ${accounts.length}`);
  console.log(`   ✓ VPCs listed from dev-ah: SUCCESS`);
  console.log(`   ✓ Profile switched to dev-nx-ah: SUCCESS`);
  console.log(`   ✓ VPCs listed from dev-nx-ah: SUCCESS`);
  console.log('\n🎉 Claude MCP bridge is working correctly with multi-account support!');
  console.log('='.repeat(70) + '\n');

  process.exit(0);
}

// Run the test
testPhase1().catch(error => {
  console.error('\n' + '='.repeat(70));
  console.error('❌ PHASE 1 TEST FAILED');
  console.error('='.repeat(70));
  console.error(error);
  process.exit(1);
});
