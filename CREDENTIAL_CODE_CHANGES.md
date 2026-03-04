# AWS Credential Management - Code Changes

## Overview

This document shows the exact code changes made to fix credential management issues.

---

## 1. ClaudeMCPService - Credential Fetching

### Location
`backend/src/services/ClaudeMCPService.ts:11-86`

### BEFORE ❌
```typescript
export class ClaudeMCPService {
  private profile: string;
  private region: string;
  private awsCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } | null = null;

  private getAWSCredentials(): void {
    try {
      // Always check environment variables first (these are updated by session refresh)
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        console.log(`[ClaudeMCP] Using credentials from environment variables`);
        this.awsCredentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN,
        };
        return;
      }

      // If no env credentials and we already have cached profile credentials, use those
      if (this.awsCredentials) {
        console.log(`[ClaudeMCP] Using cached credentials for profile: ${this.profile}`);
        return; // ❌ Cache never expires!
      }

      // Fetch fresh credentials from profile
      const output = execSync(
        `aws configure export-credentials --profile ${this.profile} --format env`,
        { encoding: 'utf-8' } // ❌ Inherits process.env with stale credentials!
      );

      // ... parse and cache credentials
    } catch (error: any) {
      console.error(`[ClaudeMCP] Failed to get credentials:`, error.message);
      throw new Error(`Failed to get AWS credentials: ${error.message}`);
      // ❌ Generic error message, no error code
    }
  }
}
```

**Problems:**
1. ❌ Checks stale `process.env` credentials first
2. ❌ Cache never expires (cached indefinitely)
3. ❌ `execSync` inherits stale credentials from `process.env`
4. ❌ No credential validation
5. ❌ Generic error messages

---

### AFTER ✅
```typescript
export class ClaudeMCPService {
  private profile: string;
  private region: string;
  private awsCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  } | null = null;
  private lastCredentialFetch: number = 0;
  private static readonly CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000; // ✅ 5-minute TTL

  private getAWSCredentials(forceRefresh: boolean = false): void {
    try {
      const now = Date.now();
      const cacheAge = now - this.lastCredentialFetch;

      // ✅ Check if cached credentials are still fresh (< 5 min old)
      if (!forceRefresh && this.awsCredentials && cacheAge < ClaudeMCPService.CREDENTIAL_CACHE_TTL_MS) {
        console.log(`[ClaudeMCP] Using cached credentials (age: ${Math.floor(cacheAge / 1000)}s)`);
        return;
      }

      if (forceRefresh) {
        console.log(`[ClaudeMCP] Force refreshing credentials`);
        this.awsCredentials = null; // ✅ Clear cache
      }

      // ✅ IMPORTANT: Clear any stale environment variables
      const cleanEnv = { ...process.env };
      delete cleanEnv.AWS_ACCESS_KEY_ID;
      delete cleanEnv.AWS_SECRET_ACCESS_KEY;
      delete cleanEnv.AWS_SESSION_TOKEN;

      // ✅ Use clean environment without stale credentials
      const output = execSync(
        `aws configure export-credentials --profile ${this.profile} --format env`,
        {
          encoding: 'utf-8',
          env: cleanEnv, // ✅ Pass clean environment
        }
      );

      // ... parse credentials ...

      this.awsCredentials = { /* ... */ };
      this.lastCredentialFetch = now; // ✅ Track fetch time

      // ✅ Validate credentials before use
      this.validateCredentials();

      console.log(`[ClaudeMCP] Successfully fetched and validated credentials`);
    } catch (error: any) {
      this.awsCredentials = null; // ✅ Clear cache on error
      this.lastCredentialFetch = 0;

      const errorMessage = error.stderr || error.message || 'Unknown error';

      // ✅ Check for specific error types
      if (errorMessage.includes('ExpiredToken') || errorMessage.includes('expired')) {
        throw new Error(`AWS credentials are expired for profile ${this.profile}. Please refresh your session.`);
      } else if (errorMessage.includes('InvalidClientTokenId')) {
        throw new Error(`AWS credentials are invalid for profile ${this.profile}.`);
      } else {
        throw new Error(`Failed to get AWS credentials: ${errorMessage}`);
      }
    }
  }

  // ✅ NEW: Validate credentials with quick test call
  private validateCredentials(): void {
    if (!this.awsCredentials) {
      throw new Error('No credentials to validate');
    }

    try {
      const env = {
        AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: this.awsCredentials.secretAccessKey,
        AWS_SESSION_TOKEN: this.awsCredentials.sessionToken,
        AWS_REGION: this.region,
      };

      // Quick test call to verify credentials work
      execSync('aws sts get-caller-identity', {
        encoding: 'utf-8',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: any) {
      const errorMessage = error.stderr || error.message || 'Unknown error';

      if (errorMessage.includes('ExpiredToken')) {
        throw new Error('Credentials are expired');
      } else if (errorMessage.includes('InvalidClientTokenId')) {
        throw new Error('Credentials are invalid');
      } else {
        throw new Error(`Credential validation failed: ${errorMessage}`);
      }
    }
  }
}
```

