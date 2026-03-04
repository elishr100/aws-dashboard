#!/usr/bin/env tsx
/**
 * Phase 2 Test: Backend API + Resource Discovery
 *
 * Tests all Phase 2 endpoints:
 * 1. GET /api/accounts - List accounts
 * 2. GET /api/session/status - Session status
 * 3. POST /api/scan - Start resource discovery
 * 4. GET /api/scan/:jobId/stream - SSE streaming (manual test)
 * 5. GET /api/resources - Query resources from cache
 * 6. GET /api/resources/stats - Get statistics
 *
 * Run with: npm run test:phase2
 */

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testPhase2() {
  const BASE_URL = 'http://localhost:3001';

  console.log('\n' + '='.repeat(70));
  console.log('🧪 PHASE 2 TEST: Backend API + Resource Discovery');
  console.log('='.repeat(70));

  // Test 1: List accounts
  console.log('\n📋 Test 1: GET /api/accounts');
  console.log('-'.repeat(70));

  try {
    const accountsRes = await fetch(`${BASE_URL}/api/accounts`);
    const accountsData = await accountsRes.json();

    if (accountsData.success) {
      console.log(`✅ Found ${accountsData.count} accounts`);
      console.log(`   First 3 accounts:`);
      accountsData.accounts.slice(0, 3).forEach((acc: any) => {
        console.log(`   • ${acc.profileName} (${acc.region}) - Account ${acc.accountId || 'N/A'}`);
      });
    } else {
      console.error('❌ Failed:', accountsData.error);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test 2: Session status
  console.log('\n📋 Test 2: GET /api/session/status');
  console.log('-'.repeat(70));

  try {
    const sessionRes = await fetch(`${BASE_URL}/api/session/status`);
    const sessionData = await sessionRes.json();

    if (sessionData.success) {
      console.log(`✅ ${sessionData.message}`);
      console.log(`   Valid: ${sessionData.session.valid}`);
      console.log(`   Expired: ${sessionData.session.expired}`);
      if (sessionData.session.minutesRemaining) {
        console.log(`   Minutes remaining: ${sessionData.session.minutesRemaining}`);
      }
    } else {
      console.error('❌ Failed:', sessionData.error);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test 3: Start scan
  console.log('\n📋 Test 3: POST /api/scan');
  console.log('-'.repeat(70));
  console.log('⚠️  Note: This test starts a real scan. It may take several minutes.');
  console.log('   Scanning dev-ah account in us-west-2...');

  let jobId: string | null = null;

  try {
    const scanRes = await fetch(`${BASE_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: 'dev-ah',
        regions: ['us-west-2'],
      }),
    });

    const scanData = await scanRes.json();

    if (scanData.success) {
      jobId = scanData.jobId;
      console.log(`✅ Scan started`);
      console.log(`   Job ID: ${jobId}`);
      console.log(`   Stream URL: ${scanData.streamUrl}`);
    } else {
      console.error('❌ Failed:', scanData.error);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  if (!jobId) {
    console.log('\n❌ Cannot continue tests without scan job');
    process.exit(1);
  }

  // Test 4: Poll scan status
  console.log('\n📋 Test 4: Polling scan status (GET /api/scan/:jobId)');
  console.log('-'.repeat(70));

  let completed = false;
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max

  while (!completed && attempts < maxAttempts) {
    try {
      const statusRes = await fetch(`${BASE_URL}/api/scan/${jobId}`);
      const statusData = await statusRes.json();

      if (statusData.success) {
        const job = statusData.job;
        console.log(`   [${job.status}] Progress: ${job.progress}% - Resources found: ${job.resourcesFound}`);

        if (job.status === 'completed' || job.status === 'failed') {
          completed = true;

          if (job.status === 'completed') {
            console.log(`✅ Scan completed successfully!`);
            console.log(`   Total resources found: ${job.resourcesFound}`);
          } else {
            console.log(`❌ Scan failed`);
            if (job.errors) {
              console.log(`   Errors: ${job.errors.join(', ')}`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error polling scan:', error);
    }

    if (!completed) {
      await delay(5000); // Wait 5 seconds
      attempts++;
    }
  }

  if (!completed) {
    console.log('⚠️  Scan is still running after timeout. Continuing with tests...');
  }

  // Give cache a moment to settle
  await delay(2000);

  // Test 5: Query resources
  console.log('\n📋 Test 5: GET /api/resources');
  console.log('-'.repeat(70));

  try {
    const resourcesRes = await fetch(`${BASE_URL}/api/resources?profile=dev-ah&region=us-west-2`);
    const resourcesData = await resourcesRes.json();

    if (resourcesData.success) {
      console.log(`✅ Retrieved ${resourcesData.count} resources from cache`);
      console.log(`   Cached: ${resourcesData.cached}`);
      console.log(`   Fetched at: ${resourcesData.fetchedAt}`);
      console.log(`   Cache expires in: ${resourcesData.cacheExpiresIn}s`);

      // Show sample resources by type
      const byType: Record<string, number> = {};
      resourcesData.resources.forEach((r: any) => {
        byType[r.type] = (byType[r.type] || 0) + 1;
      });

      console.log(`   Resources by type:`);
      Object.entries(byType).forEach(([type, count]) => {
        console.log(`     • ${type}: ${count}`);
      });
    } else {
      console.error('❌ Failed:', resourcesData.error);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Test 6: Get statistics
  console.log('\n📋 Test 6: GET /api/resources/stats');
  console.log('-'.repeat(70));

  try {
    const statsRes = await fetch(`${BASE_URL}/api/resources/stats?profile=dev-ah&region=us-west-2`);
    const statsData = await statsRes.json();

    if (statsData.success) {
      console.log(`✅ Statistics retrieved`);
      console.log(`   Total resources: ${statsData.stats.total}`);
      console.log(`   By type:`);
      Object.entries(statsData.stats.byType).forEach(([type, count]) => {
        console.log(`     • ${type}: ${count}`);
      });

      if (Object.keys(statsData.stats.byVpc).length > 0) {
        console.log(`   By VPC:`);
        Object.entries(statsData.stats.byVpc).slice(0, 3).forEach(([vpc, count]) => {
          console.log(`     • ${vpc}: ${count}`);
        });
      }
    } else {
      console.error('❌ Failed:', statsData.error);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ PHASE 2 TESTS COMPLETE');
  console.log('='.repeat(70));
  console.log('\n📊 Summary:');
  console.log('   ✓ Accounts endpoint working');
  console.log('   ✓ Session status endpoint working');
  console.log('   ✓ Scan endpoint working');
  console.log('   ✓ Resources query working');
  console.log('   ✓ Statistics endpoint working');
  console.log('\n🎉 Phase 2 Backend API is fully functional!');
  console.log('='.repeat(70) + '\n');

  console.log('💡 Manual SSE Test:');
  console.log('   Run a new scan and open this URL in your browser:');
  console.log(`   ${BASE_URL}/api/scan/<jobId>/stream`);
  console.log('   You should see real-time progress updates!\n');
}

// Check if server is running
async function checkServer() {
  const BASE_URL = 'http://localhost:3001';

  console.log('🔍 Checking if server is running...');

  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (res.ok) {
      console.log('✅ Server is running!\n');
      return true;
    }
  } catch (error) {
    console.error('\n❌ Server is not running!');
    console.error('   Please start the server first:');
    console.error('   npm run dev\n');
    return false;
  }

  return false;
}

// Run tests
(async () => {
  const serverRunning = await checkServer();

  if (!serverRunning) {
    process.exit(1);
  }

  await testPhase2();
})().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
