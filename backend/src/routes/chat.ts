import { Router, Request, Response } from 'express';
import { chatConnections } from '../chatState.js';
import { ServiceFactory } from '../services/ServiceFactory.js';

const router = Router();

/**
 * POST /api/chat/message
 * Send a chat message (HTTP endpoint for backwards compatibility)
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { sessionId, message, profile, region } = req.body;

    if (!sessionId || !message || !profile || !region) {
      return res.status(400).json({
        error: 'sessionId, message, profile, and region are required',
      });
    }

    // Get WebSocket for session
    const ws = chatConnections.get(sessionId);
    if (!ws) {
      return res.status(404).json({
        error: 'WebSocket session not found',
      });
    }

    // Get or create orchestrator with shared ClaudeMCPService
    const orchestrator = ServiceFactory.getChatOrchestrator(profile, region);

    // Handle message asynchronously
    orchestrator
      .handleChatMessage(sessionId, message, ws, profile, region)
      .catch((error) => {
        console.error('[Chat] Error handling message:', error);
      });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Chat] Error in POST /message:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/chat/suggestions
 * Get suggested questions
 */
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const { profile, region } = req.query;

    if (!profile || !region) {
      return res.status(400).json({
        error: 'profile and region are required',
      });
    }

    // Get or create orchestrator with shared ClaudeMCPService
    const orchestrator = ServiceFactory.getChatOrchestrator(profile as string, region as string);

    const suggestions = await orchestrator.getSuggestedQuestions(profile as string, region as string);

    res.json({ suggestions });
  } catch (error: any) {
    console.error('[Chat] Error getting suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/chat/session/:sessionId
 * Clear chat session
 */
router.delete('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { profile, region } = req.query;

    if (!profile || !region) {
      return res.status(400).json({
        error: 'profile and region are required',
      });
    }

    // Get orchestrator and clear session
    const orchestrator = ServiceFactory.getChatOrchestrator(profile as string, region as string);
    orchestrator.clearSession(sessionId);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Chat] Error clearing session:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
