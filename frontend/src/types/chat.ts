export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  sessionId: string;
  messages: ChatMessage[];
}

export type ChatMessageType =
  | 'connected'
  | 'thinking'
  | 'token'
  | 'complete'
  | 'tool_call'
  | 'error';

export interface ChatWebSocketMessage {
  type: ChatMessageType;
  sessionId?: string;
  content?: string;
  message?: string;
  toolName?: string;
  toolInput?: unknown;
  index?: number;
  reconnected?: boolean; // Indicates if this is a reconnection with existing session
}
