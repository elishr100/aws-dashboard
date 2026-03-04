#!/usr/bin/env node

/**
 * Test Security Audit SSE Streaming
 *
 * This script tests the security audit SSE implementation by:
 * 1. Starting a security audit job
 * 2. Connecting to the SSE stream
 * 3. Displaying real-time progress and findings
 */

const http = require('http');

const BACKEND_URL = 'http://localhost:3001';
const PROFILE = 'dev-ah';
const REGIONS = ['us-west-2'];

async function startAudit() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      profile: PROFILE,
      regions: REGIONS,
    });

    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/security/audit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function connectToSSE(jobId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: `/api/security/audit/${jobId}/stream`,
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    };

    console.log(`\n📡 Connecting to SSE stream: ${options.path}\n`);

    const req = http.request(options, (res) => {
      let buffer = '';
      let eventCount = 0;

      res.on('data', (chunk) => {
        buffer += chunk.toString();

        // Process complete SSE messages
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        lines.forEach((message) => {
          if (!message.trim()) return;

          const dataMatch = message.match(/^data: (.+)$/m);
          if (dataMatch) {
            try {
              const data = JSON.parse(dataMatch[1]);
              eventCount++;

              console.log(`\n🔔 Event #${eventCount} - Type: ${data.type}`);
              console.log('─'.repeat(60));

              switch (data.type) {
                case 'progress':
                  console.log(`📊 Phase: ${data.data.progress.phase}/${data.data.progress.totalPhases}`);
                  console.log(`📈 Progress: ${data.data.progress.current}%`);
                  console.log(`💬 Message: ${data.data.progress.message}`);
                  console.log(`🔍 Findings: ${data.data.findingsCount || 0}`);
                  break;

                case 'finding':
                  console.log(`⚠️  New Finding Discovered!`);
                  console.log(`   Severity: ${data.data.finding.severity}`);
                  console.log(`   Resource: ${data.data.finding.resourceType} - ${data.data.finding.resourceName || data.data.finding.resourceId}`);
                  console.log(`   Title: ${data.data.finding.title}`);
                  console.log(`   Total Findings: ${data.data.totalFindings}`);
                  break;

                case 'complete':
                  console.log(`✅ Audit Complete!`);
                  console.log(`   Message: ${data.data.message}`);
                  console.log(`\n📊 Final Summary:`);
                  console.log(`   Total: ${data.data.summary.total}`);
                  console.log(`   Critical: ${data.data.summary.critical}`);
                  console.log(`   High: ${data.data.summary.high}`);
                  console.log(`   Medium: ${data.data.summary.medium}`);
                  console.log(`   Low: ${data.data.summary.low}`);
                  console.log(`   Security Score: ${data.data.summary.score}%`);
                  console.log(`\n🎉 Test Successful - SSE Streaming Working Correctly!`);
                  res.destroy();
                  resolve(data.data);
                  break;

                case 'error':
                  console.log(`❌ Error: ${data.data.error}`);
                  res.destroy();
                  reject(new Error(data.data.error));
                  break;

                default:
                  console.log(`   Data:`, JSON.stringify(data.data, null, 2));
              }
            } catch (error) {
              console.error('Error parsing SSE data:', error);
            }
          }
        });
      });

      res.on('end', () => {
        console.log('\n📡 SSE connection closed');
        resolve();
      });

      res.on('error', (error) => {
        console.error('SSE error:', error);
        reject(error);
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    console.log('🚀 Starting Security Audit SSE Test\n');
    console.log('═'.repeat(60));
    console.log(`Profile: ${PROFILE}`);
    console.log(`Regions: ${REGIONS.join(', ')}`);
    console.log('═'.repeat(60));

    // Start audit
    console.log('\n📝 Step 1: Starting security audit job...');
    const auditResult = await startAudit();
    console.log(`✅ Job created: ${auditResult.jobId}`);
    console.log(`📡 Stream URL: ${auditResult.streamUrl}`);

    // Connect to SSE stream
    console.log('\n📝 Step 2: Connecting to SSE stream...');
    await connectToSSE(auditResult.jobId);

    console.log('\n✅ Test completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
