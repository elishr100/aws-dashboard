# Three Counter Bugs - Analysis and Fixes

## Bug 1: Alerts Page - Stats Endpoint Returns "Alert not found"

### Root Cause
Express route order issue in `backend/src/routes/security.ts`

**Current Order:**
- Line 876: `router.get('/alerts', ...)`
- Line 902: `router.get('/alerts/:alertId', ...)` ← Matches "stats" as alertId
- Line 977: `router.get('/alerts/stats', ...)` ← Never reached!

When requesting `/api/security/alerts/stats`, Express matches it to `/alerts/:alertId` where alertId="stats", then tries to find alert ID "stats" which doesn't exist.

### Verification
```bash
curl "http://localhost:3001/api/security/alerts/stats"
# Returns: {"error": "Alert not found"}

# But alerts exist:
curl "http://localhost:3001/api/security/alerts?profile=dev-ah"
# Returns: 29 alerts
```

### Fix
Move specific routes BEFORE parameterized routes:
```typescript
router.get('/alerts/stats', ...)     // Line 977 → Move before :alertId
router.get('/alerts/stream', ...)    // Line 1019 → Move before :alertId
router.get('/alerts/:alertId', ...)  // Line 902 → Keep after specific routes
```

---

## Bug 2: Security Score Always Shows 0%

### Root Cause
Check tracking functions exist but are NEVER called during audit

**Functions Defined (lines 2247-2258):**
```typescript
function recordCheckPassed(job: AuditJob): void {
  job.checks.total++;
  job.checks.passed++;
}

function recordCheckFailed(job: AuditJob): void {
  job.checks.total++;
  job.checks.failed++;
}
```

**Problem:** These functions are never invoked, so:
- `job.checks.total = 0`
- Score calculation: `passedChecks / totalChecks` = `0/0` → 0%

### Verification
```bash
# Audit completes but checks.total stays 0
# Score formula works but has no data:
# score = (passedChecks / totalChecks) * 100 = (0/0) = 0
```

### Fix
Add check tracking in all audit phases:
1. S3 encryption checks
2. IAM policy checks
3. KMS, CloudTrail, GuardDuty checks
4. Each check should call `recordCheckPassed()` or `recordCheckFailed()`

Example:
```typescript
// For each S3 bucket checked:
job.checks.total++;
if (hasEncryption) {
  job.checks.passed++;
} else {
  job.checks.failed++;
  job.findings.push(finding);
}
```

---

## Bug 3: Analytics Page - All Counters Show 0

### Root Cause
`/api/analytics/summary` endpoint fails when calling `aggregationService.aggregateMetrics()`

**File:** `backend/src/routes/analytics.ts:143-216`

**Problem Chain:**
1. `aggregationService.aggregateMetrics()` calls
2. `this.orgService.getAllAccounts({ status: 'ACTIVE' })`
3. OrganizationService doesn't have accounts populated
4. Returns empty array → all metrics are 0

### Verification
```bash
curl "http://localhost:3001/api/analytics/summary"
# Returns: {"error": "Failed to fetch executive summary"}

# But accounts exist:
curl "http://localhost:3001/api/accounts"
# Returns: 25 accounts from ~/.aws/config
```

### Fix
The summary endpoint already has the right approach on lines 146-148:
```typescript
const { AccountDiscoveryService } = require('../services/AccountDiscoveryService.js');
const accountService = new AccountDiscoveryService();
const allAccounts = accountService.discoverAccounts();
```

But then it calls `aggregationService.aggregateMetrics()` which ignores this and tries OrganizationService.

**Solution:** Modify AggregationService to accept accounts as parameter OR directly read from AccountDiscoveryService instead of OrganizationService.

---

## Implementation Order

1. **Fix Bug 1 (Easy):** Reorder routes - 2 minute fix
2. **Fix Bug 3 (Medium):** Fix AggregationService - 10 minute fix
3. **Fix Bug 2 (Complex):** Add check tracking throughout audit - 20 minute fix

Total estimated time: 30 minutes
