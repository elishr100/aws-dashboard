# Debugging Resource Display Issue

## Problem
AWS Dashboard scans complete successfully with security findings, but the UI shows 0 resources after scan completion.

## Root Cause Analysis

The issue is likely caused by one of:

1. **Profile Name Mismatch** - The scan caches resources under one profile name (e.g., "dev-ah"), but the Dashboard UI queries for resources under a different profile name
2. **Timing Issue** - Dashboard loads before scan completes
3. **Cache Expiration** - Resources expire from cache before dashboard queries (unlikely, TTL is 1 hour)

## Changes Made

### 1. Enhanced Logging in `/backend/src/routes/scan.ts`

Added logging to track:
- Exact profile name used when starting scan
- Cache key prefix that will be used: `resources:${profile}:`
- Cache key for each region when storing resources
- Profile name in scan completion message

**Lines Modified:**
- Line 27: Added profile and cache key prefix logging
- Line 323: Added cache key logging after storing resources
- Line 169: Added profile name to completion message

### 2. Enhanced Logging in `/backend/src/routes/resources.ts`

Added logging to track:
- Profile prefix being searched
- All cache keys currently stored
- Matching cache keys found
- Improved error message with debugging hint

**Lines Modified:**
- Lines 165-167: Added comprehensive cache key logging
- Line 171: Enhanced error message with available keys

### 3. New Cache Debug Endpoint

Created `/api/resources/cache/debug` endpoint that returns:
- All cache keys
- Cache statistics (size, hits, misses, hit rate)
- Keys grouped by type (resources, security, alerts, other)
- Detailed summary of each resource cache entry including:
  - Cache key
  - Resource count
  - Profile name
  - Region
  - Fetch timestamp
  - Remaining TTL in seconds

**Location:** `/backend/src/routes/resources.ts` lines 239-281

### 4. Added Cost Fetch Logging

Added logging when fetching resources from cache for cost analysis:
- Shows cache key being used
- Shows number of resources found

**Location:** `/backend/src/routes/scan.ts` line 374

## How to Diagnose

### Step 1: Run a Scan and Watch Backend Logs

Start the backend in a terminal and watch for these log messages:

```bash
cd backend
npm run dev
```

When you trigger a scan, look for:

```
[API] POST /scan - profile: "dev-ah", regions: us-east-1, us-west-2
[API] POST /scan - Profile will be used for caching with key prefix: resources:dev-ah:
[Scan] Starting scan ... for dev-ah in 2 regions
[Scan] Found 5 resources in us-east-1
[Scan] Cached resources under key: resources:dev-ah:us-east-1
[Scan] Found 8 resources in us-west-2
[Scan] Cached resources under key: resources:dev-ah:us-west-2
[Scan] Scan ... completed - found 13 resources
[Scan] Resources cached for profile: dev-ah across 2 regions
```

**Take note of the exact profile name in quotes on the first line.**

### Step 2: Check Dashboard Query

When the Dashboard loads and queries for stats, look for:

```
[API] GET /resources/stats - profile: dev-ah, region: us-west-2
[API] GET /resources/stats - looking for profile prefix: resources:dev-ah:
[API] All cache keys: resources:dev-ah:us-east-1, resources:dev-ah:us-west-2, security:dev-ah:us-east-1, ...
[API] Relevant keys found: 2 - resources:dev-ah:us-east-1, resources:dev-ah:us-west-2
```

### Step 3: Compare Profile Names

**Critical Check:** Do the profile names match EXACTLY?

- Scan used: `resources:dev-ah:`
- Dashboard searched for: `resources:dev-ah:`

If they don't match (e.g., `dev-ah` vs `dev-ah-profile` vs `DevAH`), that's your issue!

### Step 4: Use Cache Debug Endpoint

Call the cache debug endpoint to see what's actually cached:

```bash
curl http://localhost:3001/api/resources/cache/debug | jq
```

This will show:
- All cache keys currently stored
- Resource counts for each region
- Which profiles have cached data
- TTL remaining for each cache entry

Look for:
```json
{
  "resourceSummary": [
    {
      "key": "resources:dev-ah:us-east-1",
      "resourceCount": 5,
      "profile": "dev-ah",
      "region": "us-east-1",
      "fetchedAt": "2024-01-15T10:30:00.000Z",
      "ttlSeconds": 3420
    }
  ]
}
```

### Step 5: Check Browser Console

Open browser DevTools console and watch for:
- API calls to `/api/resources/stats?profile=X&region=Y`
- Error responses with debugging hints

## Common Issues and Solutions

### Issue 1: Profile Name Mismatch

**Symptom:**
- Scan logs: `Cached resources under key: resources:profile-a:`
- Dashboard logs: `looking for profile prefix: resources:profile-b:`

**Solution:**
- Check `/api/accounts` response to see what profile names are available
- Ensure the scan uses the same profile as what's shown in the account selector
- Verify `~/.aws/config` has the correct profile names

