import { useState, useEffect, useRef } from 'react';
import { X, Send, Trash2, Loader2, StopCircle } from 'lucide-react';
import { Button } from './ui/Button';
import { useChat } from '@/hooks/useChat';
import ReactMarkdown from 'react-markdown';

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const {
    messages,
    isConnected,
    isThinking,
    currentResponse,
    sendMessage,
    cancelRequest,
    clearChat,
    getSuggestions,
  } = useChat();

  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load suggestions on mount
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      getSuggestions().then(setSuggestions);
    }
  }, [isOpen, messages.length, getSuggestions]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  const handleSend = () => {
    if (!input.trim() || !isConnected) return;

    // If currently thinking, cancel the previous request first
    if (isThinking) {
      cancelRequest();
    }

    sendMessage(input);
    setInput('');
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className={`fixed right-0 top-0 h-full w-96 bg-background border-l shadow-2xl transform transition-transform duration-300 ease-in-out z-50 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-lg font-semibold">AI Assistant</h2>
          <p className="text-xs text-muted-foreground">
            {isConnected ? '● Connected' : '○ Disconnected'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            disabled={messages.length === 0}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4"
        style={{ height: 'calc(100vh - 180px)' }}
      >
        {messages.length === 0 && suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Suggested questions:</p>
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(suggestion)}
                className="w-full text-left p-3 text-sm rounded-lg border hover:bg-accent transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              {message.role === 'assistant' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{message.content}</p>
              )}
              <p className="text-xs opacity-50 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {isThinking && !currentResponse && (
          <div className="flex justify-start items-start gap-2">
            <div className="bg-muted rounded-lg p-3 max-w-[80%]">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelRequest}
              className="flex-shrink-0"
              title="Cancel request"
            >
              <StopCircle className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}

        {currentResponse && (
          <div className="flex justify-start items-start gap-2">
            <div className="bg-muted rounded-lg p-3 max-w-[80%]">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{currentResponse}</ReactMarkdown>
              </div>
            </div>
            {/* Show cancel button while streaming */}
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelRequest}
              className="flex-shrink-0"
              title="Cancel request"
            >
              <StopCircle className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-background">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isThinking
                ? 'Type a message and press Enter to cancel current request...'
                : 'Ask about your AWS resources...'
            }
            className="flex-1 resize-none rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            rows={2}
            disabled={!isConnected}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || !isConnected}
            size="sm"
            title={isThinking ? 'Send (will cancel current request)' : 'Send message'}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
