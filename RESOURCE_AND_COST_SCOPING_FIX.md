# Resource and Cost Scoping Fix

## Date: 2026-03-03

## Issues Fixed

### 1. IAM Roles Not Showing in Dashboard

**Problem:**
- IAM is a global service discovered once per account and cached under `resources:${profile}:global:iam` with `region="global"`
- The Resources page fetches resources using a specific region filter (e.g., `us-west-2`)
- This caused IAM roles to be excluded from the dashboard when viewing regional resources

**Solution:**
Modified `/backend/src/routes/resources.ts` (line 78-151):
- The `/api/resources` endpoint now ALWAYS includes global resources (IAM roles) in addition to the requested region's resources
- Added logic to fetch from both the regional cache (`resources:${profile}:${region}`) and the global IAM cache (`resources:${profile}:global:iam`)
- IAM roles now appear in "Resources by Type" regardless of selected region filter

**Code Changes:**
```typescript
// ALWAYS include global resources (IAM roles) regardless of region filter
const globalCacheKey = CacheService.resourceKey(profile as string, 'global', 'iam');
const globalCached = cacheService.get<ResourceInventory>(globalCacheKey);

if (globalCached && globalCached.resources) {
  console.log(`[API] Adding ${globalCached.resources.length} global IAM roles to response`);
  allResources = [...allResources, ...globalCached.resources];
}
```

### 2. Bedrock Costs Missing - Billed to Payer Account

**Problem:**
- Bedrock costs are typically billed to the organization payer/management account in AWS Organizations, not member accounts
- Member accounts show $0 Bedrock cost, causing confusion
- No indication that costs might be billed elsewhere

**Solution:**
Modified `/backend/src/services/CostAnalysisService.ts`:

1. **Added payer account detection** (line 226-271):
   - New method `getPayerAccountInfo()` queries AWS Organizations to identify the payer/management account
   - Uses AWS CLI command: `aws organizations describe-organization --region us-east-1`
   - Returns account ID and email if available

2. **Added Bedrock cost checking** (line 848-902):
   - New method `checkBedrockBilling()` queries Cost Explorer for Bedrock costs
   - If Bedrock cost is $0, attempts to identify the payer account
   - Generates a user-friendly note explaining where Bedrock costs may be billed

3. **Updated cost dashboard summary** (line 763-847):
   - Modified `getCostDashboardSummary()` to include billing notes
   - Calls `checkBedrockBilling()` and adds notes to the response

4. **Updated type definitions**:
   - Added `notes?: string[]` field to `CostDashboardSummary` interface in both backend and frontend
   - Backend: `/backend/src/types/cost.ts` (line 179)
   - Frontend: `/frontend/src/types/cost.ts` (line 11)

5. **Updated frontend dashboard** (line 171-187 in `/frontend/src/pages/Dashboard.tsx`):
   - Added a yellow-highlighted card to display cost notes
   - Shows Bedrock billing information and payer account details when available

**Example Notes:**
```
⚠️ Bedrock costs ($0 in this account) may be billed to the organization payer account: 123456789012 (aws+master@example.com)
```

or

```
⚠️ Bedrock costs ($0 in this account) may be billed to the organization payer/management account. Check the billing account for actual Bedrock usage.
```

## Files Modified

1. **Backend:**
   - `/backend/src/routes/resources.ts` - Added global IAM resource inclusion
   - `/backend/src/services/CostAnalysisService.ts` - Added Bedrock detection and payer account lookup
   - `/backend/src/types/cost.ts` - Added `notes` field to CostDashboardSummary

2. **Frontend:**
   - `/frontend/src/types/cost.ts` - Added `notes` field to CostDashboardSummary
   - `/frontend/src/pages/Dashboard.tsx` - Added cost notes display card

## Testing Recommendations

### Test IAM Roles Display:
1. Run a scan with IAM discovery: `POST /api/scan` with profile and regions
2. Verify IAM roles are cached: `GET /api/resources/cache/debug`
   - Should see: `resources:dev-ah:global:iam` key with IAM roles
3. View resources for a specific region: `GET /api/resources?profile=dev-ah&region=us-west-2`
   - Should include both regional resources AND IAM roles
4. Check dashboard "Resources by Type" - should show IAMRole count

### Test Bedrock Cost Detection:
1. Query cost dashboard: `GET /api/cost/dashboard?profile=dev-ah`
2. If Bedrock cost is $0, response should include:
   ```json
   {
     "totalCurrentMonth": 123.45,
     "projectedMonthEnd": 200.00,
     "topExpensiveResources": [...],
     "currency": "USD",
     "notes": [
       "⚠️ Bedrock costs ($0 in this account) may be billed to the organization payer account: 123456789012 (email@example.com)"
     ]
   }
   ```
3. View frontend dashboard - yellow card should appear with cost notes

### Manual Verification Commands:

Check if Bedrock shows any costs in dev-ah:
```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-02-01,End=2026-03-01 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --profile dev-ah \
  --region us-east-1 | grep -i bedrock
```

Check organization payer account:
```bash
aws organizations describe-organization \
  --profile dev-ah \
  --region us-east-1
```

## Architecture Notes

### IAM Discovery Flow:
```
1. POST /api/scan → executeScan()
2. discoverIAMRoles() called ONCE (line 309-335 in scan.ts)
3. IAM roles cached under: resources:${profile}:global:iam
4. Region loop starts - regional resources cached separately
5. GET /api/resources merges regional + global resources
```

### Cost Detection Flow:
```
1. GET /api/cost/dashboard → getCostDashboardSummary()
2. checkBedrockBilling() queries Cost Explorer for Bedrock
3. If $0, getPayerAccountInfo() queries AWS Organizations
4. Notes added to response
5. Frontend displays notes in yellow card
```

## Known Limitations

1. **IAM Roles:**
   - IAM roles are only discovered during a full scan
   - If IAM cache expires, roles won't show until next scan
   - Solution: Run periodic scans or increase cache TTL

2. **Bedrock Cost Detection:**
   - Requires AWS Organizations access to identify payer account
   - If Organizations is not enabled, generic message is shown
   - Only checks Bedrock service - could be extended to other centralized billing services

3. **Performance:**
   - Each cost dashboard request now queries for Bedrock costs and Organizations
   - Added 30-second timeouts to prevent blocking
   - Consider caching payer account info for longer periods

## Future Enhancements

1. **Cache payer account information** - avoid querying AWS Organizations on every request
2. **Extend to other services** - Check for other services that may be centrally billed (e.g., Route 53, CloudFront)
3. **Add cost allocation tags** - Use tags to track Bedrock usage by account/team
4. **Multi-account cost aggregation** - Show costs across all member accounts in the organization
5. **IAM role filtering** - Add ability to filter IAM roles by trust policy, permissions, etc.

## Related Documentation

- IAM Discovery: `/backend/src/agents/ResourceDiscoveryAgent.ts` (line 47-51, 394-486)
- Scan Flow: `/backend/src/routes/scan.ts` (line 309-335)
- Cache Service: `/backend/src/services/CacheService.ts` (line 193-197)
- Cost Analysis: `/backend/src/services/CostAnalysisService.ts`
