/**
 * Test script to verify chat functionality with proper credentials
 *
 * Usage:
 *   npx tsx test-chat.ts
 */

import { ClaudeMCPService } from './src/services/ClaudeMCPService.js';

async function testChat() {
  console.log('='.repeat(60));
  console.log('🧪 Testing Chat Functionality');
  console.log('='.repeat(60));
  console.log('');

  const profile = 'dev-ah';
  const region = 'us-west-2';

  console.log(`📋 Test Configuration:`);
  console.log(`   Profile: ${profile}`);
  console.log(`   Region: ${region}`);
  console.log(`   Model: us.anthropic.claude-sonnet-4-5-20250929-v1:0`);
  console.log('');

  try {
    console.log('1️⃣ Initializing ClaudeMCPService...');
    const service = new ClaudeMCPService(profile, region);
    console.log('   ✅ Service initialized');
    console.log('');

    console.log('2️⃣ Testing simple query...');
    const testPrompt = 'Say "Hello! I am working correctly." and nothing else.';
    console.log(`   Prompt: "${testPrompt}"`);
    console.log('');

    console.log('   ⏳ Sending query to Claude...');
    const startTime = Date.now();

    const response = await service.query(testPrompt, 30000); // 30 second timeout

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`   ✅ Response received in ${duration}s`);
    console.log('');

    console.log('3️⃣ Response:');
    console.log('─'.repeat(60));
    console.log(response.content);
    console.log('─'.repeat(60));
    console.log('');

    console.log('✅ All tests passed!');
    console.log('');
    console.log('Next steps:');
    console.log('  • Start the backend: npm run dev');
    console.log('  • Open frontend and test chat panel');
    console.log('  • Send message: "hello"');
    console.log('  • Check for response streaming');
    console.log('');

    return true;
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
    } else if (error.message.includes('Bedrock')) {
      console.error('💡 Bedrock Issue:');
      console.error('   1. Verify Bedrock is enabled in us-west-2');
      console.error('   2. Check model access permissions');
      console.error('   3. Verify account: 307122262482');
      console.error('');
    } else if (error.message.includes('timeout')) {
      console.error('💡 Timeout Issue:');
      console.error('   1. Check network connectivity');
      console.error('   2. Verify AWS region is correct');
      console.error('   3. Try with longer timeout');
      console.error('');
    }

    console.error('See FIXES_SUMMARY.md for detailed troubleshooting');
    console.error('');

    return false;
  }
}

// Run test
testChat()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
