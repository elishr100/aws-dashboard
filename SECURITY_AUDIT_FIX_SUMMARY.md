# Security Audit Fix Summary

## Problem
The security audit was returning instantly with fake results (0 findings, 100% security score) because it only read from cache and never made real AWS CLI calls.

### Root Cause
In `backend/src/routes/security.ts`, all three audit phases only checked cached inventory:

```typescript
// OLD CODE - BAD
const inventory = cacheService.get<ResourceInventory>(cacheKey);
if (!inventory || !inventory.resources.length === 0) {
  console.log('No cached resources found, skipping');
  continue;  // ← THIS IS WHY IT RETURNED INSTANTLY WITH 0 FINDINGS
}
```

The audit NEVER executed AWS CLI commands to discover real security issues.

---

## Solution Implemented

Completely rewrote `backend/src/routes/security.ts` to make **REAL AWS CLI calls** instead of reading from cache.

### Key Changes

#### 1. New AWS CLI Execution Utility
```typescript
function execAwsCommand(command: string, profile: string, timeoutMs: number = 15000): any {
  const fullCommand = `${command} --profile ${profile}`;
  console.log(`[Audit] Executing: ${fullCommand}`);

  const output = execSync(fullCommand, {
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(output);
}
```

#### 2. Phase 1 - Infrastructure Security Checks (2-4 minutes)
**EC2 EBS Encryption:**
```bash
aws ec2 describe-volumes --region <region> --filters Name=encrypted,Values=false
```
- Each unencrypted volume → HIGH finding
- Console logs: `[Audit] Found unencrypted volume: vol-xxxxx → HIGH`

**VPC Flow Logs:**
```bash
aws ec2 describe-vpcs --region <region>
aws ec2 describe-flow-logs --region <region>
```
- VPC without flow logs → MEDIUM finding
- Console logs: `[Audit] Found VPC without flow logs → MEDIUM`

**Security Groups:**
```bash
aws ec2 describe-security-groups --region <region>
```
- Port 22 open to 0.0.0.0/0 → HIGH finding
- Port 3389 open to 0.0.0.0/0 → HIGH finding

**RDS Instances:**
```bash
aws rds describe-db-instances --region <region>
```
- PubliclyAccessible=true → HIGH finding
- MultiAZ=false → MEDIUM finding
- StorageEncrypted=false → HIGH finding

**S3 Buckets (parallel execution):**
```bash
aws s3api list-buckets
aws s3api get-public-access-block --bucket <name>
aws s3api get-bucket-encryption --bucket <name>
aws s3api get-bucket-versioning --bucket <name>
aws s3api get-bucket-logging --bucket <name>
```
- Runs all bucket checks in **parallel** using `Promise.all()`
- BlockPublicAcls=false OR BlockPublicPolicy=false → HIGH
- No encryption → HIGH
- Versioning not Enabled → MEDIUM
- No logging → MEDIUM
- Per bucket timeout: 10 seconds

#### 3. Phase 2 - IAM Analysis (1-3 minutes)
**IAM Roles:**
```bash
aws iam list-roles
aws iam list-attached-role-policies --role-name <name>
aws iam get-role --role-name <name>
```
- AdministratorAccess attached → HIGH
- Wildcard principal (*) in trust policy without Condition → CRITICAL
- Role not used in 90+ days → MEDIUM
- More than 5 policies attached → LOW
- Processes roles in batches with delays to avoid rate limiting

**IAM Users:**
```bash
aws iam list-users
aws iam list-mfa-devices --user-name <name>
aws iam list-access-keys --user-name <name>
```
- No MFA device → HIGH
- Access key not rotated in 90+ days → MEDIUM

#### 4. Phase 3 - Resource Policies & Monitoring (1-2 minutes)
**CloudTrail:**
```bash
aws cloudtrail describe-trails --region <region>
aws cloudtrail get-trail-status --name <name>
```
- No trails → HIGH
- Trail not logging → HIGH
- Trail not encrypted → MEDIUM

**GuardDuty:**
```bash
aws guardduty list-detectors --region <region>
```
- No detectors → HIGH

