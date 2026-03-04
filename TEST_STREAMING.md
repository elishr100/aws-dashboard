# Testing the Streaming Fix

## Quick Verification

### 1. Check the Code Changes
```bash
cd /Users/Eli.Shriki/ssm-config/aws-dashboard

# Verify streaming imports are present
grep "ConverseStreamCommand" src/services/ClaudeMCPService.ts
# Should show: ConverseStreamCommand,

# Verify streaming method exists
grep "queryStream" src/services/ClaudeMCPService.ts
# Should show: async *queryStream(prompt: string)

# Verify orchestrator uses it
grep "queryStream" src/services/ChatOrchestrator.ts
# Should show: for await (const chunk of this.claudeService.queryStream(prompt))
```

### 2. Start the Backend
```bash
npm run dev
```

Watch for these logs on startup:
- `[ClaudeMCP] Initialized with profile=dev-ah, region=us-west-2`
- `[ChatOrchestrator] Initialized with shared ClaudeMCPService instance`

### 3. Test via UI

Open the dashboard in your browser and ask a question like:
> "What are my top 5 most expensive resources?"

**Expected behavior:**
1. **Immediate start** (< 2 seconds): First words appear quickly
2. **Smooth streaming**: Text flows continuously
3. **No long pauses**: No 50ms delays between words
4. **Complete response**: Full answer appears
5. **Tool visibility**: See "Executing call_aws..." notifications

**Watch backend logs for:**
```
[ChatOrchestrator] Starting real-time streaming from Bedrock...
[ClaudeMCP] Starting streaming query
[ClaudeMCP] Processing stream chunks...
[ClaudeMCP] Yielding text chunk: Based on...
[ChatOrchestrator] Stream chunk 1: type=text
[ChatOrchestrator] Stream chunk 2: type=text
[ChatOrchestrator] Stream chunk 3: type=text
...
[ChatOrchestrator] Response streaming completed successfully (50 chunks)
```

### 4. Compare Before/After

**BEFORE (broken):**
- Long wait (30+ seconds)
- Only "The" appears
- Response stops
- No more text arrives

**AFTER (fixed):**
- Quick start (1-2 seconds)
- Text streams continuously
- Full response appears
- Matches CLI speed

## Troubleshooting

### If response still cuts off:

1. **Check WebSocket logs:**
   ```
   [ChatOrchestrator] WebSocket closed during stream (readyState=3)
   ```
   → Frontend closed connection too early

2. **Check for errors:**
   ```
   [ClaudeMCP] Stream error [ErrorName]: ...
   ```
   → Bedrock API issue

3. **Check credentials:**
   ```
   [ClaudeMCP] CRITICAL: Credential failure
   ```
   → AWS credentials expired

4. **Check stream chunks:**
   If you don't see:
   ```
   [ClaudeMCP] Yielding text chunk: ...
   ```
   → Stream isn't producing output (Bedrock issue)

### Debug Commands

```bash
# Test Bedrock directly via CLI (should stream instantly)
aws bedrock-runtime converse-stream \
  --model-id us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
  --messages '[{"role":"user","content":[{"text":"Hello"}]}]' \
  --profile dev-ah \
  --region us-west-2

# Check backend logs in real-time
tail -f backend.log

# Test WebSocket connection
# (use browser dev tools → Network → WS tab)
```

## Performance Metrics

**Expected improvements:**
- First token latency: **30s → 1-2s** (15-30x faster)
- Full response time: **55s → 5-10s** (5-11x faster)
- User experience: **Broken → Smooth streaming**

## Key Files Modified

1. **src/services/ClaudeMCPService.ts:706**
   - Added `queryStream()` async generator
   - Uses `ConverseStreamCommand` for real-time streaming

2. **src/services/ChatOrchestrator.ts:217**
   - Modified `streamClaudeResponse()`
   - Removed artificial 50ms delays
   - Added WebSocket state checks

## Success Criteria

✅ Response starts within 2 seconds
✅ Text streams smoothly without pauses
✅ Full response appears completely
✅ Backend logs show chunk processing
✅ No WebSocket closed errors
✅ Performance matches CLI speed
