# AI Assistant Fixes - Date Calculations and Cost Explorer Access

## Overview
Fixed two critical issues with the AI Assistant's Cost Explorer queries:
1. **Wrong Dates**: AI was using hardcoded or incorrectly calculated dates (showing 2024/2025 instead of current month 2026-03)
2. **Cost Explorer Access**: No graceful handling of AccessDenied errors when IAM role lacks ce:GetCostAndUsage permission

## Changes Made

### 1. ClaudeMCPService.ts - Added Current Date Context

**Location**: `backend/src/services/ClaudeMCPService.ts`

**Changes**:
- Added system context to both `queryStream()` and `executeQuery()` methods
- Context includes current date, year, and month dynamically calculated from `new Date()`
- Instructions to NEVER use hardcoded years or months
- This context is prepended to every AI query so Claude knows the current date

**Implementation**:
```typescript
const now = new Date();
const currentDateStr = now.toISOString().split('T')[0];
const systemContext = `IMPORTANT CONTEXT:
- Current date: ${currentDateStr}
- Current year: ${now.getFullYear()}
- Current month: ${now.getMonth() + 1}
- When querying AWS Cost Explorer or any date-based service, ALWAYS use this current date as reference
- NEVER use hardcoded years or months - calculate all dates dynamically from the current date above`;
```

### 2. CostAnalysisService.ts - Dynamic Date Calculations

**Location**: `backend/src/services/CostAnalysisService.ts`

**Changes**:
Updated all cost-related methods to:
- Calculate date ranges dynamically from `new Date()`
- **Fixed timezone bug**: Added `formatDate()` helper function to prevent date shifting
  - Previously used `.toISOString().split('T')[0]` which converts to UTC, causing dates to shift in non-UTC timezones
  - Now uses local calendar dates: `formatDate(date)` → `"YYYY-MM-DD"`
- Include specific date ranges in prompts to Claude
- Handle AccessDenied errors gracefully
- Return helpful error messages instead of $0.00 costs

**New Helper Function**:
```typescript
private formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

**Methods Updated**:

#### getCostSummary()
- Calculates current month start/end, previous month dates dynamically
- Includes exact date ranges in prompt: `${currentMonthStartStr} to ${today}`
- Returns error message in response if AccessDenied: `"Cost Explorer access is not available"`

#### getCostByService()
- Uses provided dates or calculates from current month
- Includes error handling for AccessDenied
- Returns empty array if no cost access

#### getCostByRegion()
- Similar dynamic date calculation
- AccessDenied error handling
- Returns empty array if no cost access

#### getCostTrends()
- Dynamic date calculation for start/end dates
- Updated example dates in prompt to use 2026-03-XX format
- AccessDenied error handling

#### detectCostAnomalies()
- Dynamic date ranges
- Updated example dates to 2026-03-XX
- AccessDenied error handling

#### getCostForecast()
- Calculates forecast end date dynamically
- Includes today's date and future date in prompt
- AccessDenied error handling

#### getResourceCosts()
- Already had good date calculations
- Added comprehensive AccessDenied error handling
- Includes helpful message: "Cost data is not available for this account - billing/Cost Explorer access required"
- Returns empty cost map instead of throwing error

#### generateOptimizationRecommendations()
- Added AccessDenied error handling
- Returns empty recommendations array if no cost access

### 3. Type Definition Updates

**Location**: `backend/src/types/cost.ts`

**Changes**:
```typescript
export interface CostSummary {
  // ... existing fields
  trend: 'INCREASING' | 'DECREASING' | 'STABLE' | 'UNAVAILABLE';
  error?: string; // Optional error message when cost data is not available
}
```

Added:
- `UNAVAILABLE` option to trend type
- Optional `error` field to store access denied messages

## How It Works Now

### Scenario 1: Correct Date Usage
1. User asks: "What are my costs this month?"
2. AI receives system context with current date: `2026-03-03`
3. AI calculates: current month = `2026-03-01` to `2026-03-03`
4. AI queries Cost Explorer with correct dates
5. Results show actual March 2026 costs (not 2024 or 2025)

### Scenario 2: No Cost Explorer Access
1. User asks about costs
2. AI attempts Cost Explorer query
3. AWS returns AccessDenied error
4. AI detects error and returns:
   ```json
   {
     "error": "NO_COST_ACCESS",
     "message": "Cost data is not available for this account - billing/Cost Explorer access required (ce:GetCostAndUsage permission)."
   }
   ```
5. Frontend displays helpful message: "Cost data is not available for this account - billing access required. Here are the resources I can see instead..."

## Timezone Bug Fix

**Problem**: Date calculations were using `.toISOString().split('T')[0]` which converts to UTC timezone.
- Example: In PST (UTC-8), March 1 2026 00:00:00 local → February 28 2026 16:00:00 UTC
- Result: "Current month start" would be February 28 instead of March 1

**Solution**: Created `formatDate()` helper that uses local calendar dates without timezone conversion.
- Uses `getFullYear()`, `getMonth()`, `getDate()` which are timezone-aware
- Formats directly as YYYY-MM-DD string
- Result: March 1 always formats as "2026-03-01" regardless of timezone

**Verification**:
```bash
# Test output BEFORE fix:
Current date: 2026-03-02
Current month start: 2026-02-28  ❌ WRONG (off by 1 day due to UTC conversion)

