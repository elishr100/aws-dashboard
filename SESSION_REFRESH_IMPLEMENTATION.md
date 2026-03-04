# Session Refresh - End-to-End Implementation

## Overview
This document describes the complete session refresh flow that allows users to refresh AWS credentials directly from the UI without restarting the backend or running `wfo` manually.

## Implementation Details

### 1. Frontend Flow (SessionBanner.tsx)

When the user clicks the **Refresh** button:

```typescript
// SessionBanner.tsx - lines 15-30
const handleRefresh = async () => {
  setIsRefreshing(true);
  try {
    await refreshSession();  // Call API
    setShowRefreshSuccess(true);  // Show green banner
    setTimeout(() => {
      setShowRefreshSuccess(false);  // Clear after 3s
    }, 3000);
  } catch (error) {
    console.error('Failed to refresh session:', error);
  } finally {
    setIsRefreshing(false);
  }
};
```

**UI States:**
- 🔴 **Expired**: Red banner with "Refresh Session" button
- 🟡 **Expiring Soon** (<1 hour): Yellow banner with "Refresh" button
- 🟢 **Valid**: Green banner showing time remaining
- 🟢 **Refreshed**: Green success banner for 3 seconds after refresh

### 2. API Call (AppContext.tsx → api.ts)

```typescript
// AppContext.tsx - lines 58-70
const refreshSession = async () => {
  const profile = selectedAccount?.profile || 'dev-ah';
  await sessionApi.refresh(profile);  // POST /api/session/refresh
  const status = await sessionApi.getStatus();  // GET /api/session/status
  setSessionStatus(status);  // Update UI
};
```

```typescript
// api.ts - lines 57-59
refresh: async (profile?: string): Promise<void> => {
  await api.post('/session/refresh', { profile });
}
```

### 3. Backend Session Refresh (routes/session.ts)

The `POST /api/session/refresh` endpoint performs these steps:

```typescript
// routes/session.ts - lines 55-160

// 1. Extract profile from request (default: 'dev-ah')
const profile = req.body?.profile || 'dev-ah';

// 2. Configure assume-role parameters
const roleArn = 'arn:aws:iam::307122262482:role/GroupAccess-NICE-DevOps';
const roleSessionName = 'dashboard-session';
const identityProfile = 'nice-identity-session';
const targetProfile = 'dev-ah-dashboard';

// 3. Run AWS STS assume-role
const command = `aws sts assume-role --role-arn ${roleArn} --role-session-name ${roleSessionName} --profile ${identityProfile}`;
const { stdout } = await execAsync(command);

// 4. Parse credentials from response
const assumeRoleResponse = JSON.parse(stdout);
const credentials = assumeRoleResponse.Credentials;

// 5. Update process.env with new credentials
process.env.AWS_ACCESS_KEY_ID = credentials.AccessKeyId;
process.env.AWS_SECRET_ACCESS_KEY = credentials.SecretAccessKey;
process.env.AWS_SESSION_TOKEN = credentials.SessionToken;
process.env.AWS_PROFILE = targetProfile;

// 6. Write credentials to ~/.aws/credentials under [dev-ah-dashboard]
writeFileSync(credentialsPath, updatedCredentials);

// 7. Return success with new expiry time
res.json({
  success: true,
  session: {
    valid: true,
    expiresAt: credentials.Expiration,
    minutesRemaining: calculatedMinutes,
    profile: targetProfile,
  }
});
```

### 4. Credential Propagation (ClaudeMCPService.ts)

**KEY FIX**: Modified `getAWSCredentials()` to always check `process.env` first:

```typescript
// ClaudeMCPService.ts - lines 31-76
private getAWSCredentials(): void {
  // ALWAYS check environment variables first
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('[ClaudeMCP] Using credentials from environment variables');
    this.awsCredentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
    return;
  }

  // Fall back to cached credentials if available
  if (this.awsCredentials) {
    return;
  }

  // Fetch from profile as last resort
  const output = execSync(
    `aws configure export-credentials --profile ${this.profile} --format env`
  );
  // ... parse and cache
}
```

**Why this works:**
- After session refresh updates `process.env`, all subsequent AWS calls check env first
- This means all `ClaudeMCPService` instances (used by ChatOrchestrator, SecurityAuditService, etc.) automatically pick up refreshed credentials
- No need to track or update multiple service instances
- Child processes spawned by backend inherit the updated environment variables

### 5. Session Status Reading (SessionService.ts)

Reads expiration from `~/.aws/credentials`:

