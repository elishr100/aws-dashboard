import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import type { ChatMessage, ChatWebSocketMessage } from '@/types/chat';

export function useChat() {
  const { selectedAccount } = useApp();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false); // Track if actively streaming
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Connect to WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = 3001; // Backend port
    const wsUrl = `${protocol}//${host}:${port}/ws/chat`;

    let ws: WebSocket;
    let currentSessionId: string | null = sessionId;

    const connectWebSocket = () => {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Chat] WebSocket connected');
        setIsConnected(true);

        // If we have an existing sessionId, send it to backend for reconnection
        if (currentSessionId) {
          console.log('[Chat] Sending reconnect message with sessionId:', currentSessionId);
          ws.send(JSON.stringify({ type: 'reconnect', sessionId: currentSessionId }));
        }
      };

      ws.onmessage = (event) => {
        const data: ChatWebSocketMessage = JSON.parse(event.data);

        switch (data.type) {
          case 'connected':
            currentSessionId = data.sessionId || null;
            setSessionId(data.sessionId || null);
            if (data.reconnected) {
              console.log('[Chat] Reconnected with existing session:', data.sessionId);
            } else {
              console.log('[Chat] New session created:', data.sessionId);
            }
            break;

          case 'thinking':
            isStreamingRef.current = true; // Mark as streaming
            setIsThinking(true);
            setCurrentResponse('');
            // Start 90 second timeout (backend has 60s + 15s buffer)
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
              console.warn('[Chat] Request timed out after 90 seconds');
              isStreamingRef.current = false; // Clear streaming flag
              // Ensure all state is cleared on timeout
              setIsThinking(false);
              setCurrentResponse('');
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: 'Request timed out. Please try again.',
                  timestamp: new Date().toISOString(),
                },
              ]);
            }, 90000); // 90 seconds
            break;

          case 'token':
            isStreamingRef.current = true; // Ensure streaming flag is set
            // Clear timeout on first token received
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            // Hide thinking indicator as soon as we start receiving tokens
            setIsThinking(false);
            setCurrentResponse((prev) => prev + (data.content || ''));
            break;

          case 'complete': {
            isStreamingRef.current = false; // Clear streaming flag
            // Clear timeout
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            // Ensure thinking state is cleared
            setIsThinking(false);
            // Use the content from the message
            const finalContent = data.content || '';
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: finalContent,
                timestamp: new Date().toISOString(),
              },
            ]);
            // Clear current response after adding to messages
            setCurrentResponse('');
            break;
          }

          case 'tool_call':
            // Show tool call indicator
            console.log('[Chat] Tool call:', data.toolName, data.toolInput);
            break;

          case 'error':
            isStreamingRef.current = false; // Clear streaming flag
            // Clear timeout
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            // Ensure thinking state is cleared
            setIsThinking(false);
            // Clear any partial response
            setCurrentResponse('');
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: `Error: ${data.message}`,
                timestamp: new Date().toISOString(),
              },
            ]);
            break;
        }
      };

      ws.onerror = (error) => {
        console.error('[Chat] WebSocket error:', error);
        setIsConnected(false);
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
          }, 1000); // Reconnect after 1 second
        }
      };
    };

    connectWebSocket();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      isStreamingRef.current = false; // Prevent reconnection on unmount
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []); // Empty dependencies - only connect once

  // Cancel current request
  const cancelRequest = useCallback(() => {
    console.log('[Chat] Cancelling request');

    // Clear streaming flag
    isStreamingRef.current = false;

    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Abort fetch if in progress (stops the HTTP POST if it hasn't completed)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Immediately clear all state to restore UI
    setIsThinking(false);
    setCurrentResponse('');

    // Add cancellation message to chat
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: 'Request cancelled.',
        timestamp: new Date().toISOString(),
      },
    ]);

    console.log('[Chat] Request cancelled, UI restored');
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId || !selectedAccount) return;

      // Add user message immediately
      const userMessage: ChatMessage = {
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      // Send via HTTP (WebSocket listens for responses)
      try {
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: content,
            profile: selectedAccount.profile,
            region: selectedAccount.region,
          }),
          signal: abortControllerRef.current.signal,
        });
      } catch (error) {
        // Don't show error if request was aborted (cancelled)
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('[Chat] Request was cancelled');
          return;
        }

        console.error('[Chat] Failed to send message:', error);
        // Clear timeout on error
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        // Ensure all state is cleared on error
        setIsThinking(false);
        setCurrentResponse('');
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Failed to send message. Please try again.',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    },
    [sessionId, selectedAccount]
  );

  // Clear chat
  const clearChat = useCallback(async () => {
    if (!sessionId || !selectedAccount) return;

    try {
      await fetch(
        `/api/chat/session/${sessionId}?profile=${selectedAccount.profile}&region=${selectedAccount.region}`,
        {
          method: 'DELETE',
        }
      );
      setMessages([]);
    } catch (error) {
      console.error('[Chat] Failed to clear chat:', error);
    }
  }, [sessionId, selectedAccount]);

  // Get suggestions
  const getSuggestions = useCallback(async (): Promise<string[]> => {
    if (!selectedAccount) return [];

    try {
      const response = await fetch(
        `/api/chat/suggestions?profile=${selectedAccount.profile}&region=${selectedAccount.region}`
      );
      const data = await response.json();
      return data.suggestions || [];
    } catch (error) {
      console.error('[Chat] Failed to get suggestions:', error);
      return [];
    }
  }, [selectedAccount]);

  return {
    messages,
    isConnected,
    isThinking,
    currentResponse,
    sendMessage,
    cancelRequest,
    clearChat,
    getSuggestions,
  };
}
