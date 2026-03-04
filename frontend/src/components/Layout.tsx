import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { SessionBanner } from './SessionBanner';
import { AccountSwitcher } from './AccountSwitcher';
import { ChatPanel } from './ChatPanel';
import { ChatButton } from './ChatButton';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex h-16 items-center justify-between border-b px-6">
          <AccountSwitcher />
        </div>

        {/* Session banner */}
        <SessionBanner />

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {/* Chat UI */}
      <ChatButton onClick={() => setIsChatOpen(true)} />
      <ChatPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

      {/* Overlay when chat is open */}
      {isChatOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={() => setIsChatOpen(false)}
        />
      )}
    </div>
  );
}