**Improvements:**
1. ✅ 5-minute credential cache TTL
2. ✅ Clean environment variables (no stale credentials)
3. ✅ Credential validation before use
4. ✅ Clear cache on error
5. ✅ Specific error messages with error codes

---

## 2. ClaudeMCPService - AWS CLI Execution

### Location
`backend/src/services/ClaudeMCPService.ts:131-187`

### BEFORE ❌
```typescript
private executeAWSCommand(command: string): string {
  try {
    this.getAWSCredentials();

    const cleanedCommand = command.replace(/--profile[=\s]+[\w-]+/g, '').trim();

    // ❌ Spreads entire process.env, including stale credentials
    const env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: this.awsCredentials.secretAccessKey,
      AWS_SESSION_TOKEN: this.awsCredentials.sessionToken,
      AWS_REGION: this.region,
    };

    const output = execSync(cleanedCommand, { encoding: 'utf-8', env });
    return output;
  } catch (error: any) {
    const errorMessage = error.stderr || error.message || 'Unknown error';
    console.error(`[ClaudeMCP] AWS CLI error:`, errorMessage);
    // ❌ No retry, no error code extraction
    throw new Error(`AWS CLI command failed: ${errorMessage}`);
  }
}
```

**Problems:**
1. ❌ Spreads `process.env` (includes stale credentials)
2. ❌ No retry logic for expired credentials
3. ❌ No error code extraction

---

