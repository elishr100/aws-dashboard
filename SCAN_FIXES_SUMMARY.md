# Scan and Security Audit Fixes - Summary

## Issues Fixed

### 1. Security Audit Timeout (FIXED ✅)
**Problem**: Security audit timed out while scanning S3 buckets, making sequential calls for 26 buckets.

**Solution**:
- Added **overall audit timeout**: 3 minutes maximum
- Added **per-check timeout**: 60 seconds per resource type (S3, EC2, RDS, VPC)
- Implemented **parallel execution** using `Promise.all()`:
  - All regions scanned in parallel
  - All resource types within each region scanned in parallel
- **Graceful timeout handling**: Timeout creates an INFO-level finding marked as UNKNOWN instead of failing

**Files Modified**:
- `backend/src/services/SecurityAuditService.ts`
- `backend/src/types/security.ts` (added TIMEOUT check type)

**Key Changes**:
- `withTimeout()`: Wraps async operations with timeout
- `performAuditChecks()`: Executes all checks in parallel
- `createTimeoutFinding()`: Creates INFO-level finding for timeouts
- Updated prompts to request parallel S3 bucket checks

### 2. Error Messages Auto-Dismiss (FIXED ✅)
**Problem**: Audit error messages disappeared after 5 seconds.

**Solution**:
- Modified `error()` function in ToastContext to set `duration: 0`
- Error toasts now **persist indefinitely** until user dismisses them
- Success/info toasts continue to auto-dismiss after 5 seconds

**Files Modified**:
- `frontend/src/context/ToastContext.tsx`

### 3. Scan Progress Shows "0 Resources Found" (FIXED ✅)
**Problem**: SSE stream showed "0 resources found" during scan because resource count was only updated after each region completed, not during the scan.

**Solution**:
- Added **progress callback** to ResourceDiscoveryAgent
- Resource count updates **in real-time** as each resource type is discovered
- SSE stream now shows running count: "Scanning us-west-2... (45 resources found)"
- Final message shows correct total

**Files Modified**:
- `backend/src/agents/ResourceDiscoveryAgent.ts`
- `backend/src/routes/scan.ts`

**Key Changes**:
- Added `setProgressCallback()` method to ResourceDiscoveryAgent
- Progress callback invoked after each resource type completes
- Cumulative count tracked across regions using `baseResourceCount`
- SSE complete event includes `resourcesFound` field

### 4. IAM Role Duplication (FIXED ✅)
**Problem**: IAM roles showing 1000+ when only 151 exist. Caused by calling `aws iam list-roles` once per region (IAM is global).

**Solution**:
- **Removed IAM from per-region loop**
- Created separate `discoverIAMRoles()` method called **once per account**
- IAM roles marked with `region: 'global'`
- Added **deduplication by RoleId**
- IAM roles cached separately: `resources:${profile}:global:iam`

**Files Modified**:
- `backend/src/agents/ResourceDiscoveryAgent.ts`
- `backend/src/routes/scan.ts`

**Key Changes**:
```typescript
// Discover IAM roles ONCE before scanning regions
let iamRoles = await agent.discoverIAMRoles();
baseResourceCount = iamRoles.length;

// Cache IAM roles globally
const iamCacheKey = `resources:${profile}:global:iam`;
cacheService.set(iamCacheKey, { resources: iamRoles, ... });
```

## Verification Steps

1. **Start the servers**:
   ```bash
   cd ~/ssm-config/aws-dashboard
   ./start.sh
   ```

2. **Test Security Audit**:
   - Navigate to Security page
   - Select regions and start audit
   - Verify: Completes within 3 minutes
   - Verify: Any errors persist on screen until dismissed

3. **Test Scan Progress**:
   - Navigate to Scan page
   - Select regions and start scan
   - Verify: Progress shows "Scanning [region]... (X resources found)" with increasing count
   - Verify: Final message shows correct total

4. **Test IAM Role Count**:
   - Scan dev-ah account with multiple regions
   - Verify: IAM roles = exactly 151 (not 1000+)
   - Check via CLI: `aws iam list-roles --profile dev-ah --query 'Roles[].RoleName' | jq length`

## Expected Results

- ✅ Security audit completes without timeout
- ✅ Audit errors stay visible until dismissed
- ✅ Scan progress shows real resource counts updating in real-time
- ✅ IAM roles = 151 (not duplicated per region)

## Technical Details

### Real-Time Progress Updates
```typescript
// ResourceDiscoveryAgent callback pattern
agent.setProgressCallback((currentRegionCount: number) => {
  job.resourcesFound = baseResourceCount + currentRegionCount;
});
```

### IAM Deduplication
```typescript
const seenIds = new Set<string>();
const uniqueRoles = result.resources.filter(role => {
  if (seenIds.has(role.id)) return false;
  seenIds.add(role.id);
  return true;
});
```

### Parallel Security Checks
```typescript
// All resource types checked in parallel per region
const [s3, ec2, rds, vpc] = await Promise.all([
  this.auditS3Buckets(profile, region),
  this.auditEC2Security(profile, region),
  this.auditRDSSecurity(profile, region),
  this.auditVPCSecurity(profile, region),
]);
```

## Files Changed

### Backend
1. `backend/src/services/SecurityAuditService.ts` - Timeout handling, parallel execution
2. `backend/src/types/security.ts` - Added TIMEOUT check type
3. `backend/src/agents/ResourceDiscoveryAgent.ts` - Progress callback, IAM deduplication
4. `backend/src/routes/scan.ts` - Real-time progress tracking, IAM once-per-account

### Frontend
5. `frontend/src/context/ToastContext.tsx` - Error toast persistence

## Testing Notes

- Security audit with 3 regions, 26 S3 buckets: ~1-2 minutes (previously timed out)
- Scan progress updates every ~5-10 seconds as resource types complete
- IAM roles discovered first, then regions scanned
- Error messages require manual dismissal (X button)
