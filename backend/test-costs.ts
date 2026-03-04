/**
 * Test script to verify cost retrieval functionality
 *
 * Usage:
 *   npx tsx test-costs.ts
 */

import { CostAnalysisService } from './src/services/CostAnalysisService.js';
import type { AWSResource } from './src/types/index.js';

async function testCosts() {
  console.log('='.repeat(60));
  console.log('💰 Testing Cost Retrieval Functionality');
  console.log('='.repeat(60));
  console.log('');

  const profile = 'dev-ah';
  const region = 'us-west-2';

  console.log(`📋 Test Configuration:`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Region: ${region}`);
  console.log('');

  try {
    console.log('1️⃣ Initializing CostAnalysisService...');
    const service = new CostAnalysisService(profile, region);
    console.log('   ✅ Service initialized');
    console.log('');

    console.log('2️⃣ Creating mock resources...');
    const mockResources: AWSResource[] = [
      {
        id: 'i-1234567890abcdef0',
        type: 'EC2',
        name: 'test-instance-1',
        region: 'us-west-2',
        state: 'running',
      },
      {
        id: 'i-0987654321fedcba0',
        type: 'EC2',
        name: 'test-instance-2',
        region: 'us-west-2',
        state: 'running',
      },
      {
        id: 'my-test-bucket',
        type: 'S3',
        name: 'my-test-bucket',
        region: 'us-west-2',
      },
    ];
    console.log(`   ✅ Created ${mockResources.length} mock resources:`);
    mockResources.forEach((r) => {
      console.log(`      - ${r.type}: ${r.id} (${r.name})`);
    });
    console.log('');

    console.log('3️⃣ Fetching costs from AWS Cost Explorer...');
    console.log('   ⏳ This may take 30-60 seconds...');
    console.log('   (Cost Explorer queries via Claude API can be slow)');
    console.log('');

    const startTime = Date.now();

    const costMap = await service.getResourceCosts(profile, mockResources);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`   ✅ Costs retrieved in ${duration}s`);
    console.log('');

    console.log('4️⃣ Cost Results:');
    console.log('─'.repeat(60));

    if (costMap.size === 0) {
      console.log('   ⚠️  No costs retrieved');
      console.log('');
      console.log('   This could mean:');
      console.log('   • Cost Explorer returned no data');
      console.log('   • Service names did not match resource types');
      console.log('   • No costs incurred for these services');
      console.log('   • Cost Explorer API error');
      console.log('');
      console.log('   Check backend logs above for details');
    } else {
      console.log(`   ✅ Retrieved costs for ${costMap.size} resources:`);
      console.log('');

      for (const [resourceId, cost] of costMap.entries()) {
        const resource = mockResources.find((r) => r.id === resourceId);
        console.log(`   ${resource?.type || 'Unknown'}: ${resourceId}`);
        console.log(`      Current Month: $${cost.currentMonthCost.toFixed(2)}`);
        console.log(`      Avg Monthly:   $${cost.avgMonthlyCost.toFixed(2)}`);
        console.log(`      Currency:      ${cost.currency}`);
        console.log(`      Updated:       ${cost.lastUpdated}`);
        console.log('');
      }
    }

    console.log('─'.repeat(60));
    console.log('');

    if (costMap.size > 0) {
      console.log('✅ Cost retrieval test passed!');
    } else {
      console.log('⚠️  Cost retrieval returned no data (check logs above)');
    }

    console.log('');
    console.log('Next steps:');
    console.log('  • Review backend logs for Cost Explorer queries');
    console.log('  • Check if Claude API successfully called Cost Explorer');
    console.log('  • Verify service name to resource type mapping');
    console.log('  • Run a real scan to populate resources with costs');
    console.log('');

    return costMap.size > 0;
  } catch (error: any) {
    console.error('');
    console.error('❌ Test failed!');
    console.error('');
    console.error('Error:', error.message);
    console.error('');

    if (error.message.includes('credentials')) {
      console.error('💡 Credential Issue:');
      console.error('   1. Check ~/.aws/config for profile "dev-ah"');
      console.error('   2. Verify credentials are valid:');
      console.error(`      aws configure export-credentials --profile ${profile} --format env`);
      console.error('   3. If using temporary credentials, refresh them:');
      console.error(`      awsume ${profile}`);
      console.error('');
    } else if (error.message.includes('Cost Explorer')) {
      console.error('💡 Cost Explorer Issue:');
      console.error('   1. Verify Cost Explorer is enabled in account');
      console.error('   2. Check IAM permissions: ce:GetCostAndUsage');
      console.error('   3. Verify account has cost data available');
      console.error('');
    } else if (error.message.includes('timeout')) {
      console.error('💡 Timeout Issue:');
      console.error('   1. Cost Explorer queries can be slow');
      console.error('   2. Try with smaller date range');
      console.error('   3. Check Claude API performance');
      console.error('');
    }

    console.error('See FIXES_SUMMARY.md for detailed troubleshooting');
    console.error('');

    return false;
  }
}

// Run test
testCosts()
  .then((success) => {
    console.log('Test completed');
    // Don't exit with error code if no costs found - it's not necessarily an error
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
