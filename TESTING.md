# Testing the Fixes

This document provides step-by-step instructions to test and verify the fixes.

## Prerequisites

1. **AWS Credentials** - Ensure you have valid credentials for the `dev-ah` profile:
   ```bash
   # Test credentials
   aws configure export-credentials --profile dev-ah --format env

   # Should output:
   # export AWS_ACCESS_KEY_ID=ASIA...
   # export AWS_SECRET_ACCESS_KEY=...
   # export AWS_SESSION_TOKEN=...
   ```

2. **Bedrock Access** - Verify Bedrock is enabled in us-west-2 for account 307122262482

## Quick Test Scripts

### Test 1: Chat Functionality

This tests if the AI assistant can connect to Bedrock and respond.

```bash
cd backend
npx tsx test-chat.ts
```

**Expected Output:**
```
🧪 Testing Chat Functionality
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Initializing ClaudeMCPService...
   ✅ Service initialized

2️⃣ Testing simple query...
   ⏳ Sending query to Claude...
   ✅ Response received in 2.34s

3️⃣ Response:
────────────────────────────────────────────────────────────
Hello! I am working correctly.
────────────────────────────────────────────────────────────

✅ All tests passed!
```

**If it fails:**
- Check error message for hints
- Review credential troubleshooting in FIXES_SUMMARY.md
- Verify Bedrock permissions

### Test 2: Cost Retrieval

This tests if cost data can be fetched from Cost Explorer.

```bash
cd backend
npx tsx test-costs.ts
```

**Expected Output:**
```
💰 Testing Cost Retrieval Functionality
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ Initializing CostAnalysisService...
   ✅ Service initialized

2️⃣ Creating mock resources...
   ✅ Created 3 mock resources

3️⃣ Fetching costs from AWS Cost Explorer...
   ⏳ This may take 30-60 seconds...
   ✅ Costs retrieved in 45.67s

4️⃣ Cost Results:
────────────────────────────────────────────────────────────
   ✅ Retrieved costs for 3 resources:

   EC2: i-1234567890abcdef0
      Current Month: $25.50
      Avg Monthly:   $23.75
      ...
────────────────────────────────────────────────────────────

✅ Cost retrieval test passed!
```

**Note:** It's normal if no costs are returned if the account has no usage in Cost Explorer.

## Full Integration Test

### Step 1: Start Backend

```bash
cd backend
npm run dev
```

Wait for:
```
🚀 AWS Cloud Governance Dashboard - Backend
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Server: http://localhost:3001
💬 Chat WebSocket: ws://localhost:3001/api/chat
```

### Step 2: Start Frontend

In a new terminal:
```bash
cd frontend
npm run dev
```

Wait for:
```
  VITE v... ready in ...ms

  ➜  Local:   http://localhost:5173/
```

### Step 3: Test Resources Table

1. Open http://localhost:5173 in browser
2. Navigate to **Resources** page
3. Verify table layout:
   - [ ] Columns have fixed widths
   - [ ] Type column: 80px
   - [ ] Name column: 250px, truncates with tooltip
   - [ ] ID column: 150px, truncates to 20 chars
   - [ ] Hover over long ID shows full ID in tooltip
   - [ ] Region column: 100px
   - [ ] State column: 100px
   - [ ] Current Month Cost: 140px
   - [ ] Avg Cost/Month: 130px

4. Run a scan:
   - Navigate to **Scan** page
   - Select profile: `dev-ah`
   - Select regions: `us-west-2`
   - Click **Start Scan**
   - Wait for scan to complete

5. Check Resources page again:
   - [ ] Cost columns show actual values or "-"
   - [ ] $0.00 displays for zero-cost resources (not "-")
   - [ ] Cost badges have colors (green < $10, yellow < $100, red > $100)

6. **Check Backend Logs:**
   ```
   [CostAnalysis] Fetching resource costs for N resources
   [CostAnalysis] Sending Cost Explorer query to Claude...
   [CostAnalysis] Received Cost Explorer response, length: XXX
   [CostAnalysis] Processing N cost entries
   [CostAnalysis] Mapping cost: EC2, current: $X, avg: $Y
   [CostAnalysis] Successfully mapped costs for N resources
   ```

### Step 4: Test AI Chat

1. Click chat icon in bottom-right corner
2. Chat panel should slide in from right
3. Verify connection status:
   - [ ] Shows "● Connected" (green dot)
   - [ ] WebSocket URL in DevTools Network tab shows 101 Switching Protocols

