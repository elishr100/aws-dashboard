# AWS Dashboard Fixes - Summary

## Date: 2026-03-02

### Issues Fixed

## 1. Resources Table Layout and Cost Display ✓

### Changes Made:

#### Frontend: `/frontend/src/pages/Resources.tsx`

**Table Layout Improvements:**
- ✅ Changed table to `table-fixed` layout for consistent column widths
- ✅ Set fixed column widths:
  - Type: 80px
  - Name: 250px
  - ID: 150px (with truncation)
  - Region: 100px
  - State: 100px
  - Current Month Cost: 140px
  - Avg Cost/Month: 130px

**ID Column Truncation:**
- ✅ Truncate IDs longer than 20 characters to `{first20}...`
- ✅ Show full ID on hover using `title` attribute
- ✅ Added `truncate` class to prevent overflow

**Cost Display Fix:**
- ✅ Fixed `formatCost` function to properly handle `0` values
- Changed from `if (!cost)` to `if (cost === undefined || cost === null)`
- Now displays `$0.00` instead of `-` for zero-cost resources

#### Backend: `/backend/src/services/CostAnalysisService.ts`

**Enhanced Cost Retrieval:**
- ✅ Added comprehensive logging for Cost Explorer queries
- ✅ Enhanced error handling with detailed console logs
- ✅ Improved service name to resource type mapping
- ✅ Added 2-minute timeout for Cost Explorer queries
- ✅ Better JSON extraction and validation
- ✅ Detailed logging of:
  - Query parameters (date ranges)
  - Response size and preview
  - Extracted cost data
  - Resource counts by type
  - Number of resources assigned costs

**Cost Calculation Logic:**
- Uses AWS Cost Explorer API to get service-level costs
- Distributes costs proportionally across resources of the same type
- Calculates both current month and 3-month average costs
- Maps AWS service names to resource types:
  - "Amazon Elastic Compute Cloud - Compute" → EC2
  - "Amazon Simple Storage Service" → S3
  - "Amazon Relational Database Service" → RDS
  - "AWS Lambda" → Lambda
  - "Elastic Load Balancing" → ELB
  - "Amazon Virtual Private Cloud" → VPC

---

## 2. AI Assistant Chat Not Responding ✓

### Changes Made:

#### Backend: `/backend/src/services/ChatOrchestrator.ts`

**Enhanced Error Handling:**
- ✅ Added comprehensive logging at every step:
  - Session creation
  - Context building
  - Profile/region updates
  - Claude API calls
  - Response streaming
- ✅ Enhanced error messages with profile/region context
- ✅ Added credential validation messages
- ✅ Profile switching detection and logging

**Credential Management:**
- ✅ Ensures ClaudeMCPService profile is updated when it changes
- ✅ Validates credentials before making API calls
- ✅ Provides detailed error messages when credentials fail

**Response Streaming:**
- ✅ Added 2-minute timeout for Claude API queries
- ✅ Validates response is not empty before streaming
- ✅ Logs word count and streaming progress
- ✅ Enhanced error handling in stream processing

#### Backend: `/backend/src/services/ClaudeMCPService.ts`

**Enhanced Credential Logging:**
- ✅ Added detailed credential validation logging:
  - Access key prefix (first 8 chars)
  - Session token presence check
  - Profile and region being used
  - Prompt length and preview
- ✅ Better error messages for credential failures
- ✅ Validates credentials are cached correctly

---

## How to Test

### 1. Resources Table

1. **Start the backend:**
   ```bash
   cd backend
   npm run dev
   ```

2. **Start the frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

3. **Test the table:**
   - Navigate to the Resources page
   - Check that ID column truncates long IDs
   - Hover over truncated IDs to see full ID in tooltip
   - Verify cost columns show actual values or "-"
   - Check that $0.00 displays correctly (not "-")
   - Verify all columns have consistent widths

4. **Test cost data after scan:**
   - Go to Scan page
   - Start a new scan for dev-ah profile, us-west-2 region
   - Wait for scan to complete
   - Navigate to Resources page
   - Check if cost data is populated
   - Look at backend console for cost retrieval logs:
     ```
     [CostAnalysis] Fetching resource costs...
     [CostAnalysis] Sending Cost Explorer query to Claude...
     [CostAnalysis] Processing N cost entries
     [CostAnalysis] Successfully mapped costs for N resources
     ```

### 2. AI Assistant Chat

1. **With backend running, open frontend**

2. **Open the AI chat panel:**
   - Click the chat button in the bottom-right corner

3. **Send a test message:**
   - Type: "hello"
   - Press Enter or click Send

