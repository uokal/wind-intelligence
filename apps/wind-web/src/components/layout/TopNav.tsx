import { Wind, Database, RefreshCw, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

interface TopNavProps {
  apiConnected: boolean;
  lastRefresh: Date | null;
  onRefresh: () => void;
  loading: boolean;
}

export function TopNav({
  apiConnected,
  lastRefresh,
  onRefresh,
  loading,
}: TopNavProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border shadow-subtle">
      <div className="container">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent">
              <Wind className="icon-md text-white" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-semibold text-heading">
                Wind Intelligence
              </p>
              <p className="text-xs text-text-muted">
                UK Day-Ahead Forecast Analytics
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-light text-accent border border-accent-light">
              <Database className="icon-sm" aria-hidden="true" />
              Elexon BMRS
            </div>

            <div className="flex items-center gap-1.5 text-sm text-text-muted">
              <Info className="icon-sm" aria-hidden="true" />
              <time dateTime={currentTime.toISOString()}>
                {currentTime.toLocaleDateString('en-GB', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </time>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-2 w-2 rounded-full ${apiConnected ? 'bg-success' : 'bg-error'}`}
                aria-hidden="true"
              />
              <span
                role="status"
                className="text-sm font-medium text-text-muted"
              >
                {apiConnected ? 'API Connected' : 'API Disconnected'}
              </span>
            </div>

            {lastRefresh && (
              <div className="hidden md:flex items-center gap-1.5 text-sm text-text-muted">
                <RefreshCw className="icon-sm" aria-hidden="true" />
                <time dateTime={lastRefresh.toISOString()}>
                  {lastRefresh.toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            )}

            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="btn btn-primary gap-2"
              aria-label="Refresh data"
            >
              <RefreshCw
                className={`icon-sm ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
