import React, { createContext, useContext, useState, useEffect } from 'react';
import type { AWSAccount, SessionStatus } from '../types';
import { accountsApi, sessionApi } from '../lib/api';

interface AppContextType {
  accounts: AWSAccount[];
  selectedAccount: AWSAccount | null;
  setSelectedAccount: (account: AWSAccount) => void;
  sessionStatus: SessionStatus | null;
  refreshSession: () => Promise<void>;
  isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accounts, setAccounts] = useState<AWSAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AWSAccount | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load accounts on mount
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const data = await accountsApi.getAll();
        setAccounts(data);
        if (data.length > 0) {
          setSelectedAccount(data[0]);
        }
      } catch (error) {
        console.error('Failed to load accounts:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAccounts();
  }, []);

  // Load session status
  useEffect(() => {
    const loadSessionStatus = async () => {
      try {
        const status = await sessionApi.getStatus();
        setSessionStatus(status);
      } catch (error) {
        console.error('Failed to load session status:', error);
      }
    };

    loadSessionStatus();
    // Refresh every 5 minutes
    const interval = setInterval(loadSessionStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const refreshSession = async () => {
    try {
      // Pass the selected account profile, default to 'dev-ah' if not available
      const profile = selectedAccount?.profile || 'dev-ah';
      await sessionApi.refresh(profile);
      // Re-fetch session status to update the banner with new expiry time
      const status = await sessionApi.getStatus();
      setSessionStatus(status);
    } catch (error) {
      console.error('Failed to refresh session:', error);
      throw error;
    }
  };

  return (
    <AppContext.Provider
      value={{
        accounts,
        selectedAccount,
        setSelectedAccount,
        sessionStatus,
        refreshSession,
        isLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};
