# Critical Regression Fixes Applied

## Summary
Fixed 6 critical regressions introduced by the persistence refactor that broke data display across the dashboard.

## Issues Fixed

### 1. Resources Page Showing 0 After Scan ✅
**Problem:** Cache key mismatch - resources route was looking for `resources:{profile}:global:iam` but scan was writing `resources:{profile}:global`

**Fix:**
- `routes/resources.ts:128` - Changed global cache key from `resources:${profile}:global:iam` to `resources:${profile}:global`
- Added persistentCache fallback logic in resources route to check disk cache when in-memory cache misses

**Files Modified:**
- `backend/src/routes/resources.ts`

---

### 2. Scan Not Persisting to Disk ✅
**Problem:** Scan was writing to in-memory `cacheService` only, not to `persistentCache`, so data was lost on server restart

**Fix:**
- `routes/scan.ts` - Added `await persistentCache.set()` after every `cacheService.set()` for:
  - Global resources (IAM, Route53, CloudTrail, etc.)
  - Regional resources (EC2, S3, RDS, etc.)
  - Security findings

**Files Modified:**
- `backend/src/routes/scan.ts`

---

### 3. Resources/Security Routes Not Reading from Persistent Cache ✅
**Problem:** Routes only checked in-memory cache, never fell back to persistent cache on disk

**Fix:**
- Added dual-cache read pattern:
  ```typescript
  let cached = cacheService.get<T>(key);
  if (!cached) {
    cached = persistentCache.get<T>(key);
    if (cached) {
      cacheService.set(key, cached, TTL); // Restore to memory
    }
  }
  ```

**Files Modified:**
- `backend/src/routes/resources.ts` - GET /resources, GET /resources/stats
- `backend/src/routes/security.ts` - GET /security/findings

---

### 4. Alerts Showing 0 Despite Findings ✅
**Problem:**
- scan.ts line 600 used non-existent `CacheService.alertKey()`
- Calling wrong AlertService method that didn't persist

**Fix:**
- Replaced `createAlertsFromFindings()` with `createAlertsFromCriticalAndHighFindings()` which:
  - Filters to CRITICAL and HIGH only
  - Persists alerts to disk via `persistentCache`
- Removed broken cache alert code in scan.ts

**Files Modified:**
- `backend/src/routes/scan.ts` - triggerSecurityAudit()
- `backend/src/routes/security.ts` - executeAudit() and scan endpoint

---

### 5. Analytics Showing 0 Accounts ✅
**Problem:** Analytics summary was counting accounts from cached scan data instead of from ~/.aws/config

**Fix:**
- Changed `/api/analytics/summary` to use `AccountDiscoveryService.discoverAccounts()` which reads directly from ~/.aws/config
- This now works regardless of whether scans have been run

**Files Modified:**
- `backend/src/routes/analytics.ts` - GET /summary

---

### 6. Security Score Showing 0% When Findings Exist ✅
**Problem:** Findings weren't being loaded from persistent cache, so score calculation saw 0 findings

**Fix:**
- Fixed security findings endpoint to read from persistentCache as fallback
- Score calculation now sees real findings count and calculates correctly

**Files Modified:**
- `backend/src/routes/security.ts` - GET /findings

---

## Cache Key Contracts (NEVER CHANGE)

The following cache keys are now used consistently across both in-memory and persistent caches:

```
resources:{profile}:{region}        ← Regional resource scan results
resources:{profile}:global          ← IAM and global resources
security:{profile}:{region}         ← Security findings per region
costs:{profile}                     ← Cost data
alerts:{profile}                    ← Security alerts (persisted by AlertService)
```

## Verification Steps

After these fixes, verify the following work correctly:

1. ✅ Run scan on any profile → Resources page shows all resources
2. ✅ Resources page never shows "0" or "No scan data found" after successful scan
3. ✅ Dashboard shows correct total resource count including global resources
4. ✅ Security findings load correctly after audit completes
5. ✅ Security score calculates correctly based on findings count
6. ✅ Alerts page shows all CRITICAL and HIGH findings as alerts
7. ✅ Analytics page shows all accounts from ~/.aws/config even before any scan
8. ✅ Restart backend → all data loads from disk correctly
9. ✅ No page shows empty/0 data that was previously populated

## Key Changes to Data Flow

### Before (Broken):
```
Scan → In-Memory Cache Only → Lost on Restart
Routes → In-Memory Cache Only → 404 if expired
```

### After (Fixed):
```
Scan → In-Memory Cache + Persistent Cache → Survives Restart
Routes → In-Memory Cache → Persistent Cache (fallback) → Always available
```

## Testing

To verify fixes work:

1. Start backend: `cd backend && npm run dev`
2. Run a scan via frontend or API
3. Check resources page - should show all resources
4. Check dashboard - should show correct counts including IAM roles
5. Check security page - should show findings and correct score
6. Check alerts page - should show CRITICAL and HIGH findings
7. Check analytics page - should show accounts from ~/.aws/config
8. Restart backend
9. Verify all data still loads correctly from disk

## Notes

- All changes preserve existing functionality
- No refactoring was done - only targeted bug fixes
- Server startup code already loads persisted data correctly (server.ts lines 217-253)
