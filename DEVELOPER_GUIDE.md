# Developer Guide - Using Refactored Services

## Quick Start

### Using ClaudeMCPService with ServiceFactory

**❌ OLD WAY (Don't do this):**
```typescript
// This creates duplicate credential caches!
const claudeService1 = new ClaudeMCPService('dev-ah', 'us-west-2');
const claudeService2 = new ClaudeMCPService('dev-ah', 'us-west-2');
```

**✅ NEW WAY (Always use this):**
```typescript
import { ServiceFactory } from './services/ServiceFactory.js';

// Get shared instance - creates once, reuses thereafter
const claudeService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
```

---

## Service Usage Patterns

### 1. Using ChatOrchestrator

```typescript
import { ServiceFactory } from '../services/ServiceFactory.js';

// In your route handler
router.post('/message', async (req, res) => {
  const { profile, region, message } = req.body;

  // Get orchestrator with shared credentials
  const orchestrator = ServiceFactory.getChatOrchestrator(profile, region);

  // Use it
  await orchestrator.handleChatMessage(sessionId, message, ws, profile, region);
});
```

**Why?**
- Ensures single credential cache per profile
- Automatic heartbeat management
- Tool visibility built-in

---

### 2. Using CostAnalysisService

```typescript
import { ServiceFactory } from '../services/ServiceFactory.js';

// In your route handler
router.post('/cost/report', async (req, res) => {
  const { profile, region, startDate, endDate } = req.body;

  // Get cost service with shared credentials
  const costService = ServiceFactory.getCostAnalysisService(profile, region);

  // Use it
  const report = await costService.getCostReport({
    profile,
    region,
    startDate,
    endDate,
  });

  res.json(report);
});
```

**Why?**
- Shares credentials with other services
- Aggressive JSON parsing built-in
- Cost data fetching optimized

---

### 3. Direct ClaudeMCPService Usage (Advanced)

```typescript
import { ServiceFactory } from '../services/ServiceFactory.js';

// Get the shared Claude service
const claudeService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');

// Query Claude
const response = await claudeService.query('List all S3 buckets', 60000);
console.log(response.content);
```

**When to use directly?**
- Custom AWS queries not covered by Chat or Cost services
- Specialized automation scripts
- Testing and debugging

---

## Understanding Service Lifecycle

### Singleton Pattern

```
Request 1: GET /api/chat/suggestions?profile=dev-ah&region=us-west-2
  └─> ServiceFactory.getChatOrchestrator('dev-ah', 'us-west-2')
      └─> ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2')
          └─> Creates NEW ClaudeMCPService ✅
          └─> Stores in Map with key "dev-ah:us-west-2"

Request 2: POST /api/cost/report (profile=dev-ah, region=us-west-2)
  └─> ServiceFactory.getCostAnalysisService('dev-ah', 'us-west-2')
      └─> ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2')
          └─> Returns EXISTING ClaudeMCPService ✅ (same credential cache!)

Request 3: POST /api/chat/message (profile=dev-ah, region=us-west-2)
  └─> ServiceFactory.getChatOrchestrator('dev-ah', 'us-west-2')
      └─> Returns EXISTING ChatOrchestrator ✅
          └─> Uses EXISTING ClaudeMCPService ✅
```

**Result**: All three requests share ONE credential cache. No conflicts!

---

## Handling Multiple Profiles/Regions

```typescript
// Different profiles = different services
const devService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
const prodService = ServiceFactory.getClaudeMCPService('prod-ah', 'us-west-2');
// These are SEPARATE instances with separate credential caches ✅

// Different regions = different services
const usWest = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
const usEast = ServiceFactory.getClaudeMCPService('dev-ah', 'us-east-1');
// These are SEPARATE instances ✅

// Same profile + region = shared service
const service1 = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
const service2 = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
// service1 === service2 ✅
```

---

## Credential Refresh

### Automatic Refresh

The system automatically refreshes credentials when:
1. Cache age > 5 minutes
2. AWS returns `ExpiredToken` error
3. Botocore credential loop detected

```typescript
// You don't need to do anything!
const claudeService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');

// First call - fetches fresh credentials
await claudeService.query('List EC2 instances');

// Second call - uses cached credentials (if < 5 min old)
await claudeService.query('List S3 buckets');

// After 5 minutes - automatically refreshes
await claudeService.query('List RDS instances');
```

### Manual Refresh

```typescript
// Force refresh for a profile
ServiceFactory.clearProfile('dev-ah');

// Next call will fetch fresh credentials
const claudeService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
```

**When to use?**
- User clicks "Refresh Session" button
- After AWS SSO login
- After detecting persistent credential errors

---

## Error Handling

### Credential Errors

```typescript
try {
  const claudeService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
  const response = await claudeService.query('List resources');
} catch (error) {
  if (error.message.includes('ExpiredToken')) {
    // Suggest user to refresh session
    return res.status(401).json({
      error: 'AWS session expired',
      suggestion: 'Please run: aws sso login --profile dev-ah',
    });
  }

  if (error.message.includes('Botocore credential loop')) {
    // Clear profile and retry
    ServiceFactory.clearProfile('dev-ah');
    return res.status(401).json({
      error: 'Credential refresh loop detected',
      suggestion: 'Please re-authenticate with AWS',
    });
  }

  // Other errors
  return res.status(500).json({ error: error.message });
}
```

---

## WebSocket Integration (Chat)

### Frontend Example

```typescript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3001/api/chat');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'connected':
      console.log('Session ID:', data.sessionId);
      break;

    case 'heartbeat':
      // Connection is alive
      console.log('Heartbeat received at:', data.timestamp);
      break;

    case 'tool_start':
      // Show loading indicator
      console.log('AWS query started:', data.message);
      break;

    case 'tool_complete':
      // Hide loading indicator
      console.log('AWS query completed');
      break;

    case 'token':
      // Streaming response
      appendToChat(data.content);
      break;

    case 'complete':
      // Full response received
      console.log('Response complete');
      break;

    case 'error':
      // Handle error
      console.error('Error:', data.message);
      break;
  }
};

// Send message
ws.send(JSON.stringify({
  type: 'message',
  sessionId: 'abc-123',
  message: 'Show me expensive resources',
  profile: 'dev-ah',
  region: 'us-west-2',
}));
```

---

## Monitoring and Debugging

### Check Service Stats

```typescript
import { ServiceFactory } from './services/ServiceFactory.js';

// Get current service counts
const stats = ServiceFactory.getStats();
console.log(stats);
// Output:
// {
//   claudeServices: 3,      // 3 profile+region combinations
//   chatOrchestrators: 3,
//   costServices: 2
// }
```

### Add to Health Check

```typescript
// In server.ts
app.get('/health', (req, res) => {
  const cacheStats = cacheService.getStats();
  const serviceStats = ServiceFactory.getStats();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: cacheStats,
    services: serviceStats, // Add this
  });
});
```

### Enable Debug Logging

Look for these log prefixes:
- `[ServiceFactory]` - Service creation/reuse
- `[ClaudeMCP]` - Credential operations
- `[ChatOrchestrator]` - Chat operations + heartbeats
- `[CostAnalysis]` - Cost queries + JSON parsing

```bash
# In your terminal, filter logs
npm start | grep '\[ClaudeMCP\]'
npm start | grep '\[ServiceFactory\]'
```

---

## Best Practices

### 1. Always Use ServiceFactory

```typescript
// ✅ CORRECT
const service = ServiceFactory.getChatOrchestrator(profile, region);

// ❌ WRONG
const service = new ChatOrchestrator(profile, region);
```

### 2. Don't Store Service Instances

```typescript
// ❌ WRONG - storing instance
class MyClass {
  private orchestrator: ChatOrchestrator;

  constructor() {
    this.orchestrator = ServiceFactory.getChatOrchestrator('dev-ah', 'us-west-2');
  }
}

// ✅ CORRECT - get instance when needed
class MyClass {
  async handleMessage(profile: string, region: string) {
    const orchestrator = ServiceFactory.getChatOrchestrator(profile, region);
    // use it
  }
}
```

**Why?** ServiceFactory already manages instances. Storing them duplicates management.

### 3. Use Async/Await Consistently

```typescript
// ✅ CORRECT
const response = await claudeService.query('List resources', 60000);

// ❌ WRONG
claudeService.query('List resources').then(response => { ... });
```

### 4. Set Appropriate Timeouts

```typescript
// Short query (default 2 min timeout)
const response = await claudeService.query('List EC2 in us-west-2');

// Long query (custom timeout)
const response = await claudeService.query(
  'Run full security audit across all services',
  300000  // 5 minutes
);
```

---

## Common Patterns

### Pattern 1: Multi-Region Query

```typescript
async function queryAllRegions(profile: string) {
  const regions = ['us-west-2', 'us-east-1', 'eu-west-1'];

  const results = await Promise.all(
    regions.map(async (region) => {
      const service = ServiceFactory.getClaudeMCPService(profile, region);
      return service.query(`List EC2 instances in ${region}`);
    })
  );

  return results;
}
```

### Pattern 2: Sequential Profile Queries

```typescript
async function compareProfiles(profiles: string[]) {
  const results = [];

  for (const profile of profiles) {
    const service = ServiceFactory.getCostAnalysisService(profile, 'us-west-2');
    const summary = await service.getCostSummary(profile, startDate, endDate);
    results.push({ profile, summary });
  }

  return results;
}
```

### Pattern 3: Retry with Fresh Credentials

```typescript
async function queryWithRetry(profile: string, region: string, query: string) {
  let retries = 2;

  while (retries > 0) {
    try {
      const service = ServiceFactory.getClaudeMCPService(profile, region);
      return await service.query(query);
    } catch (error) {
      if (error.message.includes('ExpiredToken') && retries > 1) {
        console.log('Credentials expired, clearing cache and retrying...');
        ServiceFactory.clearProfile(profile);
        retries--;
      } else {
        throw error;
      }
    }
  }
}
```

---

## Testing

### Unit Test Example

```typescript
import { ServiceFactory } from '../services/ServiceFactory.js';

describe('ServiceFactory', () => {
  afterEach(() => {
    // Clear services between tests
    ServiceFactory.cleanup();
  });

  it('should return same instance for same profile+region', () => {
    const service1 = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
    const service2 = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');

    expect(service1).toBe(service2);
  });

  it('should return different instances for different profiles', () => {
    const devService = ServiceFactory.getClaudeMCPService('dev-ah', 'us-west-2');
    const prodService = ServiceFactory.getClaudeMCPService('prod-ah', 'us-west-2');

    expect(devService).not.toBe(prodService);
  });

  it('should share ClaudeMCPService between Chat and Cost services', () => {
    const chat = ServiceFactory.getChatOrchestrator('dev-ah', 'us-west-2');
    const cost = ServiceFactory.getCostAnalysisService('dev-ah', 'us-west-2');

    // Both should use the same underlying ClaudeMCPService
    // (You'd need to expose a getter for testing)
    expect(chat['claudeService']).toBe(cost['claudeService']);
  });
});
```

---

## Migration from Old Code

### Step 1: Update Imports

```typescript
// OLD
import { ClaudeMCPService } from './services/ClaudeMCPService.js';
import { ChatOrchestrator } from './services/ChatOrchestrator.js';
import { CostAnalysisService } from './services/CostAnalysisService.js';

// NEW
import { ServiceFactory } from './services/ServiceFactory.js';
```

### Step 2: Replace Instantiation

```typescript
// OLD
const claudeService = new ClaudeMCPService(profile, region);
const chatOrchestrator = new ChatOrchestrator(profile, region);
const costService = new CostAnalysisService(profile, region);

// NEW
const claudeService = ServiceFactory.getClaudeMCPService(profile, region);
const chatOrchestrator = ServiceFactory.getChatOrchestrator(profile, region);
const costService = ServiceFactory.getCostAnalysisService(profile, region);
```

### Step 3: Remove Stored Instances

```typescript
// OLD
class MyRoutes {
  private costService = new CostAnalysisService('dev-ah', 'us-west-2');

  async getCosts() {
    return this.costService.getCostSummary(...);
  }
}

// NEW
class MyRoutes {
  async getCosts(profile: string, region: string) {
    const costService = ServiceFactory.getCostAnalysisService(profile, region);
    return costService.getCostSummary(...);
  }
}
```

---

## Troubleshooting

### Issue: "ExpiredToken" errors persist

**Solution:**
```typescript
// Clear the profile and force fresh credentials
ServiceFactory.clearProfile('dev-ah');

// Next request will fetch fresh credentials
```

### Issue: WebSocket disconnects during long queries

**Check:**
1. Are heartbeats being sent? Look for `[ChatOrchestrator] Sent heartbeat` logs
2. Is the query timeout too short? Increase it:
   ```typescript
   await claudeService.query(prompt, 180000); // 3 minutes instead of 2
   ```

### Issue: Multiple credential refresh calls

**Check:**
1. Are you creating multiple service instances? Use ServiceFactory!
2. Check logs for `[ServiceFactory] Creating new ClaudeMCPService` - should be once per profile+region

### Issue: JSON parsing fails

**Check:**
1. Look for `[CostAnalysis] Extracted JSON using...` log
2. If all strategies fail, the response might not contain JSON
3. Enable verbose logging to see raw response

---

## Performance Tips

1. **Reuse Services**: ServiceFactory automatically reuses instances
2. **Parallel Queries**: Use `Promise.all()` for independent queries
3. **Appropriate Timeouts**: Set timeouts based on query complexity
4. **Monitor Stats**: Use `ServiceFactory.getStats()` to track instance count
5. **Cleanup**: Call `ServiceFactory.cleanup()` on server shutdown

---

## Next Steps

- Read [REFACTORING_SUMMARY.md](./REFACTORING_SUMMARY.md) for technical details
- Check examples in `routes/chat.ts` and `routes/cost.ts`
- Review error handling patterns in `ClaudeMCPService.ts`
- Test with your AWS profile: `npm start`

---

**Questions?** Check the logs with prefixes: `[ServiceFactory]`, `[ClaudeMCP]`, `[ChatOrchestrator]`, `[CostAnalysis]`
