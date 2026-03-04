# Cost Data Fix Summary

## Issues Fixed

### 1. Resources Page - Cost Data Not Showing
**Problem**: Resources in the Resources page showed "-" for cost columns instead of actual dollar amounts.

**Root Cause**:
- `fetchResourceCosts()` in `scan.ts` was calling `CostAnalysisService.getResourceCosts()` but was only updating in-memory cache
- Cost data was not being persisted to disk, so it would be lost on server restart
- Global resources (IAM, Bedrock, etc.) were not included in cost enrichment

**Fix Applied**:
- Modified `fetchResourceCosts()` in `backend/src/routes/scan.ts` (lines 481-580)
- Now includes global resources in cost fetch
- Calculates total costs and aggregates by service type
- Persists enriched resources with costs to BOTH in-memory AND persistent cache
- Saves aggregated cost summary to persistent cache at key `costs:${profile}`

### 2. Analytics Page - Total Cost Showing $0
**Problem**: Analytics page showed "$0" for Total Cost even when real AWS costs existed.

**Root Cause**:
- `AggregationService.aggregateMetrics()` tried to load cost data from persistent cache at key `costs:${profile}`
- No code was saving cost data to that cache key
- Trend was hardcoded as 'INCREASING' instead of being calculated from real data

**Fix Applied**:
- Modified `fetchResourceCosts()` in `backend/src/routes/scan.ts` to save cost summary:
  ```typescript
  const costData = {
    totalCost: totalCurrentMonthCost,
    previousMonthCost,
    avgMonthlyCost: totalAvgMonthlyCost,
    trend: 'INCREASING' | 'DECREASING' | 'STABLE',
    costByService: { 'EC2': 50.00, 'S3': 30.00, ... },
    currency: 'USD',
    lastUpdated: ISO timestamp,
    profile
  };
  await persistentCache.set(`costs:${profile}`, costData);
  ```
- Modified `AggregationService.aggregateMetrics()` in `backend/src/services/AggregationService.ts`:
  - Now reads `trend` from cached cost data instead of hardcoding
  - Reads `previousMonthCost` for proper cost comparison
  - Calculates trend badge based on real month-over-month data

## Files Modified

1. **backend/src/routes/scan.ts**
   - Function: `fetchResourceCosts()` (lines 481-580)
   - Changes:
     - Added global resources to cost fetch
     - Added cost aggregation and service breakdown
     - Added previous month cost fetch for trend calculation
     - Added persistent cache writes for both resources and cost summary
     - Now saves: `costs:${profile}` with complete cost data

2. **backend/src/services/AggregationService.ts**
   - Function: `aggregateMetrics()` (lines 125-265)
   - Changes:
     - Added reading of `trend` from cached cost data
     - Added reading of `previousMonthCost` for comparison
     - Fixed TypeScript errors (OrganizationService constructor, trend type)
     - Now uses real cost data instead of mocked data for Analytics

## How Cost Data Flows

### During Scan:
1. `executeScanInternal()` discovers resources across regions
2. After discovery completes, calls `fetchResourceCosts(profile, regions)`
3. `fetchResourceCosts()`:
   - Collects all resources (regional + global) from cache
   - Calls `CostAnalysisService.getResourceCosts()` to fetch costs via Cost Explorer
   - Cost Explorer returns service-level costs, distributed evenly across resources of each type
   - Attaches cost data to each resource object
   - Saves enriched resources back to cache (both in-memory and persistent)
   - Calculates total costs and trend
   - Saves cost summary to `costs:${profile}` key

### During Analytics Display:
1. Frontend requests `/api/analytics/summary`
2. `AggregationService.aggregateMetrics()`:
   - Loads `costs:${profile}` from persistent cache for each account
   - Aggregates costs across all accounts
   - Uses trend from cache (calculated during scan)
   - Returns summary with real Total Cost and trend badge

### During Resources Display:
1. Frontend requests `/api/resources?profile=X&region=Y`
2. Route handler loads resources from cache
3. Resources include `cost` field with:
   - `currentMonthCost`: Current month cost (month-to-date)
   - `avgMonthlyCost`: Average cost over last 3 months
   - `currency`: 'USD'
   - `lastUpdated`: ISO timestamp
4. Frontend displays costs in table columns

## Cost Calculation Details

### Cost Explorer Call (Once Per Scan):
```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-03-01,End=2026-03-04 \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region us-east-1 \
  --profile <profile>
```

### Service Cost Mapping:
```typescript
costByService = {
  'Amazon Elastic Compute Cloud - Compute': 150.00,
  'Amazon Simple Storage Service': 30.00,
  'Amazon Virtual Private Cloud': 41.07,  // Includes NAT Gateway
  'Claude Sonnet 4.5 (Amazon Bedrock Edition)': 26.94,
  'AWS Lambda': 10.00,
  ...
}
```

### Resource Cost Distribution:
```typescript
// Example: 3 EC2 instances, total EC2 cost $150
perResourceCost = 150.00 / 3 = $50.00
resource.cost = {
  currentMonthCost: 50.00,
  avgMonthlyCost: 45.00,
  currency: 'USD',
  lastUpdated: '2026-03-04T10:30:00Z'
}
```

