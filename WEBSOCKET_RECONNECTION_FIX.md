# WebSocket Reconnection Fix

## Problem
When a WebSocket disconnects and reconnects during an active stream, the backend continues streaming to the old (dead) WebSocket connection, causing responses to cut off mid-sentence.

### Root Cause
1. User sends message, stream starts
2. Frontend WebSocket disconnects and reconnects (gets new sessionId)
3. Backend still streams to the OLD dead sessionId → error
4. Response cuts off mid-sentence

## Solution Overview

The fix implements three key changes:

1. **Backend accepts sessionId on reconnect** - allows client to reuse existing session
2. **Backend dynamically looks up WebSocket** - streams to latest active connection
3. **Frontend preserves sessionId across reconnects** - sends existing sessionId on reconnect

## Changes Made

### 1. server.ts (Backend WebSocket Handler)
**File:** `backend/src/server.ts`

**Changes:**
- Added reconnection logic to accept existing sessionId from client
- When client sends `{ type: 'reconnect', sessionId: '<id>' }`, updates the WebSocket reference
- Allows in-flight streams to continue on the new connection
- Added 2-second timeout for initial message, defaults to new connection if no message received

**Key Code:**
```typescript
if (message.type === 'reconnect' && message.sessionId && typeof message.sessionId === 'string') {
  sessionId = message.sessionId;
  chatConnections.set(message.sessionId, ws);
  console.log(`[WebSocket] Client reconnected with existing session: ${sessionId}`);
  ws.send(JSON.stringify({ type: 'connected', sessionId, reconnected: true }));
}
```

### 2. ChatOrchestrator.ts (Backend Streaming Service)
**File:** `backend/src/services/ChatOrchestrator.ts`

**Changes:**
- Added `chatConnections` reference to constructor (injected by ServiceFactory)
- Changed `sendWebSocketMessage()` to accept `sessionId` instead of `ws` object
- Modified method to dynamically look up WebSocket from `chatConnections` Map
- Updated `streamClaudeResponse()` to look up WebSocket on every chunk
- Added brief wait period (100ms) if WebSocket is temporarily unavailable during streaming

**Key Code:**
```typescript
// Dynamically look up WebSocket for each chunk
const ws = this.chatConnections.get(sessionId);
if (!ws) {
  console.error(`[ChatOrchestrator] *** CRITICAL: No WebSocket found for session ${sessionId}`);
  throw new Error('WebSocket connection lost during streaming');
}

// If WebSocket reconnected, continue streaming
if (ws.readyState !== 1) {
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait for reconnection
  const reconnectedWs = this.chatConnections.get(sessionId);
  if (!reconnectedWs || reconnectedWs.readyState !== 1) {
    throw new Error('WebSocket connection closed during streaming');
  }
}
```

### 3. ServiceFactory.ts (Backend Service Injection)
**File:** `backend/src/services/ServiceFactory.ts`

**Changes:**
- Imported `chatConnections` from `chatState.ts`
- Updated `getChatOrchestrator()` to pass `chatConnections` to ChatOrchestrator constructor

### 4. useChat.ts (Frontend Hook)
**File:** `frontend/src/hooks/useChat.ts`

**Changes:**
- Added `isStreamingRef` to track active streaming state
- Added `reconnectTimeoutRef` for reconnection logic
- Removed `currentResponse` from useEffect dependencies (was causing unnecessary reconnects)
- Added reconnection logic: sends existing `sessionId` on reconnect
- Prevents WebSocket close during active streaming
- Implements automatic reconnection if connection drops during streaming
- Updates streaming flag on all state transitions (thinking, token, complete, error)

**Key Code:**
```typescript
ws.onopen = () => {
  console.log('[Chat] WebSocket connected');
  setIsConnected(true);

  // If we have an existing sessionId, send it to backend for reconnection
  if (currentSessionId) {
    console.log('[Chat] Sending reconnect message with sessionId:', currentSessionId);
    ws.send(JSON.stringify({ type: 'reconnect', sessionId: currentSessionId }));
  }
};

ws.onclose = () => {
  console.log('[Chat] WebSocket closed');
  setIsConnected(false);

  // Only attempt reconnect if we're actively streaming
  if (isStreamingRef.current) {
    console.log('[Chat] Connection lost during streaming, attempting reconnect...');
    reconnectTimeoutRef.current = setTimeout(() => {
      console.log('[Chat] Reconnecting...');
      connectWebSocket();
    }, 1000);
  }
};
```

### 5. chat.ts (Frontend Types)
**File:** `frontend/src/types/chat.ts`

**Changes:**
- Added `reconnected?: boolean` field to `ChatWebSocketMessage` interface

## How It Works

### Normal Flow (No Reconnection)
1. Frontend opens WebSocket → Backend generates sessionId → Stores in chatConnections
2. User sends message → Backend streams to sessionId's WebSocket
3. Stream completes successfully

### Reconnection Flow
1. Frontend opens WebSocket → Backend generates sessionId → Stores in chatConnections
2. User sends message → Backend starts streaming
3. **WebSocket disconnects** (network issue, timeout, etc.)
4. Frontend detects close → Checks `isStreamingRef.current === true`
5. Frontend automatically reconnects → Sends `{ type: 'reconnect', sessionId: '<existing-id>' }`
6. Backend receives reconnect → **Updates chatConnections** with new WebSocket
7. Backend continues streaming → Now sends to **new WebSocket**
8. Frontend receives remaining chunks → Stream completes successfully

## Benefits

1. **Resilient Streaming**: Streams can survive WebSocket reconnections
2. **No Duplicate Sessions**: Frontend reuses existing sessionId
3. **Automatic Recovery**: Reconnection happens transparently
4. **Session Continuity**: Message history preserved across reconnects

## Testing

To test the fix:

1. Start a long-running chat query (e.g., "Analyze all my AWS resources")
2. During streaming, simulate network disruption or close the WebSocket
3. Verify that streaming continues after reconnection
4. Check logs for "Client reconnected with existing session" messages
5. Verify response is complete without mid-sentence cuts

## Monitoring

Look for these log messages:

**Backend:**
- `[WebSocket] Client reconnected with existing session: <sessionId>`
- `[ChatOrchestrator] *** WARNING: WebSocket not open (readyState=X) - waiting for reconnection...`
- `[ChatOrchestrator] *** WebSocket reconnected successfully, continuing stream...`

**Frontend:**
- `[Chat] Sending reconnect message with sessionId: <sessionId>`
- `[Chat] Reconnected with existing session: <sessionId>`
- `[Chat] Connection lost during streaming, attempting reconnect...`

## Files Modified

1. `backend/src/server.ts`
2. `backend/src/services/ChatOrchestrator.ts`
3. `backend/src/services/ServiceFactory.ts`
4. `frontend/src/hooks/useChat.ts`
5. `frontend/src/types/chat.ts`

## Compatibility

- Backward compatible: old clients that don't send reconnect messages still work
- No breaking changes to existing API
- Session management remains unchanged for non-streaming operations