### AFTER ✅
```typescript
private executeAWSCommand(command: string, retryCount: number = 0): string {
  const MAX_RETRIES = 1;

  try {
    this.getAWSCredentials();

    const cleanedCommand = command.replace(/--profile[=\s]+[\w-]+/g, '').trim();

    // ✅ IMPORTANT: Don't spread process.env to avoid inheriting stale credentials
    const env = {
      AWS_ACCESS_KEY_ID: this.awsCredentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: this.awsCredentials.secretAccessKey,
      AWS_SESSION_TOKEN: this.awsCredentials.sessionToken,
      AWS_REGION: this.region,
      AWS_DEFAULT_REGION: this.region,
      PATH: process.env.PATH, // ✅ Only keep necessary env vars
      HOME: process.env.HOME,
    };

    if (retryCount === 0) {
      console.log(`[ClaudeMCP] Executing AWS CLI: ${cleanedCommand}`);
    } else {
      console.log(`[ClaudeMCP] Retrying AWS CLI (attempt ${retryCount + 1}): ${cleanedCommand}`);
    }

    const output = execSync(cleanedCommand, {
      encoding: 'utf-8',
      env,
      maxBuffer: 10 * 1024 * 1024,
    });

    return output;
  } catch (error: any) {
    const errorMessage = error.stderr || error.message || 'Unknown error';
    const errorString = String(errorMessage);

    // ✅ Extract AWS error code if present
    const errorCodeMatch = errorString.match(/\((ExpiredToken|InvalidClientTokenId|AccessDenied|...)\)/);
    const errorCode = errorCodeMatch ? errorCodeMatch[1] : null;

    if (errorCode) {
      console.error(`[ClaudeMCP] AWS CLI error [${errorCode}]:`, errorMessage);
    } else {
      console.error(`[ClaudeMCP] AWS CLI error:`, errorMessage);
    }

    // ✅ Retry logic for expired credentials
    if (retryCount < MAX_RETRIES && (errorString.includes('ExpiredToken') || errorString.includes('expired'))) {
      console.log(`[ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...`);
      this.getAWSCredentials(true); // ✅ Force refresh
      return this.executeAWSCommand(command, retryCount + 1); // ✅ Retry
    }

    // ✅ Throw with error code if available
    if (errorCode) {
      throw new Error(`AWS CLI command failed [${errorCode}]: ${errorMessage}`);
    } else {
      throw new Error(`AWS CLI command failed: ${errorMessage}`);
    }
  }
}
```

**Improvements:**
1. ✅ Minimal environment (only `PATH` and `HOME` from `process.env`)
2. ✅ Auto-retry with fresh credentials on `ExpiredToken`
3. ✅ Extract and log AWS error codes
4. ✅ Clear retry logging

---

## 3. ClaudeMCPService - Bedrock API Execution

### Location
`backend/src/services/ClaudeMCPService.ts:163-326`

### BEFORE ❌
```typescript
private async executeQuery(prompt: string): Promise<ClaudeResponse> {
  this.getAWSCredentials();

  const client = new BedrockRuntimeClient({
    region: this.region,
    credentials: {
      accessKeyId: this.awsCredentials.accessKeyId,
      secretAccessKey: this.awsCredentials.secretAccessKey,
      sessionToken: this.awsCredentials.sessionToken,
    },
  });

  try {
    // ... API call logic ...
  } catch (error: any) {
    console.error(`[ClaudeMCP] Error:`, error.message);
    // ❌ No retry, no error code extraction
    throw new Error(`Claude API failed: ${error.message}`);
  }
}
```

**Problems:**
1. ❌ No retry logic for expired credentials
2. ❌ No error code extraction from AWS SDK errors

---

### AFTER ✅
```typescript
private async executeQuery(prompt: string, retryCount: number = 0): Promise<ClaudeResponse> {
  const MAX_RETRIES = 1;

  try {
    this.getAWSCredentials();

    if (retryCount === 0) {
      console.log(`[ClaudeMCP] Executing Claude API with profile=${this.profile}, region=${this.region}`);
    } else {
      console.log(`[ClaudeMCP] Retrying Claude API (attempt ${retryCount + 1})`);
    }

    const client = new BedrockRuntimeClient({
      region: this.region,
      credentials: {
        accessKeyId: this.awsCredentials.accessKeyId,
        secretAccessKey: this.awsCredentials.secretAccessKey,
        sessionToken: this.awsCredentials.sessionToken,
      },
    });

    // ... API call logic ...
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    const errorName = error.name || 'UnknownError';

    // ✅ Log detailed error information
    console.error(`[ClaudeMCP] Error [${errorName}]:`, errorMessage);
    if (error.$metadata) {
      console.error(`[ClaudeMCP] AWS Error metadata:`, JSON.stringify(error.$metadata));
    }
    if (error.Code) {
      console.error(`[ClaudeMCP] AWS Error Code:`, error.Code);
    }

    // ✅ Retry logic for expired credentials
    if (
      retryCount < MAX_RETRIES &&
      (errorName === 'ExpiredTokenException' ||
        errorName === 'UnrecognizedClientException' ||
        errorMessage.includes('ExpiredToken') ||
        errorMessage.includes('expired'))
    ) {
      console.log(`[ClaudeMCP] Credentials expired, fetching fresh credentials and retrying...`);
      this.getAWSCredentials(true); // ✅ Force refresh
      return this.executeQuery(prompt, retryCount + 1); // ✅ Retry
    }

    throw new Error(`Claude API failed [${errorName}]: ${errorMessage}`);
  }
}
```

**Improvements:**
1. ✅ Auto-retry with fresh credentials on SDK credential errors
2. ✅ Extract and log AWS SDK error codes and metadata
3. ✅ Clear retry logging

---

## 4. ResourceDiscoveryAgent - Error Logging

### Location
`backend/src/agents/ResourceDiscoveryAgent.ts:159-173`

### BEFORE ❌
```typescript
try {
  const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
  const parsed = this.parseResourceResponse(response.content, resourceType, region);
  resources.push(...parsed.resources);

  if (parsed.error) {
    errors.push(`${resourceType}: ${parsed.error}`);
  }
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[ResourceDiscovery] Error discovering ${resourceType}:`, errorMsg);
  errors.push(`${resourceType}: ${errorMsg}`);
  // ❌ No error code extraction
}
```

**Problems:**
1. ❌ No AWS error code extraction
2. ❌ Generic error messages

---

### AFTER ✅
```typescript
try {
  const response = await this.claudeService.query(prompt, ResourceDiscoveryAgent.TOOL_CALL_TIMEOUT);
  const parsed = this.parseResourceResponse(response.content, resourceType, region);
  resources.push(...parsed.resources);

  if (parsed.error) {
    errors.push(`${resourceType}: ${parsed.error}`);
  }
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);

  // ✅ Extract AWS error code if present for better debugging
  const errorCodeMatch = errorMsg.match(/\[(ExpiredToken|InvalidClientTokenId|AccessDenied|...)\]/);
  const errorCode = errorCodeMatch ? errorCodeMatch[1] : null;

  if (errorCode) {
    console.error(`[ResourceDiscovery] Error discovering ${resourceType} [${errorCode}]:`, errorMsg);
    errors.push(`${resourceType} [${errorCode}]: ${errorMsg}`);
  } else {
    console.error(`[ResourceDiscovery] Error discovering ${resourceType}:`, errorMsg);
    errors.push(`${resourceType}: ${errorMsg}`);
  }
}
```

**Improvements:**
1. ✅ Extract and display AWS error codes
2. ✅ Clear error messages with error codes

---

### Location
`backend/src/agents/ResourceDiscoveryAgent.ts:103-111`

### BEFORE ❌
```typescript
console.log(`[ResourceDiscovery] Found ${resources.length} resources in ${region} (${errors.length} errors)`);
// ❌ Doesn't show what the errors are
```

**Problems:**
1. ❌ Shows error count but not error details

---

### AFTER ✅
```typescript
if (errors.length > 0) {
  console.log(`[ResourceDiscovery] Found ${resources.length} resources in ${region} (${errors.length} errors)`);
  console.log(`[ResourceDiscovery] Errors encountered:`);
  errors.forEach((err, idx) => {
    console.log(`[ResourceDiscovery]   ${idx + 1}. ${err}`);
  });
} else {
  console.log(`[ResourceDiscovery] Found ${resources.length} resources in ${region} (no errors)`);
}
```

**Improvements:**
1. ✅ Lists all errors with details
2. ✅ Shows error codes in error list

---

## Summary of Changes

| Component | Change | Impact |
|-----------|--------|--------|
| Credential Cache | Added 5-minute TTL | Prevents long-lived expired credentials |
| Environment Vars | Clean before fetch | Eliminates stale credential interference |
| Credential Validation | Test with `sts get-caller-identity` | Catches expired credentials before use |
| Environment Spread | Minimal (only PATH/HOME) | Prevents stale credential inheritance |
| Auto-Retry | Retry once with fresh creds | Handles mid-operation expiration |
| Error Logging | Extract AWS error codes | Clear debugging information |
| Error Messages | Specific error types | Better user guidance |

---

## Before vs After Flow

### BEFORE ❌
```
User triggers scan
      ↓
