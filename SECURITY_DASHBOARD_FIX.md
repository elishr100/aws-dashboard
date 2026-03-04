# Security Dashboard Fix - Summary

## Problem
The Security Dashboard was showing 100% score and 0 findings even though real issues existed:
- 4 HIGH: Unencrypted EBS Volumes
- 6 MEDIUM: Missing S3 logging/versioning, VPC Flow Logs disabled
- Total: 10 findings confirmed in scan logs

## Root Causes Identified

### 1. AlertService Not a Singleton
- **Issue**: Multiple `AlertService` instances were created:
  - `scan.ts` line 434 created a new instance
  - `security.ts` line 12 created a different instance
- **Result**: Alerts created during auto-scan were stored in one instance, but the API routes queried a different instance (empty alerts)

### 2. SecurityAuditService Reading from Wrong Storage
- **Issue**: `getComplianceReport()` and `getFindings()` read from in-memory Map only
- **Result**: The auto-scan stored findings in cache, but compliance report calculated score from empty in-memory Map
- **Effect**: 100% security score despite having 10 real findings

### 3. Missing Cache Persistence in Manual Audit
- **Issue**: `/api/security/audit` endpoint stored findings only in SecurityAuditService's in-memory Map, not in cache
- **Result**: Findings endpoint (which reads from cache) returned empty results

## Fixes Applied

### 1. Made AlertService a Singleton (ServiceFactory.ts)
```typescript
// Added AlertService to ServiceFactory
private static alertService: AlertService;

static getAlertService(): AlertService {
  if (!this.alertService) {
    this.alertService = new AlertService();
  }
  return this.alertService;
}
```

### 2. Updated All Routes to Use Singleton AlertService
- **security.ts**: All alert endpoints now use `ServiceFactory.getAlertService()`
- **scan.ts**: `triggerSecurityAudit()` now uses `ServiceFactory.getAlertService()`
- **Result**: Single shared AlertService instance across entire application

### 3. Updated SecurityAuditService to Read from Cache
```typescript
// SecurityAuditService.ts - getFindings() now checks cache first
getFindings(filters) {
  // Try cache first (where auto-scan stores findings)
  const cachedFindings = cacheService.get(`security:${profile}:${region}`);

  // Fall back to in-memory Map
  if (!cachedFindings) {
    findings = Array.from(this.findings.values());
  }
}
```

### 4. Added Cache Persistence to Manual Audit
```typescript
// security.ts - POST /audit now caches findings
for (const region of auditRequest.regions) {
  const securityCacheKey = `security:${profile}:${region}`;
  cacheService.set(securityCacheKey, regionFindings, CacheService.TTL.SECURITY_ALERTS);
}
```

## Verification Steps

### 1. Check Findings are Returned
```bash
curl http://localhost:3001/api/security/findings?profile=dev-ah
```
**Expected**: Should return the 10 findings (4 HIGH + 6 MEDIUM)

### 2. Check Alerts are Created
```bash
curl http://localhost:3001/api/security/alerts?profile=dev-ah
```
**Expected**: Should return 4 HIGH severity alerts

### 3. Check Security Score is Calculated Correctly
```bash
curl "http://localhost:3001/api/security/compliance?profile=dev-ah&region=us-west-2"
```
**Expected**:
- `failedChecks: 10`
- `complianceScore: 50` (not 100%)
- `findingsBySeverity.high: 4`
- `findingsBySeverity.medium: 6`

### 4. Check Backend Logs
Look for these log messages after a scan:
```
[Scan] Cached 10 findings for us-west-2 under key security:dev-ah:us-west-2
[Scan] Created 4 security alerts
[SecurityAudit] Retrieved 10 findings from cache for dev-ah/us-west-2
[SecurityAudit] Compliance report for dev-ah/us-west-2: 10 active findings
```

## Files Modified
1. `backend/src/services/ServiceFactory.ts` - Added AlertService singleton
2. `backend/src/routes/security.ts` - Use singleton AlertService, cache findings in manual audit
3. `backend/src/routes/scan.ts` - Use singleton AlertService
4. `backend/src/services/SecurityAuditService.ts` - Read from cache first, fall back to in-memory Map

## Key Architectural Changes
- **AlertService**: Changed from per-request instances to global singleton
- **Findings Storage**: Dual storage (cache + in-memory Map) with cache as primary source
- **Compliance Calculation**: Now reads from cache where auto-scan stores findings

## Next Steps
1. Restart the backend server
2. Run a resource scan on dev-ah profile
3. Verify findings, alerts, and compliance score all show correct data
4. The Security Dashboard should now display the real 10 findings and calculate the correct score