4. Send test message: **"hello"**
   - [ ] "Thinking..." indicator appears
   - [ ] Stop button (red circle) appears next to thinking indicator
   - [ ] Response streams word-by-word
   - [ ] Complete message appears
   - [ ] Timestamp shows at bottom

5. Test stop button:
   - Send message: **"Tell me a long story"**
   - Click Stop button while thinking
   - [ ] Request cancelled message appears
   - [ ] No partial response displayed

6. Test actual queries:
   - **"What are my most expensive resources?"**
   - **"Show me all EC2 instances"**
   - **"What is my total monthly cost?"**

7. **Check Backend Logs:**
   ```
   [WebSocket] Chat client connected: <session-id>
   [ChatOrchestrator] Handling message for session <id>, profile: dev-ah, region: us-west-2
   [ChatOrchestrator] Building context for dev-ah in us-west-2
   [ChatOrchestrator] Sending thinking indicator
   [ChatOrchestrator] Starting Claude response stream
   [ClaudeMCP] Executing Claude API with profile=dev-ah, region=us-west-2
   [ClaudeMCP] Credentials: Access Key starts with ASIA...
   [ChatOrchestrator] Querying Claude API...
   [ChatOrchestrator] Received response from Claude, length: XXX
   [ChatOrchestrator] Streaming XXX words to client
   [ChatOrchestrator] Response streaming completed
   ```

## Browser DevTools Checks

### Console (F12 → Console)

Should see:
```
[Chat] WebSocket connected
```

Should NOT see errors like:
- ❌ WebSocket connection failed
- ❌ Failed to send message
- ❌ TypeError: ...

### Network Tab (F12 → Network → WS)

1. Filter by WS (WebSocket)
2. Click on `/api/chat` connection
3. Verify:
   - [ ] Status: 101 Switching Protocols
   - [ ] Messages tab shows:
     - `{"type":"connected","sessionId":"..."}`
     - `{"type":"thinking",...}`
     - `{"type":"token","content":"word ",...}`
     - `{"type":"complete",...}`

## Common Issues & Solutions

### ❌ Chat shows "○ Disconnected"

**Problem:** WebSocket not connecting

**Solution:**
1. Check backend is running on port 3001
2. Check browser console for errors
3. Verify no firewall blocking WebSocket
4. Try refreshing page

---

### ❌ Chat shows "Thinking..." forever

**Problem:** Backend not responding or Bedrock error

**Solution:**
1. Check backend console for errors
2. Look for credential errors
3. Verify Bedrock access
4. Check Claude API logs
5. Wait for 120-second timeout
6. Click Stop button to cancel

---

### ❌ Costs show "-" for all resources

**Problem:** Cost Explorer not returning data

**Solution:**
1. Run `npx tsx test-costs.ts` to debug
2. Check backend logs for Cost Explorer errors
3. Verify Cost Explorer enabled in account
4. Check IAM permissions: `ce:GetCostAndUsage`
5. Verify account has cost data (takes 24-48 hours for new accounts)

---

### ❌ "No AWS credentials available"

**Problem:** Profile not found or expired

**Solution:**
```bash
# Check if profile exists
cat ~/.aws/config | grep dev-ah

# Test credentials
aws configure export-credentials --profile dev-ah --format env

# If using temporary credentials, refresh
awsume dev-ah

# Restart backend after refreshing
```

---

## Success Criteria

All tests pass when:

✅ **Resources Table:**
- Fixed column widths
- ID truncation working
- Tooltips show full values
- Costs display correctly
- $0.00 shows instead of "-" for zero costs

✅ **AI Chat:**
- WebSocket connects
- "Connected" status shows
- Messages stream word-by-word
- Stop button works
- Error messages are clear
- Backend logs show detailed info

✅ **Backend Logs:**
- No errors in console
- Credentials logged correctly
- Cost queries execute
- Chat responses complete
- All services initialized

## Need Help?

1. **Check backend console** - Most issues show errors here
2. **Check FIXES_SUMMARY.md** - Detailed troubleshooting guide
3. **Run test scripts** - `test-chat.ts` and `test-costs.ts`
4. **Check DevTools** - Browser console and Network tab
5. **Verify credentials** - Run `aws configure export-credentials`

## Performance Notes

- **First chat message**: 3-5 seconds (credential fetch + context build)
- **Subsequent messages**: 1-3 seconds (cached credentials)
- **Cost retrieval**: 30-60 seconds (Claude queries Cost Explorer)
- **Scan + costs**: 2-5 minutes for multiple regions

Timeouts:
- Chat response: 120 seconds
- Cost query: 120 seconds
- Individual tool calls: 120 seconds
- Full scan: 1800 seconds (30 minutes)