ClaudeMCP checks process.env first
      ↓
Finds old expired AWS_ACCESS_KEY_ID/SECRET
      ↓
Uses expired credentials
      ↓
aws configure export-credentials inherits expired creds from process.env
      ↓
AWS SDK: "Credentials were refreshed, but the refreshed credentials are still expired"
      ↓
❌ FAILURE - Generic error message
```

### AFTER ✅
```
User triggers scan
      ↓
ClaudeMCP checks cache age (< 5 min?)
      ↓
Cache expired or force refresh
      ↓
Clean environment (delete AWS_ACCESS_KEY_ID/SECRET/TOKEN)
      ↓
aws configure export-credentials --profile dev-ah (clean env)
      ↓
Parse fresh credentials
      ↓
Validate with: aws sts get-caller-identity
      ↓
Cache credentials (5-minute TTL)
      ↓
Execute AWS CLI with minimal env (only PATH/HOME + creds)
      ↓
If ExpiredToken error:
      ↓
Force refresh credentials + Retry once
      ↓
✅ SUCCESS - Detailed error logging with error codes
```

---

## Testing

Run the automated test:
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

Test 4: Environment Variable Isolation
✅ Environment isolation: PASSED

Test 5: Error Handling and Messages
✅ Error handling: PASSED

🎉 All tests passed! (5/5)
```

---

## Files Modified

1. `backend/src/services/ClaudeMCPService.ts`
   - Lines 11-86: Credential fetching with TTL and validation
   - Lines 131-187: AWS CLI execution with retry
   - Lines 163-326: Bedrock API execution with retry

2. `backend/src/agents/ResourceDiscoveryAgent.ts`
   - Lines 159-173: Error code extraction
   - Lines 103-111: Detailed error logging

---

For more information:
- `CREDENTIAL_FIX_SUMMARY.md` - Complete technical documentation
- `CREDENTIAL_QUICK_FIX.md` - Quick reference guide
- `backend/src/test-credentials.ts` - Automated test script
