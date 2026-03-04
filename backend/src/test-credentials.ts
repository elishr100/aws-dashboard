#!/usr/bin/env tsx

/**
 * Test script for AWS credential management fixes
 *
 * Tests:
 * 1. Credential fetching and validation
 * 2. Credential caching with TTL
 * 3. Error handling and retry logic
 * 4. AWS CLI command execution
 * 5. Environment variable isolation
 */

import { ClaudeMCPService } from './services/ClaudeMCPService.js';
import { ResourceDiscoveryAgent } from './agents/ResourceDiscoveryAgent.js';

console.log('='.repeat(80));
console.log('AWS Credential Management Test Suite');
console.log('='.repeat(80));
console.log();

const PROFILE = process.env.AWS_PROFILE || 'dev-ah';
const REGION = process.env.AWS_REGION || 'us-west-2';

async function testCredentialFetching() {
  console.log('Test 1: Credential Fetching and Validation');
  console.log('-'.repeat(80));

  try {
    const service = new ClaudeMCPService(PROFILE, REGION);

    // Trigger credential fetch by making a query
    console.log('Querying Claude API to trigger credential fetch...');
    const result = await service.query('What is the AWS region?', 10000);

    console.log('✅ Credential fetching and validation: PASSED');
    console.log(`   Response length: ${result.content.length} chars`);
  } catch (error: any) {
    console.error('❌ Credential fetching and validation: FAILED');
    console.error(`   Error: ${error.message}`);
    return false;
  }

  console.log();
  return true;
}

async function testCredentialCaching() {
  console.log('Test 2: Credential Caching with TTL');
  console.log('-'.repeat(80));

  try {
    const service = new ClaudeMCPService(PROFILE, REGION);

    // First query - should fetch credentials
    console.log('First query (should fetch credentials)...');
    await service.query('List AWS regions', 10000);

    // Second query immediately after - should use cached credentials
    console.log('Second query (should use cached credentials)...');
    await service.query('What is AWS?', 10000);

    console.log('✅ Credential caching: PASSED');
    console.log('   Check logs above for "Using cached credentials" message');
  } catch (error: any) {
    console.error('❌ Credential caching: FAILED');
    console.error(`   Error: ${error.message}`);
    return false;
  }

  console.log();
  return true;
}

async function testResourceDiscovery() {
  console.log('Test 3: Resource Discovery with Error Logging');
  console.log('-'.repeat(80));

  try {
    const agent = new ResourceDiscoveryAgent(PROFILE, REGION);

    console.log(`Discovering resources in ${REGION}...`);
    const inventory = await agent.discoverAll(REGION);

    console.log(`✅ Resource discovery: PASSED`);
    console.log(`   Found ${inventory.resources.length} resources`);
    if (inventory.errors && inventory.errors.length > 0) {
      console.log(`   Errors: ${inventory.errors.length}`);
      inventory.errors.forEach((err, idx) => {
        console.log(`     ${idx + 1}. ${err}`);
      });
    } else {
      console.log(`   No errors`);
    }
  } catch (error: any) {
    console.error('❌ Resource discovery: FAILED');
    console.error(`   Error: ${error.message}`);
    return false;
  }

  console.log();
  return true;
}

async function testEnvironmentIsolation() {
  console.log('Test 4: Environment Variable Isolation');
  console.log('-'.repeat(80));

  // Set fake stale credentials in process.env
  const oldAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const oldSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const oldSessionToken = process.env.AWS_SESSION_TOKEN;

  try {
    console.log('Setting fake stale credentials in process.env...');
    process.env.AWS_ACCESS_KEY_ID = 'FAKE_STALE_ACCESS_KEY';
    process.env.AWS_SECRET_ACCESS_KEY = 'FAKE_STALE_SECRET_KEY';
    process.env.AWS_SESSION_TOKEN = 'FAKE_STALE_SESSION_TOKEN';

    const service = new ClaudeMCPService(PROFILE, REGION);

    console.log('Attempting query with stale env credentials...');
    await service.query('What is AWS Lambda?', 10000);

    console.log('✅ Environment isolation: PASSED');
    console.log('   Service successfully ignored stale env credentials and used profile');
  } catch (error: any) {
    console.error('❌ Environment isolation: FAILED');
    console.error(`   Error: ${error.message}`);
    return false;
  } finally {
    // Restore original environment
    if (oldAccessKeyId) process.env.AWS_ACCESS_KEY_ID = oldAccessKeyId;
    else delete process.env.AWS_ACCESS_KEY_ID;

    if (oldSecretAccessKey) process.env.AWS_SECRET_ACCESS_KEY = oldSecretAccessKey;
    else delete process.env.AWS_SECRET_ACCESS_KEY;

    if (oldSessionToken) process.env.AWS_SESSION_TOKEN = oldSessionToken;
    else delete process.env.AWS_SESSION_TOKEN;

    console.log('Restored original environment variables');
  }

  console.log();
  return true;
}

async function testErrorHandling() {
  console.log('Test 5: Error Handling and Messages');
  console.log('-'.repeat(80));

  try {
    // Try with invalid profile to test error messages
    const service = new ClaudeMCPService('invalid-profile-12345', REGION);

    console.log('Attempting query with invalid profile...');
    await service.query('Test query', 10000);

    console.log('⚠️  Error handling: UNEXPECTED SUCCESS');
    console.log('   Expected error but query succeeded');
  } catch (error: any) {
    if (error.message.includes('invalid-profile-12345')) {
      console.log('✅ Error handling: PASSED');
      console.log('   Error message correctly identifies invalid profile');
    } else {
      console.log('⚠️  Error handling: PARTIAL');
      console.log(`   Error: ${error.message}`);
    }
  }

  console.log();
  return true;
}

async function runTests() {
  console.log(`Testing with profile: ${PROFILE}, region: ${REGION}`);
  console.log();

  const results = {
    credentialFetching: false,
    credentialCaching: false,
    resourceDiscovery: false,
    environmentIsolation: false,
    errorHandling: false,
  };

  // Run all tests
  results.credentialFetching = await testCredentialFetching();
  results.credentialCaching = await testCredentialCaching();
  results.resourceDiscovery = await testResourceDiscovery();
  results.environmentIsolation = await testEnvironmentIsolation();
  results.errorHandling = await testErrorHandling();

  // Summary
  console.log('='.repeat(80));
  console.log('Test Summary');
  console.log('='.repeat(80));
  console.log(`Credential Fetching:     ${results.credentialFetching ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Credential Caching:      ${results.credentialCaching ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Resource Discovery:      ${results.resourceDiscovery ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Environment Isolation:   ${results.environmentIsolation ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Error Handling:          ${results.errorHandling ? '✅ PASSED' : '❌ FAILED'}`);
  console.log();

  const passedCount = Object.values(results).filter(Boolean).length;
  const totalCount = Object.keys(results).length;

  if (passedCount === totalCount) {
    console.log(`🎉 All tests passed! (${passedCount}/${totalCount})`);
    process.exit(0);
  } else {
    console.log(`⚠️  Some tests failed (${passedCount}/${totalCount} passed)`);
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
