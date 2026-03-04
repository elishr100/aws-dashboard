# AWS Credential Management Fix - Summary

## Problem

The AWS Dashboard backend was experiencing persistent credential expiration errors:

```
[ClaudeMCP] AWS CLI error: Credentials were refreshed, but the refreshed credentials are still expired.
[ResourceDiscovery] Found 0 resources in us-west-2 (8 errors)
```

Even though `aws sts get-caller-identity --profile dev-ah` worked perfectly in the terminal, the backend MCP client continued to fail.

## Root Causes

### 1. **Stale Environment Variables**
- Previous session refresh logic updated `process.env.AWS_ACCESS_KEY_ID` etc.
- These expired credentials persisted in `process.env` and were spread into child process environments
- `aws configure export-credentials` would inherit these stale credentials and fail

### 2. **No Credential Cache Expiration**
- Credentials were cached indefinitely (`this.awsCredentials`)
- Even if fetched successfully, they could expire while still in cache
- No mechanism to detect expired credentials and refresh

### 3. **No Retry Logic**
- When AWS CLI commands failed with `ExpiredToken`, the code immediately gave up
- No attempt to clear cache and fetch fresh credentials

### 4. **Poor Error Logging**
- Errors showed generic messages without AWS error codes
- Impossible to distinguish between `ExpiredToken`, `InvalidClientTokenId`, `AccessDenied`, etc.
- ResourceDiscovery logged "8 errors" without showing what the errors were

### 5. **No Credential Validation**
- Fetched credentials were never tested before use
- First usage would fail, wasting API calls and time

## Solutions Implemented

### 1. ✅ Clean Environment Variables
**File:** `backend/src/services/ClaudeMCPService.ts:56-58`

```typescript
// IMPORTANT: Clear any stale environment variables that might interfere
const cleanEnv = { ...process.env };
delete cleanEnv.AWS_ACCESS_KEY_ID;
delete cleanEnv.AWS_SECRET_ACCESS_KEY;
delete cleanEnv.AWS_SESSION_TOKEN;
```

When fetching credentials, we now:
- Create a clean environment without AWS credentials
- Pass only `PATH` and `HOME` to child processes
- Prevent `aws configure export-credentials` from seeing stale credentials

### 2. ✅ Credential Cache with TTL
**File:** `backend/src/services/ClaudeMCPService.ts:20-21`

