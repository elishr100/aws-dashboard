import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';

export function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccount } = useApp();
  const [open, setOpen] = useState(false);

  if (!selectedAccount) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
        Loading accounts...
      </div>
    );
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-[300px] justify-between"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{selectedAccount.profile}</span>
          <span className="text-muted-foreground">({selectedAccount.region})</span>
        </div>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-full z-50 mt-1 w-[300px] rounded-md border bg-popover p-1 shadow-md">
            <div className="max-h-[300px] overflow-auto">
              {accounts.map((account) => (
                <button
                  key={`${account.profile}-${account.region}`}
                  onClick={() => {
                    setSelectedAccount(account);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                    selectedAccount.profile === account.profile &&
                      selectedAccount.region === account.region &&
                      'bg-accent'
                  )}
                >
                  <Check
                    className={cn(
                      'h-4 w-4',
                      selectedAccount.profile === account.profile &&
                        selectedAccount.region === account.region
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  <div className="flex flex-1 items-center justify-between">
                    <span>{account.profile}</span>
                    <span className="text-muted-foreground text-xs">
                      {account.region}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
