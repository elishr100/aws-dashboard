# Quick Fix Guide - AWS Credential Management

## What Was Fixed

Your AWS Dashboard backend was experiencing credential errors:
```
[ClaudeMCP] AWS CLI error: Credentials were refreshed, but the refreshed credentials are still expired.
[ResourceDiscovery] Found 0 resources in us-west-2 (8 errors)
```

## The Problems

1. **Stale Environment Variables** - Old expired credentials in `process.env` were being reused
2. **No Cache Expiration** - Credentials cached indefinitely, could expire while cached
3. **No Retry Logic** - When credentials expired, no attempt to refresh and retry
4. **Poor Error Logging** - Generic error messages without AWS error codes

## The Solutions

### 1. Clean Environment Variables ✅
Now clears stale AWS credentials from environment before fetching fresh ones.

### 2. Credential Cache with 5-Minute TTL ✅
Credentials automatically expire and refresh every 5 minutes.

### 3. Automatic Validation ✅
All credentials tested with `aws sts get-caller-identity` before use.

### 4. Auto-Retry on Expiration ✅
If credentials expire during operation:
- Automatically fetches fresh credentials
- Retries the failed operation once
- Logs the retry for visibility

### 5. Better Error Messages ✅
Errors now show AWS error codes:
```
[ClaudeMCP] AWS CLI error [ExpiredToken]: ...
[ResourceDiscovery] RDS [AccessDenied]: ...
```

### 6. Minimal Environment Spread ✅
Child processes only receive fresh credentials, not the entire `process.env`.

## Testing the Fix

### Quick Test
```bash
# Ensure your terminal credentials work
aws sts get-caller-identity --profile dev-ah

# Start the backend
cd backend
npm run dev

# Watch for success messages in logs:
# ✅ [ClaudeMCP] Successfully fetched and validated credentials
# ✅ [ResourceDiscovery] Found X resources in us-west-2 (no errors)
```

### Automated Test
```bash
cd backend
tsx src/test-credentials.ts
```

Expected output:
```
Test 1: Credential Fetching and Validation
✅ Credential fetching and validation: PASSED

Test 2: Credential Caching with TTL
✅ Credential caching: PASSED

Test 3: Resource Discovery with Error Logging
✅ Resource discovery: PASSED
   Found 5 resources
   No errors

Test 4: Environment Variable Isolation
✅ Environment isolation: PASSED

Test 5: Error Handling and Messages
✅ Error handling: PASSED

🎉 All tests passed! (5/5)
```

## What to Expect Now

### Normal Operation
```
[ClaudeMCP] Fetching credentials for profile: dev-ah
[ClaudeMCP] Successfully fetched and validated credentials
[ClaudeMCP] Credentials: Access Key ASIA****..., Has Session Token: true
[ResourceDiscovery] Found 5 resources in us-west-2 (no errors)
```

### Auto-Recovery from Expired Credentials
```
[ClaudeMCP] AWS CLI error [ExpiredToken]: Credentials expired
[ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...
[ClaudeMCP] Successfully fetched and validated credentials
[ClaudeMCP] Retrying AWS CLI (attempt 2): aws ec2 describe-instances
✅ Success
```

### Clear Error Messages
```
[ResourceDiscovery] Found 5 resources (3 errors)
[ResourceDiscovery] Errors encountered:
  1. Lambda [ExpiredToken]: Credentials expired
  2. RDS [AccessDenied]: User not authorized for rds:DescribeDBInstances
  3. S3 [InvalidClientTokenId]: Security token is invalid
```

## If You Still See Errors

### Error: "Credentials are expired"
**Solution:** Refresh your AWS session:
```bash
# If using SSO:
aws sso login --profile dev-ah

# If using assume-role or custom credential_process:
wfo  # or your credential refresh command
```

### Error: "InvalidClientTokenId"
**Solution:** Your AWS credentials are invalid. Check:
```bash
# Verify profile exists
cat ~/.aws/config | grep -A 5 "\[profile dev-ah\]"

# Check credentials
cat ~/.aws/credentials | grep -A 5 "\[dev-ah\]"

# Test manually
aws sts get-caller-identity --profile dev-ah
```

### Error: "AccessDenied"
**Solution:** Your IAM role lacks permissions. Add required permissions:
- `ec2:Describe*` for EC2 resources
- `s3:ListBuckets` for S3
- `rds:Describe*` for RDS
- `lambda:List*` for Lambda
- etc.

## Files Modified

1. `backend/src/services/ClaudeMCPService.ts` - Core credential management
2. `backend/src/agents/ResourceDiscoveryAgent.ts` - Error logging improvements

## Rollback

If you need to revert:
```bash
cd backend
git checkout HEAD -- src/services/ClaudeMCPService.ts src/agents/ResourceDiscoveryAgent.ts
npm run dev
```

## Next Steps

1. ✅ Test the fix with the automated test script
2. ✅ Start your backend and verify no credential errors
3. ✅ Test resource discovery - should find resources without errors
4. ✅ Review logs to see improved error messages
5. ⚠️ If errors persist, check your AWS profile configuration

## Additional Recommendations

### Use Profile Configuration
Ensure `~/.aws/config` uses SSO or credential_process:

```ini
[profile dev-ah]
region = us-west-2
sso_start_url = https://your-sso.awsapps.com/start
sso_region = us-west-2
sso_account_id = 307122262482
sso_role_name = YourRoleName
```

### Avoid Hardcoded Credentials
Don't set AWS credentials in shell startup files:
```bash
# ❌ Don't do this
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

Instead:
```bash
# ✅ Do this
export AWS_PROFILE=dev-ah
export AWS_REGION=us-west-2
```

## Support

For detailed technical information, see:
- `CREDENTIAL_FIX_SUMMARY.md` - Complete technical documentation
- `backend/src/test-credentials.ts` - Test script source code

## Summary

✅ **Stale credentials** - Fixed with clean environment variables
✅ **Cache expiration** - 5-minute TTL prevents long-lived expired credentials
✅ **Credential validation** - All credentials tested before use
✅ **Auto-retry** - Expired credentials automatically refreshed
✅ **Better logging** - AWS error codes clearly visible
✅ **Environment isolation** - Child processes only see fresh credentials

Your AWS Dashboard should now work reliably! 🎉
