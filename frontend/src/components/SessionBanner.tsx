import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { Button } from './ui/Button';
import { useState } from 'react';

export function SessionBanner() {
  const { sessionStatus, refreshSession } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false);

  if (!sessionStatus) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshSession();
      // Immediately show success state
      setShowRefreshSuccess(true);
      // Clear success message after 3 seconds
      setTimeout(() => {
        setShowRefreshSuccess(false);
      }, 3000);
    } catch (error) {
      console.error('Failed to refresh session:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Show success message after refresh
  if (showRefreshSuccess) {
    return (
      <div className="flex items-center gap-2 bg-green-500/10 border-l-4 border-green-500 px-4 py-2">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <p className="text-sm text-green-800">
          Session valid - refreshed successfully
        </p>
      </div>
    );
  }

  if (!sessionStatus.valid) {
    return (
      <div className="flex items-center justify-between gap-4 bg-destructive/10 border-l-4 border-destructive px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">
              AWS Session Expired
            </p>
            <p className="text-xs text-muted-foreground">
              Please refresh your credentials to continue
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Refreshing...
            </>
          ) : (
            'Refresh Session'
          )}
        </Button>
      </div>
    );
  }

  const expiresAt = sessionStatus.expiresAt ? new Date(sessionStatus.expiresAt) : null;
  const now = new Date();
  const timeUntilExpiry = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const hoursUntilExpiry = timeUntilExpiry / (1000 * 60 * 60);
  const minutesUntilExpiry = Math.round(hoursUntilExpiry * 60);

  if (hoursUntilExpiry < 1) {
    return (
      <div className="flex items-center justify-between gap-4 bg-yellow-500/10 border-l-4 border-yellow-500 px-4 py-2">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <p className="text-sm text-yellow-800">
            Session expires soon ({minutesUntilExpiry} minutes)
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? (
            <>
              <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
              Refreshing...
            </>
          ) : (
            'Refresh'
          )}
        </Button>
      </div>
    );
  }

  // Normal green state with expiration time
  const hours = Math.floor(hoursUntilExpiry);
  const minutes = Math.round((hoursUntilExpiry - hours) * 60);
  const expiryText = hours > 0
    ? `expires in ${hours}h ${minutes}m`
    : `expires in ${minutes}m`;

  return (
    <div className="flex items-center gap-2 bg-green-500/10 border-l-4 border-green-500 px-4 py-2">
      <CheckCircle className="h-4 w-4 text-green-600" />
      <p className="text-sm text-green-800">
        Session valid ({sessionStatus.profile}) - {expiryText}
      </p>
    </div>
  );
}