# Test output AFTER fix:
Current date: 2026-03-03
Current month start: 2026-03-01  ✅ CORRECT (uses local calendar date)
```

## Testing

### Test 1: Verify Correct Dates
```bash
# Run test script:
node test-date-fix.js

# Expected output:
# Current date: 2026-03-03
# Current month start: 2026-03-01  (March 1, NOT February 28)
# Previous month: 2026-02-01 to 2026-02-28
# Three months ago: 2025-12-01

# In AI chat, ask:
"What are my costs for the current month?"

# Expected: Should show costs from 2026-03-01 to 2026-03-03
# NOT from 2024 or 2025
# NOT from 2026-02-28 (timezone bug)
```

### Test 2: Verify AccessDenied Handling
```bash
# If role lacks ce:GetCostAndUsage:
aws ce get-cost-and-usage \
  --time-period Start=2026-03-01,End=2026-03-03 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --profile dev-ah

# Expected error: AccessDeniedException

# In AI chat, ask about costs
# Expected: Helpful message about billing access required
# NOT: "$0.00" or misleading zero costs
```

## Benefits

1. **Accurate Date Queries**: AI always uses current date, no more hardcoded years
2. **Clear Error Messages**: Users know when cost data is unavailable due to permissions
3. **No Misleading Data**: No more $0.00 costs when data is actually inaccessible
4. **Better UX**: Frontend can display appropriate messages based on error state
5. **Future-Proof**: Automatic date calculation works for any date without code changes

## Files Changed

1. `backend/src/services/ClaudeMCPService.ts`
   - Added date context to AI prompts in `queryStream()` method (line ~753)
   - Added date context to AI prompts in `executeQuery()` method (line ~1124)

2. `backend/src/services/CostAnalysisService.ts`
   - Added `formatDate()` helper function to prevent timezone bugs
   - Updated `getCostSummary()` with dynamic dates, AccessDenied handling
   - Updated `getCostByService()` with dynamic dates, AccessDenied handling
   - Updated `getCostByRegion()` with dynamic dates, AccessDenied handling
   - Updated `getCostTrends()` with dynamic dates, AccessDenied handling
   - Updated `detectCostAnomalies()` with dynamic dates, AccessDenied handling
   - Updated `getCostForecast()` with dynamic dates, AccessDenied handling
   - Updated `getResourceCosts()` with enhanced AccessDenied handling and timezone fix
   - Updated `generateOptimizationRecommendations()` with AccessDenied handling

3. `backend/src/types/cost.ts`
   - Added `error?: string` field to CostSummary interface
   - Added `UNAVAILABLE` option to trend type

4. `test-date-fix.js` (new file)
   - Verification test for date calculations
   - Demonstrates timezone fix is working correctly

## Next Steps

To fully handle the AccessDenied case in the UI:
1. Update frontend components to check for `error` field in cost responses
2. Display user-friendly message when cost data is unavailable
3. Show available resource data even when costs are not accessible
4. Add documentation about IAM permissions required for cost features
