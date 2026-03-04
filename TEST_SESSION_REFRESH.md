# Testing Session Refresh

## Prerequisites

1. Start the backend:
   ```bash
   cd backend
   npm start
   ```

2. Start the frontend:
   ```bash
   cd frontend
   npm run dev
   ```

3. Ensure `nice-identity-session` credentials are valid:
   ```bash
   aws sts get-caller-identity --profile nice-identity-session
   ```

## Manual Testing Steps

### Test 1: UI Refresh Button

1. Open the dashboard in your browser: http://localhost:5173
2. Look at the session banner at the top
3. Click the **Refresh** button
4. Verify:
   - ✅ Button shows "Refreshing..." with spinner
   - ✅ Green success banner appears with "Session valid - refreshed successfully"
   - ✅ After 3 seconds, banner shows normal green state with new expiry time
   - ✅ Minutes remaining increases (session was extended)

### Test 2: Automated Test Script

Run the automated test:

```bash
cd backend
tsx src/test-session-refresh.ts
```

Expected output:
```
============================================================
Test: Session Refresh End-to-End
============================================================

[1] Checking initial session status...
Initial status: ✅ Valid
Expires at: 2026-03-02T10:39:54.000Z
Minutes remaining: 180

[2] Capturing current environment variables...
Old Access Key: ASIAUPAP...

[3] Calling POST /api/session/refresh...
✅ Session refresh succeeded
New expiry: 2026-03-02T16:45:00.000Z
Minutes remaining: 360

[4] Verifying credentials written to ~/.aws/credentials...
✅ Credentials written to [dev-ah-dashboard] profile

[5] Verifying ClaudeMCPService picks up new credentials...
✅ ClaudeMCPService created successfully

[6] Checking updated session status...
Updated status: ✅ Valid
Expires at: 2026-03-02T16:45:00.000Z
Minutes remaining: 360
✅ Session expiry time was extended

============================================================
✅ ALL TESTS PASSED
============================================================
```

### Test 3: Verify Credentials Propagation

Test that AWS CLI calls use the new credentials:

```bash
# 1. Note the current access key
grep "aws_access_key_id" ~/.aws/credentials | grep -A 1 "dev-ah-dashboard"

# 2. Refresh the session via API
curl -X POST http://localhost:3001/api/session/refresh \
  -H "Content-Type: application/json" \
  -d '{"profile":"dev-ah"}'

# 3. Verify the access key changed
grep "aws_access_key_id" ~/.aws/credentials | grep -A 1 "dev-ah-dashboard"

# 4. Verify env vars were updated (check backend logs)
grep "Updated environment variables" backend.log | tail -1
```

### Test 4: Backend Log Verification

Check the backend logs to see the refresh process:

```bash
tail -f backend.log
```

When you click Refresh in the UI, you should see:
```
[API] POST /session/refresh - profile: dev-ah
[API] Executing: aws sts assume-role --role-arn arn:aws:iam::307122262482:role/GroupAccess-NICE-DevOps --role-session-name dashboard-session --profile nice-identity-session
[API] Successfully assumed role for dev-ah
[API] Credentials expire at: 2026-03-02T16:45:00+00:00
[API] Wrote credentials to ~/.aws/credentials under profile [dev-ah-dashboard]
[API] Updated environment variables for backend process
```

## Troubleshooting

### Error: "Failed to refresh session"

**Check 1**: Verify nice-identity-session is valid
```bash
aws sts get-caller-identity --profile nice-identity-session
```

If this fails, run:
```bash
wfo  # or your MFA authentication command
```

**Check 2**: Verify the role can be assumed
```bash
aws sts assume-role \
  --role-arn arn:aws:iam::307122262482:role/GroupAccess-NICE-DevOps \
  --role-session-name test \
  --profile nice-identity-session
```

### Session not updating in UI

**Check 1**: Verify API response
```bash
curl -v http://localhost:3001/api/session/status
```

**Check 2**: Check browser console for errors
- Open DevTools (F12)
- Look for errors in Console tab
- Check Network tab for failed requests

### Backend not picking up new credentials

**Check 1**: Verify process.env was updated
- Check backend logs for "Updated environment variables"
- The logs should show this message after each refresh

**Check 2**: Restart backend (last resort)
- This should NOT be necessary
- If you need to restart, it indicates the fix didn't work properly

## Expected Behavior

✅ **Click Refresh** → Credentials update in <2 seconds
✅ **Banner turns green** → Shows success message
✅ **Session extended** → Minutes remaining increases
✅ **No backend restart** → All AWS calls use new credentials immediately
✅ **Chat still works** → AI chat uses new credentials automatically
✅ **Security scans work** → All services pick up new credentials

## Success Criteria

The session refresh is working correctly if:

1. ✅ Clicking Refresh button successfully extends the session
2. ✅ UI updates to green immediately after refresh
3. ✅ New credentials are written to ~/.aws/credentials
4. ✅ process.env is updated in the backend
5. ✅ All subsequent AWS CLI calls use the new credentials
6. ✅ No backend restart is needed
7. ✅ AI chat and other features continue working with new credentials
