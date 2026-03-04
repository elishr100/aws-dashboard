import { ClaudeMCPService } from './ClaudeMCPService.js';
import { cacheService, CacheService } from './CacheService.js';
import { AlertService } from './AlertService.js';
import type { AWSResource, ResourceInventory } from '../types/index.js';
import type { SecurityAlert } from '../types/security.js';
import type { WebSocket } from 'ws';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  sessionId: string;
  profile: string;
  region: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface ChatContext {
  profile: string;
  region: string;
  resources: AWSResource[];
  alerts: SecurityAlert[];
  totalResources: number;
  resourcesByType: Record<string, number>;
}

export class ChatOrchestrator {
  private claudeService: ClaudeMCPService;
  private sessions: Map<string, ChatSession> = new Map();
  private alertService: AlertService;
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private chatConnections: Map<string, WebSocket>;

  /**
   * Constructor with dependency injection for ClaudeMCPService and chatConnections
   * This ensures a single shared instance with synchronized credentials
   */
  constructor(claudeService: ClaudeMCPService, chatConnections: Map<string, WebSocket>) {
    this.claudeService = claudeService;
    this.alertService = new AlertService();
    this.chatConnections = chatConnections;
    console.log(`[ChatOrchestrator] Initialized with shared ClaudeMCPService instance`);
  }

  /**
   * Build context from current scan data
   */
  private async buildContext(profile: string, region: string): Promise<ChatContext> {
    // Get resources from cache
    const cacheKey = CacheService.resourceKey(profile, region);
    const inventory = cacheService.get<ResourceInventory>(cacheKey);

    const resources = inventory?.resources || [];

    // Get security alerts
    const alerts = this.alertService.getAlerts({
      profile,
      region,
    });

    // Aggregate stats
    const resourcesByType = resources.reduce((acc: Record<string, number>, r: AWSResource) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    }, {});