## Verification Steps

### 1. Test Cost Data in Resources Page:
```bash
# Start backend
cd ~/ssm-config/aws-dashboard/backend
npm start

# In another terminal, trigger a scan
curl -X POST http://localhost:3001/api/scan \
  -H "Content-Type: application/json" \
  -d '{"profile":"dev-ah","regions":["us-west-2"]}'

# Wait for scan to complete (check logs), then query resources
curl "http://localhost:3001/api/resources?profile=dev-ah&region=us-west-2" | jq '.resources[0].cost'

# Expected output:
{
  "currentMonthCost": 50.00,
  "avgMonthlyCost": 45.00,
  "currency": "USD",
  "lastUpdated": "2026-03-04T..."
}
```

### 2. Test Total Cost in Analytics Page:
```bash
# Query analytics summary
curl "http://localhost:3001/api/analytics/summary" | jq '.overview.totalCost, .costs.trend'

# Expected output (non-zero values):
150.00
"INCREASING"

# Check cost breakdown by service
curl "http://localhost:3001/api/analytics/summary" | jq '.costs.byService'

# Expected output:
{
  "EC2": 50.00,
  "S3": 30.00,
  "RDS": 40.00,
  ...
}
```

### 3. Verify Cost Persistence:
```bash
# Check persistent cache
ls -la ~/.aws-dashboard/cache/dev-ah/

# Should see:
# - resources_us-west-2.json (with cost fields)
# - resources_global.json (with cost fields)
# - costs.json (cost summary)

# View cost summary
cat ~/.aws-dashboard/cache/dev-ah/costs.json | jq
```

### 4. Test Frontend Display:
1. Open browser to http://localhost:3000
2. Navigate to **Resources** page
3. **Verify**:
   - "Current Month Cost" column shows dollar amounts (not "-")
   - "Avg Cost/Month" column shows dollar amounts (not "-")
   - Cost badges are colored (green < $10, yellow $10-$100, red > $100)
4. Navigate to **Analytics** page
5. **Verify**:
   - "Total Cost" card shows real dollar amount (not $0)
   - Trend badge shows INCREASING/DECREASING/STABLE (not hardcoded)
   - "Cost by Service" chart shows breakdown
   - "Top Spenders" table shows accounts with costs

## Important Notes

### Cost Explorer Requirements:
- IAM role/user must have `ce:GetCostAndUsage` permission
- Cost Explorer API is only available in `us-east-1` region
- Costs are approximate - distributed evenly across resources of same type
- Bedrock costs may be billed to payer account (will show $0 in member accounts)

### Cache Keys:
- Resources: `resources:${profile}:${region}`
- Global resources: `resources:${profile}:global`
- Cost summary: `costs:${profile}`
- Cache location: `~/.aws-dashboard/cache/${profile}/`

### Cost Data Structure:
```typescript
// Per-resource cost
resource.cost = {
  currentMonthCost: number;    // Current month cost (month-to-date)
  avgMonthlyCost: number;      // Average of last 3 months
  currency: string;            // 'USD'
  lastUpdated: string;         // ISO timestamp
}

// Aggregated cost summary (costs:${profile})
{
  totalCost: number;           // Sum of all resource costs
  previousMonthCost: number;   // Last complete month
  avgMonthlyCost: number;      // Average of last 3 months
  trend: 'INCREASING' | 'DECREASING' | 'STABLE';
  costByService: Record<string, number>;  // Cost per service type
  currency: 'USD';
  lastUpdated: string;
  profile: string;
}
```

## Troubleshooting

### Cost Shows "-" for All Resources:
1. Check if Cost Explorer is accessible:
   ```bash
   aws ce get-cost-and-usage \
     --time-period Start=2026-03-01,End=2026-03-04 \
     --granularity MONTHLY \
     --metrics BlendedCost \
     --region us-east-1 \
     --profile dev-ah
   ```
2. Verify IAM permissions include `ce:GetCostAndUsage`
3. Check backend logs for "Cost Explorer access denied" errors

### Analytics Shows $0:
1. Check if cost summary exists in cache:
   ```bash
   cat ~/.aws-dashboard/cache/dev-ah/costs.json
   ```
2. If missing, trigger a new scan (cost fetch happens after scan completes)
3. Check backend logs for cost fetch errors

### Costs Not Persisting After Restart:
1. Verify persistent cache directory exists:
   ```bash
   ls -la ~/.aws-dashboard/cache/
   ```
2. Check file permissions (should be readable/writable)
3. Look for cache write errors in backend logs

## Next Steps (Optional Enhancements)

1. **Add Cost Alerts**: Notify when costs exceed thresholds
2. **Cost Trends Chart**: Show historical cost trends over time
3. **Resource Tagging**: Allow cost allocation by tags
4. **Cost Forecasting**: Predict end-of-month costs
5. **Budget Tracking**: Set budgets and track against actuals
6. **Cost Optimization**: Identify resources with high cost/low utilization
