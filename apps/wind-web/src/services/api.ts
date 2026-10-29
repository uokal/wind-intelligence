const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function apiGetHealth(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/health`, {
    headers: { Accept: 'application/json' },
  });
  return { ok: res.ok };
}