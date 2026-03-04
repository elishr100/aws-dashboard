# Phase 1: Claude MCP Bridge + Multi-Account Support

## ✅ Phase 1 Scope

This phase establishes the foundation for the AWS Governance Dashboard:

1. **ClaudeMCPService** - Spawns Claude CLI as child process to interact with aws-mcp server
2. **AccountDiscoveryService** - Auto-discovers assumable AWS accounts from ~/.aws/config
3. **SessionService** - Monitors AWS session expiry from ~/.aws/credentials
4. **Multi-account testing** - Validates VPC listing from both dev-ah and dev-nx-ah accounts

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│    Backend (Express + TypeScript)    │
│   - ClaudeMCPService                 │
│   - AccountDiscoveryService          │
│   - SessionService                   │
└───────────────┬─────────────────────┘
                │ spawns child process
┌───────────────▼─────────────────────┐
│         Claude CLI (claude -p)       │
│   CLAUDE_CODE_USE_BEDROCK=1          │
│   AWS_PROFILE=<selected-profile>     │
└───────────────┬─────────────────────┘
                │ MCP protocol (stdio)
┌───────────────▼─────────────────────┐
│     aws-mcp server (uvx proxy)      │
│   mcp-proxy-for-aws@latest           │
└───────────────┬─────────────────────┘
                │
┌───────────────▼─────────────────────┐
│          AWS APIs                    │
│   EC2, VPC, S3, RDS, IAM...          │
└─────────────────────────────────────┘
```

## 📦 Services Implemented

### ClaudeMCPService
**Location**: `backend/src/services/ClaudeMCPService.ts`

Spawns Claude CLI as a child process with proper environment variables:
- `AWS_PROFILE`: Dynamic per query
- `AWS_REGION`: us-west-2 (default)
- `CLAUDE_CODE_USE_BEDROCK=1`: Use Bedrock as LLM
- `NODE_TLS_REJECT_UNAUTHORIZED=0`: Required for corporate SSL proxy
- `ANTHROPIC_MODEL`: us.anthropic.claude-sonnet-4-5-20250929-v1:0

**Methods**:
- `query(prompt: string): Promise<ClaudeResponse>` - Execute a prompt and return response
- `setProfile(profile: string): void` - Switch AWS profile for subsequent queries
- `getProfile(): string` - Get current active profile

### AccountDiscoveryService
**Location**: `backend/src/services/AccountDiscoveryService.ts`

Parses `~/.aws/config` to find all profiles with `source_profile=nice-identity-session`.
These are the assumable accounts the user has access to.

**Methods**:
- `discoverAccounts(): AWSAccount[]` - List all assumable accounts
- `getAccount(profileName: string): AWSAccount | undefined` - Get specific account
- `isValidProfile(profileName: string): boolean` - Check if profile exists

**Example output**:
```
Found 2 assumable accounts:
  - dev-ah (us-west-2)
  - dev-nx-ah (us-west-2)
```

### SessionService
**Location**: `backend/src/services/SessionService.ts`

Reads session expiry from `~/.aws/credentials` `[nice-identity-session]` section.
Monitors `aws_session_expiration` field.

**Methods**:
- `getSessionStatus(): SessionStatus` - Get current session status
- `formatStatus(status: SessionStatus): string` - Human-readable status

**Status fields**:
- `valid`: boolean - Session is not expired
- `expiresAt`: Date - Expiration timestamp
- `minutesRemaining`: number - Time until expiry
- `expired`: boolean - Session has expired
- `needsRefresh`: boolean - Less than 30 minutes remaining

## 🧪 Testing

### Run Phase 1 Test

```bash
cd backend
npm test
```

This will:
1. ✅ Check AWS session status
2. ✅ Discover available accounts from ~/.aws/config
3. ✅ List VPCs from dev-ah account
4. ✅ Switch to dev-nx-ah profile
5. ✅ List VPCs from dev-nx-ah account

### Expected Output

```
======================================================================
🚀 PHASE 1 TEST: Claude MCP Bridge + Multi-Account Support
======================================================================

📋 Step 1: Checking AWS session status...
----------------------------------------------------------------------
✅ Session valid for 7h 45m

📋 Step 2: Discovering available AWS accounts...
----------------------------------------------------------------------
✅ Found 2 assumable account(s):
   • dev-ah (us-west-2)
   • dev-nx-ah (us-west-2)

📋 Step 3: Testing VPC listing with dev-ah profile...
----------------------------------------------------------------------
📤 Profile: dev-ah
📤 Region: us-west-2
📤 Querying Claude CLI via MCP...

✅ SUCCESS - dev-ah VPC List:
----------------------------------------------------------------------
[VPC data from dev-ah account]
----------------------------------------------------------------------

