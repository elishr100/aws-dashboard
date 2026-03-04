import { MessageCircle } from 'lucide-react';
import { Button } from './ui/Button';

interface ChatButtonProps {
  onClick: () => void;
}

export function ChatButton({ onClick }: ChatButtonProps) {
  return (
    <Button
      onClick={onClick}
      className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow z-40"
      size="sm"
    >
      <MessageCircle className="h-6 w-6" />
    </Button>
  );
}