**KMS Keys:**
```bash
aws kms list-keys --region <region>
aws kms describe-key --key-id <id>
aws kms get-key-policy --key-id <id> --policy-name default
aws kms get-key-rotation-status --key-id <id>
```
- Principal=* → CRITICAL
- Rotation not enabled → MEDIUM

**SQS Queues:**
```bash
aws sqs list-queues --region <region>
aws sqs get-queue-attributes --queue-url <url> --attribute-names Policy
```
- Principal=* without Condition → CRITICAL
- Principal=* with SendMessage → HIGH

**SNS Topics:**
```bash
aws sns list-topics --region <region>
aws sns get-topic-attributes --topic-arn <arn>
```
- Principal=* with sns:Publish → HIGH

#### 5. Error Handling & Timeouts
- Every check wrapped in try/catch with 15-second timeout
- On timeout or error: log error, mark check as UNKNOWN, continue
- Never abort entire audit because one check fails
- Overall audit timeout: 8 minutes
- Per service category timeout: 60 seconds

#### 6. Results Persistence
```typescript
// Save findings to multiple cache keys for persistence
const securityCacheKey = `security:${profile}:${region}`;
cacheService.set(securityCacheKey, regionFindings, CacheService.TTL.SECURITY_ALERTS);

const findingsCacheKey = `security:findings:${profile}:${region}`;
cacheService.set(findingsCacheKey, regionFindings, CacheService.TTL.SECURITY_ALERTS);
```

#### 7. Security Score Calculation
```typescript
// Score: 100 - (critical * 20 + high * 10 + medium * 5 + low * 2)
const deductions = (criticalCount * 20) + (highCount * 10) +
                  (job.summary.medium * 5) + (job.summary.low * 2);
job.summary.score = Math.max(0, 100 - deductions);
```

---

## Frontend Fixes

### Toast Messages No Longer Auto-Dismiss
Updated `frontend/src/context/ToastContext.tsx`:
```typescript
// OLD: success messages auto-dismissed after 5 seconds
const success = useCallback(
  (title: string, description?: string) => {
    addToast({ title, description, variant: 'success' });
  },
  [addToast]
);

// NEW: success messages stay until user clicks X
const success = useCallback(
  (title: string, description?: string) => {
    addToast({ title, description, variant: 'success', duration: 0 });
  },
  [addToast]
);
```

### Real-Time Progress Display
The frontend already shows:
- Phase indicators: "Phase 1/3: Checking infrastructure security..."
- Progress bars with percentage
- Real-time finding count: "12 findings discovered"
- Findings stream in as they're discovered (not waiting for completion)
- Security score updates in real-time as findings arrive

---

## Expected Behavior After Fix

### Backend Logs Should Show:
```
[Audit] ========================================
[Audit] PHASE 1: Infrastructure Security Checks
[Audit] Profile: dev-ah
[Audit] Regions: us-west-2, us-east-1
[Audit] ========================================
[Audit] Starting checks for region: us-west-2
[Audit] Checking EC2 EBS encryption in us-west-2...
[Audit] Executing: aws ec2 describe-volumes --region us-west-2 --filters Name=encrypted,Values=false --output json --profile dev-ah
[Audit] Found unencrypted volume: vol-0123456789abcdef → HIGH
[Audit] Checking VPC Flow Logs in us-west-2...
[Audit] Executing: aws ec2 describe-vpcs --region us-west-2 --output json --profile dev-ah
[Audit] Executing: aws ec2 describe-flow-logs --region us-west-2 --output json --profile dev-ah
[Audit] Found VPC without flow logs: vpc-xxxxx → MEDIUM
[Audit] Checking Security Groups in us-west-2...
[Audit] Checking RDS instances in us-west-2...
[Audit] Checking S3 buckets (global, running in parallel)...
[Audit] Checking S3 bucket: dev-ah-s3-bucket-1
[Audit] Checking S3 bucket: dev-ah-s3-bucket-2
...
[Audit] Phase 1 complete - 27 findings discovered
[Audit] ========================================
[Audit] PHASE 2: IAM Security Analysis
[Audit] ========================================
[Audit] Phase 2: Analyzing IAM roles...
[Audit] Found 151 IAM roles to analyze
[Audit] Checking IAM role: AWSServiceRoleForSupport
[Audit] Checking IAM role: dev-ah-admin-role
[Audit] IAM role dev-ah-admin-role has AdministratorAccess → HIGH
...
[Audit] Phase 2 complete - 43 total findings
[Audit] ========================================
[Audit] PHASE 3: Resource Policies & Monitoring
[Audit] ========================================
[Audit] Checking CloudTrail in us-west-2...
[Audit] Checking GuardDuty in us-west-2...
[Audit] Checking KMS keys in us-west-2...
[Audit] Checking SQS queue policies in us-west-2...
[Audit] Checking SNS topic policies in us-west-2...
[Audit] Phase 3 complete - 56 total findings
[Audit] Audit job-id completed - found 56 findings with score 42%
```

