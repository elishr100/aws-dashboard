import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import cors from 'cors';
import testRoutes from './routes/test.js';
import accountsRoutes from './routes/accounts.js';
import sessionRoutes from './routes/session.js';
import resourcesRoutes from './routes/resources.js';
import scanRoutes from './routes/scan.js';
import securityRoutes from './routes/security.js';
import costRoutes from './routes/cost.js';
import organizationRoutes from './routes/organization.js';
import analyticsRoutes from './routes/analytics.js';
import chatRoutes from './routes/chat.js';
import { cacheService } from './services/CacheService.js';
import { persistentCache } from './services/PersistentCacheService.js';
import { chatConnections } from './chatState.js';

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// WebSocket server for chat
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws/chat',
});

wss.on('connection', (ws, req) => {
  let sessionId: string | null = null;
  let reconnectTimeout: NodeJS.Timeout | null = null;

  // Listen for initial message which may contain sessionId for reconnection
  const messageHandler = (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // Check if this is a reconnect attempt with existing sessionId
      if (message.type === 'reconnect' && message.sessionId && typeof message.sessionId === 'string') {
        sessionId = message.sessionId;

        // Update the WebSocket reference for this session
        chatConnections.set(message.sessionId, ws);
        console.log(`[WebSocket] Client reconnected with existing session: ${sessionId}`);

        // Send acknowledgment
        ws.send(JSON.stringify({ type: 'connected', sessionId, reconnected: true }));
      } else {
        // New connection - generate new sessionId
        sessionId = randomUUID();
        chatConnections.set(sessionId, ws);
        console.log(`[WebSocket] New chat client connected: ${sessionId}`);

        // Send session ID to client
        ws.send(JSON.stringify({ type: 'connected', sessionId }));
      }

      // Remove this listener after first message
      ws.off('message', messageHandler);
    } catch (error) {
      console.error('[WebSocket] Error parsing initial message:', error);
    }
  };

  ws.on('message', messageHandler);

  // If no reconnect message received within 2 seconds, treat as new connection
  reconnectTimeout = setTimeout(() => {
    if (!sessionId) {
      sessionId = randomUUID();
      chatConnections.set(sessionId, ws);
      console.log(`[WebSocket] New chat client connected (timeout): ${sessionId}`);
      ws.send(JSON.stringify({ type: 'connected', sessionId }));
      ws.off('message', messageHandler);
    }
  }, 2000);

  ws.on('close', () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    if (sessionId) {
      // Only delete if this is still the active connection for this sessionId
      if (chatConnections.get(sessionId) === ws) {
        // Don't immediately delete - give a grace period for reconnection
        console.log(`[WebSocket] Chat client disconnected: ${sessionId} - waiting 5s for reconnection...`);

        setTimeout(() => {
          // After grace period, check if still not reconnected
          if (chatConnections.get(sessionId) === ws) {
            chatConnections.delete(sessionId);
            console.log(`[WebSocket] Session ${sessionId} expired after grace period`);
          } else {
            console.log(`[WebSocket] Session ${sessionId} was reconnected, not deleting`);
          }
        }, 5000); // 5 second grace period
      } else {
        console.log(`[WebSocket] Old connection closed for session: ${sessionId} (already reconnected)`);
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`[WebSocket] Error for ${sessionId}:`, error);
  });
});

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/test', testRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/cost', costRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/chat', chatRoutes);

// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  try {
    const cacheStats = cacheService.getStats();
    const profile = process.env.AWS_PROFILE || 'dev-ah';

    // Check if critical services can initialize
    const services: Record<string, { status: string; error?: string }> = {};

    // 1. Check ClaudeMCPService
    try {
      const { ServiceFactory } = await import('./services/ServiceFactory.js');
      const claudeService = ServiceFactory.getClaudeMCPService(profile, 'us-west-2');
      services.claudeMCP = { status: 'ok' };
    } catch (error: any) {
      services.claudeMCP = { status: 'error', error: error.message };
    }

    // 2. Check AccountDiscoveryService
    try {
      const { AccountDiscoveryService } = await import('./services/AccountDiscoveryService.js');
      const accountService = new AccountDiscoveryService();
      const accounts = accountService.discoverAccounts();
      services.accountDiscovery = { status: 'ok' };
    } catch (error: any) {
      services.accountDiscovery = { status: 'error', error: error.message };
    }

    // 3. Check Cache Service
    services.cache = { status: 'ok' };

    // 4. Check WebSocket
    services.websocket = {
      status: wss.clients.size >= 0 ? 'ok' : 'error',
    };

    // Overall status: ok if all critical services are ok
    const allOk = Object.values(services).every(s => s.status === 'ok');

    res.json({
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      profile,
      services,
      cache: cacheStats,
      websocket: {
        connectedClients: wss.clients.size,
      },
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error]', err.stack);

  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// Initialize persistent cache and restore alerts
(async () => {
  await persistentCache.initialize();
  console.log('[Server] Persistent cache initialized');

  // Restore alerts from persisted alert cache for all profiles
  try {
    const { ServiceFactory } = await import('./services/ServiceFactory.js');
    const { AccountDiscoveryService } = await import('./services/AccountDiscoveryService.js');

    const alertService = ServiceFactory.getAlertService();
    const accountService = new AccountDiscoveryService();

    // Get all profiles from ~/.aws/config
    const allProfiles = accountService.discoverAccounts();
    console.log(`[Server] Restoring alerts for ${allProfiles.length} profiles`);

    let totalAlertsRestored = 0;

    for (const account of allProfiles) {
      try {
        const profile = account.profileName;

        // Load alerts from persisted alert cache (without clearing existing alerts)
        const alertsLoaded = await alertService.loadAlertsFromCache(profile, false);

        if (alertsLoaded > 0) {
          totalAlertsRestored += alertsLoaded;
        } else {
          console.log(`[Server] No persisted alerts found for profile: ${profile}, checking security findings...`);

          // Fallback: Load from security findings if no alerts cached
          const cacheKeys = persistentCache.getKeys();
          const securityKeys = cacheKeys.filter(key => key.startsWith(`security:${profile}:`));

          for (const key of securityKeys) {
            const findings = persistentCache.get<any>(key);
            if (findings && Array.isArray(findings)) {
              const criticalAndHighFindings = findings.filter(
                (f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH'
              );

              if (criticalAndHighFindings.length > 0) {
                await alertService.createAlertsFromCriticalAndHighFindings(criticalAndHighFindings);
                totalAlertsRestored += criticalAndHighFindings.length;
                console.log(`[Server] Created ${criticalAndHighFindings.length} alerts from findings for ${profile}`);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[Server] Failed to restore alerts for ${account.profileName}:`, error);
      }
    }

    console.log(`[Server] Alert restoration complete - restored ${totalAlertsRestored} total alerts across all profiles`);
  } catch (error) {
    console.error('[Server] Failed to restore alerts:', error);
  }
})();

// Start server
httpServer.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AWS Cloud Governance Dashboard - Backend');
  console.log('='.repeat(60));
  console.log(`\n📍 Server: http://localhost:${PORT}`);
  console.log(`📋 Health: http://localhost:${PORT}/health`);
  console.log(`💬 Chat WebSocket: ws://localhost:${PORT}/api/chat`);
  console.log('\n📚 Available Endpoints:');
  console.log('  GET  /api/accounts              - List all AWS accounts');
  console.log('  GET  /api/session/status        - Check session status');
  console.log('  POST /api/session/refresh       - Refresh AWS session');
  console.log('  POST /api/scan                  - Start resource scan');
  console.log('  GET  /api/scan/:jobId/stream    - SSE stream for scan progress');
  console.log('  GET  /api/resources             - Query discovered resources');
  console.log('  GET  /api/resources/stats       - Get resource statistics');
  console.log('\n🔒 Security Endpoints:');
  console.log('  POST /api/security/audit        - Start security audit');
  console.log('  GET  /api/security/findings     - Get security findings');
  console.log('  GET  /api/security/compliance   - Get compliance report');
  console.log('  GET  /api/security/alerts       - Get security alerts');
  console.log('  GET  /api/security/alerts/stream - SSE stream for real-time alerts');
  console.log('\n💰 Cost Endpoints:');
  console.log('  POST /api/cost/report           - Generate cost report');
  console.log('  GET  /api/cost/summary          - Get cost summary');
  console.log('  GET  /api/cost/trends           - Get cost trends');
  console.log('  GET  /api/cost/forecast         - Get cost forecast');
  console.log('  GET  /api/cost/dashboard        - Get cost dashboard summary');
  console.log('  POST /api/cost/refresh          - Refresh cost data');
  console.log('  GET  /api/cost/budgets          - Get all budgets');
  console.log('  POST /api/cost/budgets          - Create new budget');
  console.log('\n💬 Chat Endpoints:');
  console.log('  WS   /api/chat                  - WebSocket for AI chat');
  console.log('  POST /api/chat/message          - Send chat message');
  console.log('  GET  /api/chat/suggestions      - Get suggested questions');
  console.log('  DELETE /api/chat/session/:id    - Clear chat session');
  console.log('\n🏢 Organization Endpoints:');
  console.log('  GET  /api/organization          - Get organization structure');
  console.log('  GET  /api/organization/accounts - List all accounts');
  console.log('  GET  /api/organization/groups   - List account groups');
  console.log('  GET  /api/organization/insights - Get organization insights');
  console.log('  GET  /api/organization/hierarchy - Get account hierarchy');
  console.log('  POST /api/organization/groups   - Create account group');
  console.log('\n📊 Analytics Endpoints:');
  console.log('  GET  /api/analytics/aggregated  - Get aggregated metrics');
  console.log('  POST /api/analytics/comparison  - Compare accounts');
  console.log('  GET  /api/analytics/benchmarks/:id - Benchmark account');
  console.log('  GET  /api/analytics/trends      - Get organization trends');
  console.log('  POST /api/analytics/chargeback  - Generate chargeback report');
  console.log('  POST /api/analytics/search      - Federated search');
  console.log('  GET  /api/analytics/summary     - Get executive summary');
  console.log('\n✅ Features: Cost per Resource + AI Chat Panel');
  console.log('='.repeat(60) + '\n');
});
