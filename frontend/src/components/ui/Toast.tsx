import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToastProps {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'info';
  duration?: number;
  onClose: (id: string) => void;
}

export function Toast({
  id,
  title,
  description,
  variant = 'default',
  duration = 5000,
  onClose,
}: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose(id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, id, onClose]);

  const icons = {
    default: Info,
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
  };

  const Icon = icons[variant];

  return (
    <div
      className={cn(
        'pointer-events-auto w-full max-w-sm rounded-lg border shadow-lg',
        variant === 'success' && 'border-green-200 bg-green-50',
        variant === 'error' && 'border-red-200 bg-red-50',
        variant === 'info' && 'border-blue-200 bg-blue-50',
        variant === 'default' && 'border-gray-200 bg-white'
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <Icon
          className={cn(
            'h-5 w-5 flex-shrink-0',
            variant === 'success' && 'text-green-600',
            variant === 'error' && 'text-red-600',
            variant === 'info' && 'text-blue-600',
            variant === 'default' && 'text-gray-600'
          )}
        />
        <div className="flex-1">
          <p
            className={cn(
              'text-sm font-medium',
              variant === 'success' && 'text-green-900',
              variant === 'error' && 'text-red-900',
              variant === 'info' && 'text-blue-900',
              variant === 'default' && 'text-gray-900'
            )}
          >
            {title}
          </p>
          {description && (
            <p
              className={cn(
                'mt-1 text-sm',
                variant === 'success' && 'text-green-700',
                variant === 'error' && 'text-red-700',
                variant === 'info' && 'text-blue-700',
                variant === 'default' && 'text-gray-600'
              )}
            >
              {description}
            </p>
          )}
        </div>
        <button
          onClick={() => onClose(id)}
          className={cn(
            'flex-shrink-0 rounded-md p-1 hover:bg-gray-100',
            variant === 'success' && 'text-green-500 hover:bg-green-100',
            variant === 'error' && 'text-red-500 hover:bg-red-100',
            variant === 'info' && 'text-blue-500 hover:bg-blue-100'
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
