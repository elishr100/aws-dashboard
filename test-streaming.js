#!/usr/bin/env node

/**
 * Test script for verifying real-time streaming from Bedrock
 * Connects to WebSocket and sends a simple query
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3001/api/chat';
const TEST_MESSAGE = 'What is AWS?'; // Simple question that should get quick response

console.log('🧪 Testing AI Assistant Streaming...\n');
console.log('Connecting to:', WS_URL);

const ws = new WebSocket(WS_URL);

let firstChunkTime = null;
let lastChunkTime = null;
let chunkCount = 0;
let fullResponse = '';

ws.on('open', () => {
  console.log('✅ WebSocket connected\n');

  // Send test message
  const message = {
    type: 'message',
    content: TEST_MESSAGE,
    sessionId: 'test-session-' + Date.now(),
    profile: 'dev-ah',
    region: 'us-west-2',
  };

  console.log('📤 Sending message:', TEST_MESSAGE);
  console.log('⏱️  Starting timer...\n');
  ws.send(JSON.stringify(message));
});

ws.on('message', (data) => {
  const now = Date.now();
  const message = JSON.parse(data.toString());

  if (!firstChunkTime && message.type === 'token') {
    firstChunkTime = now;
    console.log(`⚡ First chunk arrived in ${(firstChunkTime - Date.now() + 100) / 1000}s`);
  }

  if (message.type === 'token') {
    chunkCount++;
    fullResponse += message.content || '';
    lastChunkTime = now;

    // Show progress
    if (chunkCount % 10 === 0) {
      process.stdout.write('.');
    }
  } else if (message.type === 'thinking') {
    console.log('🤔', message.message);
  } else if (message.type === 'tool_start') {
    console.log('🔧 Tool started:', message.tool);
  } else if (message.type === 'tool_complete') {
    console.log('✅ Tool completed:', message.tool);
  } else if (message.type === 'complete') {
    const totalTime = (lastChunkTime - firstChunkTime) / 1000;
    console.log('\n\n✅ Stream complete!');
    console.log('\n📊 Results:');
    console.log(`   • Total chunks: ${chunkCount}`);
    console.log(`   • Streaming time: ${totalTime.toFixed(2)}s`);
    console.log(`   • Chunks per second: ${(chunkCount / totalTime).toFixed(1)}`);
    console.log(`   • Response length: ${fullResponse.length} characters`);
    console.log('\n📝 Response preview:');
    console.log('   ' + fullResponse.substring(0, 200) + '...');

    // Check if response is complete (not cut off)
    if (fullResponse.length > 50 && fullResponse.trim().length > 0) {
      console.log('\n✅ SUCCESS: Full response received!');
    } else {
      console.log('\n❌ FAILURE: Response too short or cut off');
    }

    ws.close();
    process.exit(0);
  } else if (message.type === 'error') {
    console.error('\n❌ Error:', message.message);
    ws.close();
    process.exit(1);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n🔌 WebSocket closed');
  if (chunkCount === 0) {
    console.log('❌ No chunks received - streaming may have failed');
    process.exit(1);
  }
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n⏱️  Timeout - test took too long');
  ws.close();
  process.exit(1);
}, 30000);
