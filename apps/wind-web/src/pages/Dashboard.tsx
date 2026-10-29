import { useEffect, useState } from 'react';
import { apiGetHealth } from '../services/api';

type HealthStatus = 'loading' | 'connected' | 'unavailable';

export function Dashboard() {
  const [status, setStatus] = useState<HealthStatus>('loading');

  useEffect(() => {
    let mounted = true;
    apiGetHealth()
      .then((res) => {
        if (mounted) setStatus(res.ok ? 'connected' : 'unavailable');
      })
      .catch(() => {
        if (mounted) setStatus('unavailable');
      });
    return () => { mounted = false; };
  }, []);

  const statusConfig = {
    loading: { label: 'Connecting…', class: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
    connected: { label: 'API connected', class: 'text-green-700 bg-green-50 border-green-200' },
    unavailable: { label: 'API unavailable', class: 'text-red-700 bg-red-50 border-red-200' },
  };

  const { label, class: statusClass } = statusConfig[status];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-medium text-gray-800">System Status</h2>
      </div>
      <div className={`inline-flex items-center px-4 py-2 rounded border ${statusClass}`}>
        <span className="mr-2">{status === 'loading' && '⏳'}{status === 'connected' && '✅'}{status === 'unavailable' && '❌'}</span>
        <span>{label}</span>
      </div>
      <div className="mt-8 text-gray-500 text-sm">
        Ready for Elexon integration and analytics implementation.
      </div>
    </div>
  );
}