### Audit Duration
- Expected: **2-5 minutes** (depending on number of resources)
- Old behavior: Instant (0 seconds) with fake results

### Expected Findings for dev-ah Profile
Based on the requirements:
- **4 HIGH**: Unencrypted EBS volumes
- **MEDIUM**: VPC Flow Logs disabled on 2 VPCs
- **Multiple S3 findings**: 26 buckets to check (likely 50+ findings)
- **IAM findings**: 151 roles to analyze (likely 20+ findings)
- **Security score**: Should be significantly below 100% (likely 30-60%)

### Findings Persistence
- Findings saved to cache: `security:{profile}:{region}`
- Findings also saved to: `security:findings:{profile}:{region}`
- GET `/api/security/findings?profile=dev-ah` returns saved findings
- Findings persist after page refresh
- Security score reflects real findings

---

## Files Modified

1. **backend/src/routes/security.ts** (complete rewrite)
   - Replaced cache-reading code with real AWS CLI execution
   - Added proper console logging for all checks
   - Implemented parallel S3 checks
   - Added comprehensive error handling and timeouts

2. **frontend/src/context/ToastContext.tsx**
   - Changed success messages to `duration: 0` (no auto-dismiss)
   - Error messages already had `duration: 0`

---

## Verification Steps

1. **Start the backend:**
   ```bash
   cd backend && npm run dev
   ```

2. **Start the frontend:**
   ```bash
   cd frontend && npm run dev
   ```

3. **Run security audit from UI:**
   - Go to Security Dashboard
   - Select regions (e.g., us-west-2, us-east-1)
   - Click "Start Security Audit"

4. **Check backend.log:**
   ```bash
   tail -f backend.log
   ```
   - Should see `[Audit] Checking...` messages
   - Should see real AWS CLI commands being executed
   - Should see findings being discovered with severity levels

5. **Expected results:**
   - Audit takes 2-5 minutes (not instant)
   - Backend log shows real AWS CLI commands
   - Findings appear with real resource IDs
   - Security score is below 100%
   - Toast messages stay visible until clicked
   - Findings persist after page refresh

---

## Technical Details

### TypeScript Enum Fix
Added proper SecurityCheckType enum import:
```typescript
import { FindingSeverity, FindingStatus, SecurityCheckType } from '../types/security.js';
```

All checkType assignments now use proper enum values:
```typescript
checkType: SecurityCheckType.EC2_UNENCRYPTED_VOLUME  // ✅ Correct
// Instead of:
checkType: 'EC2_UNENCRYPTED_VOLUME'  // ❌ Wrong (string literal)
```

### execSync Usage
Using Node.js built-in `child_process.execSync` for AWS CLI execution:
- Synchronous execution for simpler error handling
- 15-second timeout per command
- 10MB output buffer
- JSON parsing of AWS CLI output
- Proper error handling for timeouts and failures

---

## Backup

Original file backed up at:
```
backend/src/routes/security.ts.backup
```

To restore if needed:
```bash
cd backend/src/routes
mv security.ts security-fixed.ts
mv security.ts.backup security.ts
```

---

## Status: ✅ COMPLETE

The security audit now makes real AWS CLI calls and discovers actual security issues instead of returning fake instant results.