4. **Check backend console for logs:**
   ```
   [ChatOrchestrator] Handling message for session...
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

5. **Verify chat functionality:**
   - Chat should show "Thinking..." indicator
   - Response should stream word-by-word
   - Stop button should appear while thinking
   - Clicking Stop should cancel the request
   - Error messages should be clear and helpful

6. **Test with questions:**
   - "What are my most expensive resources?"
   - "Show me all EC2 instances"
   - "What security issues should I fix first?"

---

## Troubleshooting

### Cost Data Not Showing

**Symptom:** Resources table shows "-" in cost columns

**Checks:**
1. Look for these logs in backend console:
   ```
   [CostAnalysis] Fetching resource costs for N resources
   [CostAnalysis] Sending Cost Explorer query to Claude...
   ```

2. If you see errors:
   - Check AWS credentials for dev-ah profile
   - Verify Cost Explorer API is enabled in account
   - Check that profile has permissions: `ce:GetCostAndUsage`

3. Enable debug mode:
   - Check logs for "Failed to extract JSON from Cost Explorer response"
   - Check logs for Claude API errors

**Known Limitations:**
- Cost Explorer provides service-level costs, not per-resource
- Costs are distributed proportionally across all resources of the same type
- Zero-cost resources (free tier) will show $0.00
- Resources with no Cost Explorer data will show "-"

### Chat Not Responding

**Symptom:** Chat shows "Thinking..." but no response

**Checks:**
1. Look for these logs in backend console:
   ```
   [ChatOrchestrator] Handling message for session...
   [ClaudeMCP] Executing Claude API with profile=dev-ah, region=us-west-2
   [ClaudeMCP] Credentials: Access Key starts with...
   ```

2. If you see credential errors:
   - Verify AWS profile 'dev-ah' exists in ~/.aws/config
   - Check credentials are valid:
     ```bash
     aws configure export-credentials --profile dev-ah --format env
     ```
   - Ensure session is not expired (run awsume if needed)

3. If you see Bedrock errors:
   - Verify account 307122262482 has Bedrock enabled in us-west-2
   - Check profile has permissions: `bedrock:InvokeModel`
   - Verify Claude model ID is available: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`

4. Check WebSocket connection:
   - Open browser DevTools → Network tab
   - Look for WebSocket connection to `ws://localhost:3001/api/chat`
   - Should show "101 Switching Protocols"
   - Check for error messages in WS frames

**Common Errors:**

| Error Message | Cause | Solution |
|--------------|-------|----------|
| "No AWS credentials available" | Profile not found or expired | Run `awsume dev-ah` or refresh credentials |
| "Empty response from Claude API" | Bedrock API error | Check AWS service health, verify model access |
| "Query timeout after 120000ms" | Claude API taking too long | Check network connectivity, try shorter prompt |
| "Failed to get AWS credentials for profile" | Invalid profile name | Verify profile exists in ~/.aws/config |

---

## Files Modified

### Frontend
- ✅ `/frontend/src/pages/Resources.tsx`
  - Table layout with fixed widths
  - ID truncation with tooltip
  - Fixed cost formatting

### Backend
- ✅ `/backend/src/services/ChatOrchestrator.ts`
  - Enhanced error handling and logging
  - Profile switching validation
  - Response streaming improvements

- ✅ `/backend/src/services/ClaudeMCPService.ts`
  - Enhanced credential logging
  - Better error messages

- ✅ `/backend/src/services/CostAnalysisService.ts`
  - Comprehensive cost retrieval logging
  - Improved service name mapping
  - Better error handling
  - 2-minute timeout for queries

---

## Next Steps

### Optional Improvements

1. **Real Per-Resource Costs:**
   - Cost Explorer doesn't provide true per-resource costs
   - Consider using AWS Cost Allocation Tags
   - Or integrate with CloudWatch metrics for actual usage

2. **Cost Data Caching:**
   - Cost queries are expensive (API calls to Claude + Cost Explorer)
   - Consider caching cost data for 6-24 hours
   - Update costs on a schedule rather than every scan

3. **Chat Response Caching:**
   - Cache common questions/answers
   - Reduce Claude API calls for repeated questions

4. **Better Cost Estimation:**
   - Use CloudWatch metrics for actual resource usage
   - Estimate costs based on instance types, storage sizes
   - More accurate than equal distribution

---

## Testing Checklist

- [ ] Resources table displays with fixed column widths
- [ ] Long IDs are truncated to 20 chars + "..."
- [ ] Full ID appears on hover
- [ ] Cost columns show actual values after scan
- [ ] $0.00 displays correctly (not "-")
- [ ] Chat panel opens and connects
- [ ] Chat responds to "hello" message
- [ ] Chat shows thinking indicator
- [ ] Chat streams response word-by-word
- [ ] Stop button cancels request
- [ ] Backend logs show detailed credential info
- [ ] Backend logs show cost retrieval progress
- [ ] Errors are clearly logged and displayed

---

## Known Issues & Limitations

1. **Cost Data Accuracy:**
   - Costs are estimates based on service-level totals
   - Distributed equally across all resources of same type
   - Not actual per-resource costs from Cost Explorer

2. **Chat Performance:**
   - First message may be slow (credential fetch + context building)
   - Subsequent messages should be faster (cached credentials)
   - Large context (many resources) may slow down responses

3. **Timeout Handling:**
   - 120 second timeout for both chat and cost queries
   - Long Cost Explorer queries may timeout
   - Consider reducing number of resources or time range

---

## Support & Contact

For issues or questions:
1. Check backend console logs first
2. Check frontend browser console (DevTools)
3. Review this document's troubleshooting section
4. Check AWS credentials and permissions
5. Verify AWS services (Bedrock, Cost Explorer) are available

---

**End of Fixes Summary**