```typescript
private lastCredentialFetch: number = 0;
private static readonly CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

Credentials are now:
- Cached for only 5 minutes
- Automatically refreshed when cache expires
- Force-refreshed when credential errors occur

### 3. ✅ Credential Validation
**File:** `backend/src/services/ClaudeMCPService.ts:105-129`

```typescript
private validateCredentials(): void {
  // Quick test call to verify credentials work
  execSync('aws sts get-caller-identity', {
    encoding: 'utf-8',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

After fetching credentials, we:
- Test them with `aws sts get-caller-identity`
- Catch `ExpiredToken` or `InvalidClientTokenId` errors immediately
- Fail fast with clear error messages

### 4. ✅ Automatic Retry with Fresh Credentials
**File:** `backend/src/services/ClaudeMCPService.ts:143-145`

```typescript
// Retry logic for expired credentials
if (retryCount < MAX_RETRIES && errorString.includes('ExpiredToken')) {
  console.log(`[ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...`);
  this.getAWSCredentials(true); // Force refresh
  return this.executeAWSCommand(command, retryCount + 1); // Retry
}
```

When AWS CLI commands fail:
- Detect `ExpiredToken` errors
- Force-refresh credentials (clear cache + fetch new)
- Automatically retry the command once
- Same logic for Bedrock API calls

### 5. ✅ Improved Error Logging
**File:** `backend/src/services/ClaudeMCPService.ts:150-154`

```typescript
// Extract AWS error code if present
const errorCodeMatch = errorString.match(/\((ExpiredToken|InvalidClientTokenId|...)\)/);
const errorCode = errorCodeMatch ? errorCodeMatch[1] : null;
console.error(`[ClaudeMCP] AWS CLI error [${errorCode}]:`, errorMessage);
```

**File:** `backend/src/agents/ResourceDiscoveryAgent.ts:165-176`

```typescript
// Extract AWS error code for better debugging
const errorCodeMatch = errorMsg.match(/\[(ExpiredToken|...)\]/);
if (errorCode) {
  console.error(`[ResourceDiscovery] Error discovering ${resourceType} [${errorCode}]:`, errorMsg);
  errors.push(`${resourceType} [${errorCode}]: ${errorMsg}`);
}
```

**File:** `backend/src/agents/ResourceDiscoveryAgent.ts:107-110`

```typescript
console.log(`[ResourceDiscovery] Errors encountered:`);
errors.forEach((err, idx) => {
  console.log(`[ResourceDiscovery]   ${idx + 1}. ${err}`);
});
```

Now logs show:
- AWS error codes in brackets: `[ExpiredToken]`, `[InvalidClientTokenId]`, etc.
- Full error details for each resource type
- Numbered error list in ResourceDiscovery

### 6. ✅ Minimal Environment Spread
**File:** `backend/src/services/ClaudeMCPService.ts:137-144`

```typescript
// IMPORTANT: Don't spread process.env to avoid inheriting stale credentials
const env = {
  AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
  AWS_SECRET_ACCESS_KEY: this.awsCredentials.secretAccessKey,
  AWS_SESSION_TOKEN: this.awsCredentials.sessionToken,
  AWS_REGION: this.region,
  AWS_DEFAULT_REGION: this.region,
  PATH: process.env.PATH, // Keep PATH for finding aws CLI
  HOME: process.env.HOME, // Keep HOME for aws config location
};
```

Previously:
```typescript
const env = {
  ...process.env, // ❌ Inherited ALL env vars, including stale AWS credentials
  AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
  // ...
};
```

Now:
- Only pass required environment variables
- Prevent inheritance of stale credentials from parent process
- AWS CLI sees only fresh credentials we provide

## Testing

### Manual Test

1. **Verify terminal credentials work:**
   ```bash
   aws sts get-caller-identity --profile dev-ah
   ```
   Should show your identity.

2. **Test the backend:**
   ```bash
   cd backend
   npm run dev
   ```
   Watch logs for:
   - `[ClaudeMCP] Successfully fetched and validated credentials`
   - No `ExpiredToken` errors
   - ResourceDiscovery finds resources without errors

3. **Test credential expiration handling:**
   - Wait for credentials to expire (or manually corrupt them in `~/.aws/credentials`)
   - Trigger a resource scan or AWS CLI command
   - Should see:
     ```
     [ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...
     [ClaudeMCP] Successfully fetched and validated credentials
     ```

### Automated Test

Create this test script:

```bash
cd backend
tsx src/test-credentials.ts
```

See `CREDENTIAL_TEST.md` for full test instructions.

## Expected Behavior After Fix

### ✅ Normal Operation
```
[ClaudeMCP] Fetching credentials for profile: dev-ah
[ClaudeMCP] Successfully fetched and validated credentials for profile: dev-ah
[ClaudeMCP] Credentials: Access Key ASIA****..., Has Session Token: true
[ClaudeMCP] Executing AWS CLI: aws ec2 describe-vpcs --region us-west-2
[ResourceDiscovery] Found 5 resources in us-west-2 (no errors)
```

### ✅ Credential Expiration with Auto-Retry
```
[ClaudeMCP] Using cached credentials (age: 180s)
[ClaudeMCP] Executing AWS CLI: aws ec2 describe-instances --region us-west-2
[ClaudeMCP] AWS CLI error [ExpiredToken]: Credentials were refreshed, but the refreshed credentials are still expired.
[ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...
[ClaudeMCP] Force refreshing credentials for profile: dev-ah
[ClaudeMCP] Successfully fetched and validated credentials for profile: dev-ah
[ClaudeMCP] Retrying AWS CLI (attempt 2): aws ec2 describe-instances --region us-west-2
[ClaudeMCP] Success
```

### ✅ Credential Validation Failure
```
[ClaudeMCP] Fetching credentials for profile: dev-ah
[ClaudeMCP] Failed to get credentials: Credentials are expired
Error: AWS credentials are expired for profile dev-ah. Please refresh your session (e.g., run 'wfo' or 'aws sso login --profile dev-ah')
```

### ✅ Detailed Error Logging
```
[ResourceDiscovery] Found 5 resources in us-west-2 (3 errors)
[ResourceDiscovery] Errors encountered:
[ResourceDiscovery]   1. Lambda [ExpiredToken]: AWS CLI command failed [ExpiredToken]: Credentials were expired
[ResourceDiscovery]   2. RDS [AccessDenied]: AWS CLI command failed [AccessDenied]: User is not authorized to perform: rds:DescribeDBInstances
[ResourceDiscovery]   3. S3 [InvalidClientTokenId]: AWS CLI command failed [InvalidClientTokenId]: The security token included in the request is invalid
```

## Files Modified

1. ✅ `backend/src/services/ClaudeMCPService.ts`
   - Added credential cache TTL (5 minutes)
   - Added credential validation with `sts get-caller-identity`
   - Clean environment variables before credential fetch
   - Minimal environment spread (no `...process.env`)
   - Automatic retry logic for expired credentials
   - Improved error logging with AWS error codes

2. ✅ `backend/src/agents/ResourceDiscoveryAgent.ts`
   - Extract and log AWS error codes
   - Detailed error listing in logs
   - Better error messages in inventory

3. ✅ `CREDENTIAL_FIX_SUMMARY.md` (this file)
   - Complete documentation of fixes

## Rollback Plan

If issues occur:

```bash
cd backend
git checkout HEAD -- src/services/ClaudeMCPService.ts src/agents/ResourceDiscoveryAgent.ts
npm run dev
```

Note: Rollback will restore the old behavior with stale credential issues.

## Additional Recommendations

### 1. Session Refresh Integration
The backend should detect when credentials are about to expire and prompt the user to refresh:

```typescript
// In SessionService.ts
if (status.needsRefresh) {
  // Show UI notification: "Session expires in 25 minutes - refresh now"
}
```

### 2. Profile Configuration
Ensure your `~/.aws/config` uses `credential_process` or SSO for the profile:

```ini
[profile dev-ah]
region = us-west-2
sso_start_url = https://your-sso.awsapps.com/start
sso_region = us-west-2
sso_account_id = 307122262482
sso_role_name = YourRoleName
```

Or with credential_process:

```ini
[profile dev-ah]
region = us-west-2
credential_process = /path/to/your/credential-helper
```

### 3. Environment Variable Hygiene
In your shell startup files (`.zshrc`, `.bashrc`), avoid setting:
```bash
# ❌ Don't do this - causes stale credentials
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...
```

Instead, use profiles:
```bash
# ✅ Do this
export AWS_PROFILE=dev-ah
export AWS_REGION=us-west-2
```

## Conclusion

✅ **Root Cause Fixed:** Stale environment variables no longer interfere with credential fetching

✅ **Credential Management:** 5-minute cache TTL prevents long-lived expired credentials

✅ **Validation:** All credentials tested before use with `sts get-caller-identity`

✅ **Auto-Retry:** Expired credentials automatically refreshed and retried

✅ **Better Logging:** AWS error codes clearly visible in logs

✅ **Environment Isolation:** Child processes only receive fresh credentials

The credential management is now robust and will automatically handle:
- Credential expiration during operation
- Stale credentials in environment variables
- AWS SDK credential refresh issues
- Better error visibility for debugging

Your AWS Dashboard should now work reliably without the "Credentials were refreshed, but the refreshed credentials are still expired" error!