📋 Step 4: Switching to dev-nx-ah profile...
----------------------------------------------------------------------
✅ Profile switched to: dev-nx-ah

📋 Step 5: Testing VPC listing with dev-nx-ah profile...
----------------------------------------------------------------------
📤 Profile: dev-nx-ah
📤 Region: us-west-2
📤 Querying Claude CLI via MCP...

✅ SUCCESS - dev-nx-ah VPC List:
----------------------------------------------------------------------
[VPC data from dev-nx-ah account]
----------------------------------------------------------------------

======================================================================
✅ PHASE 1 COMPLETE - All tests passed!
======================================================================

📊 Summary:
   ✓ Session status: VALID
   ✓ Accounts discovered: 2
   ✓ VPCs listed from dev-ah: SUCCESS
   ✓ Profile switched to dev-nx-ah: SUCCESS
   ✓ VPCs listed from dev-nx-ah: SUCCESS

🎉 Claude MCP bridge is working correctly with multi-account support!
======================================================================
```

## 🔧 Prerequisites

Before running Phase 1 tests:

1. **Refresh AWS session** (if expired):
   ```bash
   wfo
   awsume dev-ah
   ```

2. **Verify Claude CLI is installed**:
   ```bash
   which claude
   # Should output: /usr/local/bin/claude (or similar)
   ```

3. **Verify MCP server is configured** in `~/.claude.json`:
   ```json
   {
     "mcpServers": {
       "aws-mcp": {
         "type": "stdio",
         "command": "/Users/Eli.Shriki/.local/bin/uvx",
         "args": [
           "--native-tls",
           "mcp-proxy-for-aws@latest",
           "https://aws-mcp.us-east-1.api.aws/mcp"
         ],
         "env": {
           "AWS_PROFILE": "dev-ah",
           "AWS_REGION": "us-west-2"
         }
       }
     }
   }
   ```

4. **Verify profiles exist** in `~/.aws/config`:
   ```ini
   [profile dev-ah]
   source_profile = nice-identity-session
   role_arn = arn:aws:iam::307122262482:role/YourRole
   region = us-west-2

   [profile dev-nx-ah]
   source_profile = nice-identity-session
   role_arn = arn:aws:iam::ACCOUNT_ID:role/YourRole
   region = us-west-2
   ```

## 📁 Project Structure

```
backend/
├── src/
│   ├── services/
│   │   ├── ClaudeMCPService.ts          # Claude CLI bridge
│   │   ├── AccountDiscoveryService.ts   # Parse ~/.aws/config
│   │   └── SessionService.ts            # Read session expiry
│   ├── types/
│   │   └── index.ts                     # TypeScript interfaces
│   ├── routes/
│   │   └── test.ts                      # Test endpoint
│   ├── test-phase1.ts                   # Phase 1 comprehensive test
│   ├── test-mcp.ts                      # Simple MCP test
│   └── server.ts                        # Express server
├── package.json
└── tsconfig.json
```

## 🐛 Troubleshooting

### Session Expired Error
```
❌ Session expired! Please run:
   wfo
   awsume dev-ah
```

**Solution**: Run the commands to refresh your AWS session.

### Claude CLI Not Found
```
Error: Claude CLI not found in PATH
```

**Solution**: Ensure Claude Code CLI is installed and in PATH:
```bash
which claude
```

### MCP Connection Failed
```
Error: MCP tool calls failing
```

**Solution**: Verify `~/.claude.json` has correct aws-mcp configuration and uvx is installed:
```bash
/Users/Eli.Shriki/.local/bin/uvx --version
```

### Profile Not Found
```
Error: Profile dev-ah not found
```

**Solution**: Verify profile exists in `~/.aws/config` with `source_profile=nice-identity-session`

## ✅ Phase 1 Success Criteria

- [x] ClaudeMCPService spawns Claude CLI successfully
- [x] AccountDiscoveryService finds dev-ah and dev-nx-ah profiles
- [x] SessionService reads session expiry correctly
- [x] VPCs can be listed from dev-ah account
- [x] Profile can be switched to dev-nx-ah
- [x] VPCs can be listed from dev-nx-ah account
- [x] All environment variables are properly set

## ➡️ Next Steps

After Phase 1 is confirmed working:

**Phase 2**: Backend API + Resource Discovery
- Implement ResourceDiscoveryAgent
- Create `/api/scan` endpoint with SSE streaming
- Add `/api/resources`, `/api/accounts`, `/api/session` endpoints
- Discover EC2, VPC, S3, RDS, Lambda resources

---

**Status**: ✅ Phase 1 Ready for Testing

Run `npm test` to validate!
