#!/usr/bin/env node

/**
 * Test WebSocket reconnection during active stream
 *
 * This script:
 * 1. Connects to the chat WebSocket
 * 2. Sends a message that triggers a long response
 * 3. After receiving some tokens, forcefully closes the connection
 * 4. Reconnects with the same sessionId
 * 5. Verifies that streaming continues
 */

const WebSocket = require('ws');
const http = require('http');

const WS_URL = 'ws://localhost:3001/ws/chat';
const API_URL = 'http://localhost:3001/api/chat/message';

let sessionId = null;
let ws = null;
let receivedTokens = [];
let tokenCount = 0;
let reconnected = false;
let streamComplete = false;

console.log('\n🧪 Testing WebSocket Reconnection During Stream\n');
console.log('='.repeat(60));

// Step 1: Connect to WebSocket
console.log('\n1️⃣  Connecting to WebSocket...');
ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected');
});

ws.on('message', async (data) => {
  const message = JSON.parse(data.toString());

  switch (message.type) {
    case 'connected':
      sessionId = message.sessionId;
      if (message.reconnected) {
        console.log(`🔄 Reconnected with session: ${sessionId}`);
        reconnected = true;
      } else {
        console.log(`📝 New session created: ${sessionId}`);

        // Step 2: Send a message that will trigger a long response
        console.log('\n2️⃣  Sending chat message...');
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: 'List all AWS services available in us-east-1',
            profile: 'dev-ah',
            region: 'us-west-2'
          })
        });

        if (response.ok) {
          console.log('✅ Message sent successfully');
        } else {
          console.error('❌ Failed to send message:', await response.text());
          process.exit(1);
        }
      }
      break;

    case 'thinking':
      console.log('\n3️⃣  Backend is processing...');
      break;

    case 'token':
      tokenCount++;
      receivedTokens.push(message.content);

      // After receiving 5 tokens, simulate disconnection
      if (tokenCount === 5 && !reconnected) {
        console.log(`\n🔌 Received ${tokenCount} tokens, simulating disconnection...`);
        console.log(`   Last token: "${message.content}"`);

        // Close the WebSocket
        ws.close();

        // Wait a moment, then reconnect
        setTimeout(() => {
          console.log('\n4️⃣  Reconnecting with existing sessionId...');
          ws = new WebSocket(WS_URL);

          ws.on('open', () => {
            console.log('✅ New WebSocket connection opened');
            // Send reconnect message with existing sessionId
            ws.send(JSON.stringify({
              type: 'reconnect',
              sessionId: sessionId
            }));
          });

          // Re-attach message handler to the new WebSocket
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            handleMessage(msg);
          });

          ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
          });

          ws.on('close', () => {
            if (!streamComplete) {
              console.error('❌ WebSocket closed unexpectedly');
            }
          });
        }, 1000);
      } else if (reconnected) {
        // Show tokens received after reconnection
        if (tokenCount % 10 === 0) {
          process.stdout.write('.');
        }
      }
      break;

    case 'complete':
      streamComplete = true;
      const fullResponse = receivedTokens.join('');
      console.log(`\n\n5️⃣  Stream completed!`);
      console.log(`   Total tokens received: ${tokenCount}`);
      console.log(`   Response length: ${fullResponse.length} characters`);
      console.log(`   Reconnection successful: ${reconnected ? '✅ YES' : '❌ NO'}`);

      if (reconnected && tokenCount > 10) {
        console.log('\n' + '='.repeat(60));
        console.log('🎉 TEST PASSED: Stream continued after reconnection!');
        console.log('='.repeat(60));
      } else if (!reconnected) {
        console.log('\n' + '='.repeat(60));
        console.log('⚠️  TEST INCOMPLETE: No reconnection occurred');
        console.log('='.repeat(60));
      }

      ws.close();
      setTimeout(() => process.exit(0), 1000);
      break;

    case 'error':
      console.error(`\n❌ Error: ${message.message}`);
      ws.close();
      setTimeout(() => process.exit(1), 1000);
      break;

    case 'heartbeat':
      // Ignore heartbeats
      break;

    default:
      console.log(`📨 Received: ${message.type}`);
  }
});

function handleMessage(message) {
  switch (message.type) {
    case 'connected':
      if (message.reconnected) {
        console.log(`🔄 Reconnected with session: ${message.sessionId}`);
        reconnected = true;
      }
      break;

    case 'token':
      tokenCount++;
      receivedTokens.push(message.content);

      if (reconnected && tokenCount % 10 === 0) {
        process.stdout.write('.');
      }
      break;

    case 'complete':
      streamComplete = true;
      const fullResponse = receivedTokens.join('');
      console.log(`\n\n5️⃣  Stream completed!`);
      console.log(`   Total tokens received: ${tokenCount}`);
      console.log(`   Response length: ${fullResponse.length} characters`);
      console.log(`   Reconnection successful: ${reconnected ? '✅ YES' : '❌ NO'}`);

      if (reconnected && tokenCount > 10) {
        console.log('\n' + '='.repeat(60));
        console.log('🎉 TEST PASSED: Stream continued after reconnection!');
        console.log('='.repeat(60));
      } else if (!reconnected) {
        console.log('\n' + '='.repeat(60));
        console.log('⚠️  TEST INCOMPLETE: No reconnection occurred');
        console.log('='.repeat(60));
      }

      ws.close();
      setTimeout(() => process.exit(0), 1000);
      break;

    case 'error':
      console.error(`\n❌ Error: ${message.message}`);
      ws.close();
      setTimeout(() => process.exit(1), 1000);
      break;
  }
}

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  if (!streamComplete && tokenCount < 5) {
    console.log('🔌 Initial WebSocket closed (expected if disconnecting for test)');
  }
});

// Timeout after 60 seconds
setTimeout(() => {
  console.error('\n❌ Test timed out after 60 seconds');
  if (ws) ws.close();
  process.exit(1);
}, 60000);