    return {
      profile,
      region,
      resources,
      alerts,
      totalResources: resources.length,
      resourcesByType,
    };
  }

  /**
   * Handle user chat message and stream response
   * Ensures a response is always sent to the client (success or error)
   */
  async handleChatMessage(
    sessionId: string,
    userMessage: string,
    ws: WebSocket,
    profile: string,
    region: string
  ): Promise<void> {
    console.log(`[ChatOrchestrator] Handling message for session ${sessionId}, profile: ${profile}, region: ${region}`);

    // Get or create session
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        profile,
        region,
        messages: [],
        createdAt: new Date().toISOString(),
      };
      this.sessions.set(sessionId, session);
    }

    // Add user message to history
    session.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    });

    // Wrap entire flow in try/catch with timeout to guarantee a response
    const OVERALL_TIMEOUT_MS = 75000; // 75 seconds (gives Claude 60s + buffer)

    try {
      // Create a promise that will timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Request timed out after 75 seconds. Please try a simpler query or try again.'));
        }, OVERALL_TIMEOUT_MS);
      });

      // Race the main processing against the timeout
      await Promise.race([
        this.processMessage(session, userMessage, ws, profile, region),
        timeoutPromise
      ]);

    } catch (error: any) {
      console.error('[ChatOrchestrator] Error handling message:', error);
      console.error('[ChatOrchestrator] Error stack:', error.stack);

      const errorMessage = error.message || 'Failed to process your question';
      console.error('[ChatOrchestrator] Sending error to client:', errorMessage);

      // Always send an error response to the client
      this.sendWebSocketMessage(sessionId, {
        type: 'error',
        message: errorMessage.includes('timed out')
          ? errorMessage
          : `Error: ${errorMessage}. Please check that your AWS credentials are valid for profile ${profile}.`,
      });
    }
  }

  /**
   * Process the message (extracted for timeout handling)
   */
  private async processMessage(
    session: ChatSession,
    userMessage: string,
    ws: WebSocket,
    profile: string,
    region: string
  ): Promise<void> {
    // Update Claude service profile/region if needed
    if (this.claudeService.getProfile() !== profile) {
      console.log(`[ChatOrchestrator] Updating profile from ${this.claudeService.getProfile()} to ${profile}`);
      this.claudeService.setProfile(profile);
    }

    // Build context
    console.log(`[ChatOrchestrator] Building context for ${profile} in ${region}`);
    const context = await this.buildContext(profile, region);

    // Build enhanced prompt with context
    const systemPrompt = `You are an AWS cloud governance assistant for the AWS Dashboard.

**Current Context:**
- AWS Profile: ${context.profile}
- Region: ${context.region}
- Total Resources: ${context.totalResources}
- Resources by Type: ${JSON.stringify(context.resourcesByType, null, 2)}
- Active Security Alerts: ${context.alerts.length}

**Available Resources:**
${context.resources.slice(0, 20).map(r => `- ${r.type} (${r.id}): ${r.name || 'N/A'}, State: ${r.state || 'N/A'}, Cost: $${r.cost?.currentMonthCost?.toFixed(2) || 'N/A'}`).join('\n')}
${context.resources.length > 20 ? `\n... and ${context.resources.length - 20} more resources` : ''}

**Security Alerts:**
${context.alerts.slice(0, 5).map(a => `- [${a.severity}] ${a.title} (Resource: ${a.resourceId})`).join('\n')}
${context.alerts.length > 5 ? `\n... and ${context.alerts.length - 5} more alerts` : ''}

**Your Capabilities:**
1. Answer questions about the resources and costs shown above
2. Use the call_aws MCP tool to query live AWS data if needed
3. Analyze security alerts and provide recommendations
4. Calculate cost savings for hypothetical scenarios
5. Filter and search resources based on user criteria

**Instructions:**
- Answer concisely and focus on actionable insights
- When using MCP tools, explain what you're doing
- For cost calculations, show your work
- If you need more data, use the AWS CLI via MCP tools
- Format responses in clear, readable markdown

User Question: ${userMessage}`;

    // Send "thinking" indicator
    console.log(`[ChatOrchestrator] Sending thinking indicator`);
    this.sendWebSocketMessage(session.sessionId, {
      type: 'thinking',
      message: 'Processing your question...',
    });

    // Use ClaudeMCPService with streaming (60 second timeout in ClaudeMCPService)
    console.log(`[ChatOrchestrator] Starting Claude response stream`);
    await this.streamClaudeResponse(systemPrompt, session);
    console.log(`[ChatOrchestrator] Claude response completed`);
  }

  /**
   * Stream Claude response with real-time streaming from Bedrock
   * Sends chunks directly as they arrive, with proper error handling
   * Dynamically looks up WebSocket from chatConnections to support reconnection during streaming
   */
  private async streamClaudeResponse(
    prompt: string,
    session: ChatSession
  ): Promise<void> {
    const sessionId = session.sessionId;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let assistantMessage = '';

    try {
      console.log(`[ChatOrchestrator] Starting real-time streaming from Bedrock...`);

      // Start heartbeat to keep connection alive during long operations
      // Send ping every 15 seconds to prevent timeout
      heartbeatInterval = setInterval(() => {
        const ws = this.chatConnections.get(sessionId);
        if (ws && ws.readyState === 1) {
          // 1 = OPEN
          this.sendWebSocketMessage(sessionId, {
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
          });
          console.log(`[ChatOrchestrator] Sent heartbeat for session ${sessionId}`);
        }
      }, 15000); // 15 seconds

      this.heartbeatIntervals.set(sessionId, heartbeatInterval);

      // Stream chunks directly from Bedrock
      let chunkCount = 0;
      let textChunks = 0;
      console.log(`[ChatOrchestrator] *** Starting to consume stream from ClaudeMCPService...`);

      for await (const chunk of this.claudeService.queryStream(prompt)) {
        chunkCount++;

        // Get the current WebSocket (may have been updated due to reconnection)
        const ws = this.chatConnections.get(sessionId);

        // Check WebSocket is still available and open before every send
        if (!ws) {
          console.error(`[ChatOrchestrator] *** CRITICAL: No WebSocket found for session ${sessionId}`);
          throw new Error('WebSocket connection lost during streaming');
        }

        if (ws.readyState !== 1) {
          console.warn(`[ChatOrchestrator] *** WARNING: WebSocket not open (readyState=${ws.readyState}) - waiting for reconnection...`);
          // Wait for potential reconnection (check every 200ms for up to 3 seconds)
          let waitAttempts = 0;
          const maxAttempts = 15; // 15 attempts * 200ms = 3 seconds

          while (waitAttempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 200));
            waitAttempts++;

            const reconnectedWs = this.chatConnections.get(sessionId);
            if (reconnectedWs && reconnectedWs.readyState === 1) {
              console.log(`[ChatOrchestrator] *** WebSocket reconnected successfully after ${waitAttempts * 200}ms, continuing stream...`);
              break;
            }
          }

          // Final check after waiting
          const finalWs = this.chatConnections.get(sessionId);
          if (!finalWs || finalWs.readyState !== 1) {
            console.error(`[ChatOrchestrator] *** CRITICAL: WebSocket still not available after ${maxAttempts * 200}ms`);
            throw new Error('WebSocket connection closed during streaming');
          }
        }

        console.log(`[ChatOrchestrator] *** Chunk #${chunkCount}: type="${chunk.type}"${chunk.content ? `, content length=${chunk.content.length}` : ''}`);

        if (chunk.type === 'text' && chunk.content) {
          // Send text chunk immediately to UI
          textChunks++;
          assistantMessage += chunk.content;
          console.log(`[ChatOrchestrator] *** Text chunk #${textChunks}: "${chunk.content.substring(0, 80)}${chunk.content.length > 80 ? '...' : ''}"`);
          this.sendWebSocketMessage(sessionId, {
            type: 'token',
            content: chunk.content,
          });
        } else if (chunk.type === 'tool_start') {
          console.log(`[ChatOrchestrator] *** Tool STARTED: ${chunk.content}`);
          this.sendWebSocketMessage(sessionId, {
            type: 'tool_start',
            tool: chunk.content,
            message: `Executing ${chunk.content}...`,
          });
        } else if (chunk.type === 'tool_execute') {
          console.log(`[ChatOrchestrator] *** Tool EXECUTING command: ${chunk.content}`);
          this.sendWebSocketMessage(sessionId, {
            type: 'tool_execute',
            command: chunk.content,
          });
        } else if (chunk.type === 'tool_complete') {
          console.log(`[ChatOrchestrator] *** Tool COMPLETED: ${chunk.content}`);
          this.sendWebSocketMessage(sessionId, {
            type: 'tool_complete',
            tool: chunk.content,
          });
        } else if (chunk.type === 'tool_error') {
          console.error(`[ChatOrchestrator] *** Tool ERROR: ${chunk.content}`);
          this.sendWebSocketMessage(sessionId, {
            type: 'tool_error',
            error: chunk.content,
          });
        } else if (chunk.type === 'error') {
          console.error(`[ChatOrchestrator] *** STREAM ERROR: ${chunk.error}`);
          throw new Error(chunk.error || 'Unknown streaming error');
        } else if (chunk.type === 'complete') {
          console.log(`[ChatOrchestrator] *** Stream COMPLETE signal received`);
          break;
        } else {
          console.log(`[ChatOrchestrator] *** Unknown chunk type: ${chunk.type}`);
        }
      }

      console.log(`[ChatOrchestrator] *** Stream consumption finished: ${chunkCount} total chunks, ${textChunks} text chunks`);
      console.log(`[ChatOrchestrator] *** Accumulated message length: ${assistantMessage.length} chars`);

      // Clear heartbeat now that we're done
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        this.heartbeatIntervals.delete(sessionId);
        heartbeatInterval = null;
      }

      console.log(`[ChatOrchestrator] Received complete response, length: ${assistantMessage.length}`);

      if (!assistantMessage || assistantMessage.trim().length === 0) {
        throw new Error('Empty response from Claude API');
      }

      // Send complete message
      this.sendWebSocketMessage(sessionId, {
        type: 'complete',
        content: assistantMessage.trim(),
      });

      // Add to session history
      session.messages.push({
        role: 'assistant',
        content: assistantMessage.trim(),
        timestamp: new Date().toISOString(),
      });

      console.log(`[ChatOrchestrator] Response streaming completed successfully (${chunkCount} chunks)`);
    } catch (error: any) {
      console.error('[ChatOrchestrator] Error in streamClaudeResponse:', error.message);
      console.error('[ChatOrchestrator] Error stack:', error.stack);

      // Clear heartbeat on error
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        this.heartbeatIntervals.delete(sessionId);
      }

      throw error;
    }
  }

  /**
   * Send formatted message via WebSocket
   * Dynamically looks up the WebSocket from chatConnections to support reconnection
   */
  private sendWebSocketMessage(sessionId: string, data: any): void {
    const ws = this.chatConnections.get(sessionId);
    if (ws && ws.readyState === 1) {
      // 1 = OPEN
      ws.send(JSON.stringify(data));
    } else if (ws) {
      console.warn(`[ChatOrchestrator] Cannot send message to session ${sessionId}: WebSocket not open (readyState=${ws.readyState})`);
    } else {
      console.warn(`[ChatOrchestrator] Cannot send message to session ${sessionId}: WebSocket not found`);
    }
  }

  /**
   * Get session history
   */
  getSession(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Clear session and cleanup heartbeat timers
   */
  clearSession(sessionId: string): void {
    // Clear any active heartbeat interval
    const heartbeatInterval = this.heartbeatIntervals.get(sessionId);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      this.heartbeatIntervals.delete(sessionId);
      console.log(`[ChatOrchestrator] Cleared heartbeat for session ${sessionId}`);
    }

    this.sessions.delete(sessionId);
    console.log(`[ChatOrchestrator] Cleared session ${sessionId}`);
  }

  /**
   * Cleanup all heartbeat timers (call on shutdown)
   */
  cleanup(): void {
    console.log(`[ChatOrchestrator] Cleaning up ${this.heartbeatIntervals.size} active heartbeats`);
    for (const [sessionId, interval] of this.heartbeatIntervals.entries()) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();
  }

  /**
   * Get suggested questions based on context
   */
  async getSuggestedQuestions(profile: string, region: string): Promise<string[]> {
    const context = await this.buildContext(profile, region);

    const suggestions = [
      'What are my most expensive resources this month?',
      'Show me all security alerts',
      'Which EC2 instances are stopped?',
      'What resources are missing tags?',
    ];

    // Add context-specific suggestions
    if (context.alerts.length > 0) {
      suggestions.unshift('What are the critical security issues I should fix first?');
    }

    if (context.resources.some((r) => r.cost && r.cost.currentMonthCost > 100)) {
      suggestions.push('How can I reduce my AWS costs?');
    }

    return suggestions.slice(0, 5);
  }
}