```typescript
// SessionService.ts - lines 29-89
getSessionStatus(): SessionStatus {
  // Read [dev-ah-dashboard] section from ~/.aws/credentials
  // Parse expiration field
  // Calculate minutes remaining
  return {
    valid: !expired,
    expiresAt,
    minutesRemaining,
    expired,
    needsRefresh: minutesRemaining < 30,
  };
}
```

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  USER CLICKS "REFRESH" BUTTON IN UI                         │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (SessionBanner.tsx)                                │
│  - Shows spinner                                             │
│  - Calls refreshSession() from AppContext                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend API (api.ts)                                       │
│  - POST /api/session/refresh { profile: "dev-ah" }          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend (routes/session.ts)                                 │
│  1. Run: aws sts assume-role                                 │
│     --role-arn arn:aws:iam::307122262482:role/GroupAccess... │
│     --role-session-name dashboard-session                    │
│     --profile nice-identity-session                          │
│                                                              │
│  2. Parse credentials from JSON response                     │
│                                                              │
│  3. Update process.env:                                      │
│     - AWS_ACCESS_KEY_ID                                      │
│     - AWS_SECRET_ACCESS_KEY                                  │
│     - AWS_SESSION_TOKEN                                      │
│     - AWS_PROFILE                                            │
│                                                              │
│  4. Write to ~/.aws/credentials [dev-ah-dashboard]:          │
│     aws_access_key_id = ...                                  │
│     aws_secret_access_key = ...                              │
│     aws_session_token = ...                                  │
│     expiration = 2026-03-02T10:39:54+00:00                   │
│                                                              │
│  5. Return success with new expiry time                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (AppContext.tsx)                                   │
│  - Receives success response                                 │
│  - Calls GET /api/session/status to refresh UI              │
│  - Updates sessionStatus state                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (SessionBanner.tsx)                                │
│  - Shows green success banner                                │
│  - Displays "Session valid - refreshed successfully"         │
│  - After 3s, shows normal green banner with expiry time      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ALL SUBSEQUENT AWS CALLS                                    │
│  - ClaudeMCPService checks process.env first                 │
│  - Finds updated credentials                                 │
│  - Uses new session automatically                            │
│  - NO backend restart needed!                                │
└─────────────────────────────────────────────────────────────┘
```

## Testing

Run the test script to verify the complete flow:

```bash
cd backend
tsx src/test-session-refresh.ts
```

This test verifies:
1. Initial session status is retrieved
2. POST /api/session/refresh succeeds
3. Credentials are written to ~/.aws/credentials
4. Session status is updated with new expiry
5. ClaudeMCPService picks up new credentials

## Key Benefits

✅ **No Backend Restart Required** - Session refresh updates environment variables in running process

✅ **Automatic Propagation** - All services (ChatOrchestrator, SecurityAuditService, etc.) automatically use new credentials

✅ **Persistent Credentials** - Written to ~/.aws/credentials for use by external tools

✅ **Immediate UI Feedback** - Green success banner shows immediately after refresh

✅ **No Cache Issues** - ClaudeMCPService always checks process.env first, bypassing stale caches

## Files Modified

- `backend/src/routes/session.ts` - Session refresh endpoint (already implemented)
- `backend/src/services/ClaudeMCPService.ts` - **FIXED** to always check process.env first
- `frontend/src/components/SessionBanner.tsx` - Refresh button UI (already implemented)
- `frontend/src/context/AppContext.tsx` - refreshSession function (already implemented)
- `frontend/src/lib/api.ts` - API client methods (already implemented)

## Configuration

The session refresh uses these AWS profiles:

- **nice-identity-session** - Source profile with MFA credentials (managed by `awsume`)
- **dev-ah** - Target profile configuration in ~/.aws/config
- **dev-ah-dashboard** - Dashboard session credentials written to ~/.aws/credentials

Role ARN: `arn:aws:iam::307122262482:role/GroupAccess-NICE-DevOps`

## Troubleshooting

If session refresh fails:

1. Check that `nice-identity-session` credentials are valid:
   ```bash
   aws sts get-caller-identity --profile nice-identity-session
   ```

2. Verify role can be assumed:
   ```bash
   aws sts assume-role \
     --role-arn arn:aws:iam::307122262482:role/GroupAccess-NICE-DevOps \
     --role-session-name test \
     --profile nice-identity-session
   ```

3. Check backend logs for detailed error messages:
   ```bash
   tail -f backend.log
   ```

4. Verify credentials were written:
   ```bash
   grep -A 5 "\[dev-ah-dashboard\]" ~/.aws/credentials
   ```