### Issue 2: No Resources Found in Cache

**Symptom:**
- Scan completes successfully
- Cache debug endpoint shows 0 resource keys
- Security findings still created (from cached data during scan)

**Solution:**
- Check if cache TTL expired (1 hour = 3600 seconds)
- Verify `cacheService.set()` is being called successfully
- Check for errors during cache write operations

### Issue 3: Dashboard Query Before Scan Complete

**Symptom:**
- Dashboard loads and immediately shows 0 resources
- Scan completes 30 seconds later
- Dashboard still shows 0 (waiting for next refetch interval)

**Solution:**
- Dashboard auto-refreshes every 30 seconds
- Manually refresh the dashboard page after scan completes
- Or implement real-time updates using WebSocket/SSE

### Issue 4: React Query Cache Staleness

**Symptom:**
- Backend returns correct data
- Browser still shows old data (0 resources)

**Solution:**
- Check browser Network tab to see if request is actually being made
- Clear browser cache or hard refresh (Cmd+Shift+R / Ctrl+Shift+R)
- Check React Query DevTools to see cache state

## Architecture Overview

### Cache Flow

1. **Scan Starts**
   ```
   POST /api/scan { profile: "dev-ah", regions: [...] }
   ```

2. **Resources Discovered**
   ```
   For each region:
     - ResourceDiscoveryAgent.discoverAll(region)
     - Returns ResourceInventory with resources[]
     - Cached with key: resources:${profile}:${region}
     - TTL: 3600 seconds (1 hour)
   ```

3. **Security Audit Runs** (automatically after scan)
   ```
   - Reads resources from cache
   - Generates security findings
   - Creates alerts for CRITICAL/HIGH severity
   ```

4. **Job Cleanup** (5 minutes after completion)
   ```
   - Deletes job from scanJobs Map
   - Does NOT delete cached resources
   - Resources remain in cache for full TTL (1 hour)
   ```

5. **Dashboard Query**
   ```
   GET /api/resources/stats?profile=dev-ah
   - Searches for all keys starting with "resources:dev-ah:"
   - Aggregates resources across all regions
   - Returns stats by type, region, VPC, state
   ```

### Key Classes

- **CacheService** (`/backend/src/services/CacheService.ts`)
  - Singleton instance: `cacheService`
  - In-memory Map with TTL support
  - Cleanup runs every 60 seconds
  - Static methods for building cache keys

- **ResourceDiscoveryAgent** (`/backend/src/agents/ResourceDiscoveryAgent.ts`)
  - Discovers AWS resources using Claude MCP service
  - Returns ResourceInventory objects
  - Parallel discovery across resource types

- **ServiceFactory** (`/backend/src/services/ServiceFactory.ts`)
  - Provides shared singleton service instances
  - Ensures consistent profile/region across services

## Testing the Fix

### Test Case 1: Fresh Scan

1. Clear browser cache
2. Start backend with logging: `npm run dev`
3. Trigger a new scan from UI
4. Watch backend logs for profile names and cache keys
5. Wait for scan to complete
6. Refresh dashboard
7. Verify resources appear

### Test Case 2: Cache Inspection

1. Run a scan
2. Call cache debug endpoint: `curl http://localhost:3001/api/resources/cache/debug`
3. Verify resources are cached with correct profile name
4. Check TTL is > 0
5. Load dashboard
6. Verify dashboard queries with same profile name

### Test Case 3: Multiple Profiles

1. Configure multiple profiles in `~/.aws/config`
2. Run scan with profile A
3. Switch to profile B in UI
4. Verify dashboard shows 0 resources (correct - different profile)
5. Switch back to profile A
6. Verify dashboard shows resources from scan

## Next Steps if Issue Persists

If after adding this logging the issue still isn't clear:

1. **Capture Full Logs**
   - Run backend with logging enabled
   - Trigger scan
   - Save all log output to a file
   - Share logs for analysis

2. **Check Cache Debug Endpoint**
   - Call immediately after scan completes
   - Share the JSON response
   - Compare cache keys with dashboard query

3. **Verify AWS Config**
   - Check `~/.aws/config` file
   - Verify profile names match what's shown in UI
   - Ensure no whitespace or special characters in profile names

4. **Browser DevTools**
   - Network tab: Check actual API calls and responses
   - Console tab: Check for JavaScript errors
   - React Query DevTools: Check cache state

## Additional Debugging Tools

### List All Accounts
```bash
curl http://localhost:3001/api/accounts | jq
```

### Check Specific Profile Stats
```bash
curl "http://localhost:3001/api/resources/stats?profile=dev-ah" | jq
```

### Check Cache Statistics
```bash
curl http://localhost:3001/health | jq '.cache'
```

### Check Scan Job Status
```bash
curl http://localhost:3001/api/scan/{jobId}/status | jq
```
