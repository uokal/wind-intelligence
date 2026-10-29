import type {
  DayAheadForecastsResponse,
  TimeSeriesResponse,
  AnalyticsResponse,
  CoverageResponse,
  AnalyticsParams,
} from '../types/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

type RequestOptions = {
  signal?: AbortSignal;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      searchParams.append(key, String(value));
    }
  });
  return searchParams.toString();
}

async function fetchJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorText || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getDayAheadForecasts(params: AnalyticsParams, options?: RequestOptions): Promise<DayAheadForecastsResponse> {
    const query = buildQuery({
      from: params.date_from,
      to: params.date_to,
      cutoff_hour: params.cutoff_hour,
      cutoff_minute: params.cutoff_minute,
      timezone: params.timezone,
    });
    return fetchJson<DayAheadForecastsResponse>(`/api/analytics/day-ahead?${query}`, options);
  },

  getTimeSeries(params: AnalyticsParams, options?: RequestOptions): Promise<TimeSeriesResponse> {
    const query = buildQuery({
      from: params.date_from,
      to: params.date_to,
      cutoff_hour: params.cutoff_hour,
      cutoff_minute: params.cutoff_minute,
      timezone: params.timezone,
    });
    return fetchJson<TimeSeriesResponse>(`/api/analytics/timeseries?${query}`, options);
  },

  getAccuracy(params: AnalyticsParams, options?: RequestOptions): Promise<AnalyticsResponse> {
    const query = buildQuery({
      from: params.date_from,
      to: params.date_to,
      cutoff_hour: params.cutoff_hour,
      cutoff_minute: params.cutoff_minute,
      timezone: params.timezone,
    });
    return fetchJson<AnalyticsResponse>(`/api/analytics/accuracy?${query}`, options);
  },

  getCoverage(params: { date_from: string; date_to: string }, options?: RequestOptions): Promise<CoverageResponse> {
    const query = buildQuery({
      from: params.date_from,
      to: params.date_to,
    });
    return fetchJson<CoverageResponse>(`/api/wind/coverage?${query}`, options);
  },

  getHealth(options?: RequestOptions): Promise<{ ok: boolean }> {
    return fetchJson<{ ok: boolean }>(`/api/health`, options);
  },
};

export function createApiParams(
  dateFrom: string,
  dateTo: string,
  cutoffHour: number,
  cutoffMinute: number,
  timezone: string
): AnalyticsParams {
  return {
    date_from: dateFrom,
    date_to: dateTo,
    cutoff_hour: cutoffHour,
    cutoff_minute: cutoffMinute,
    timezone,
  };
}

export function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getDefaultDateRange(): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
  };
}

export function validateDateRange(dateFrom: string, dateTo: string): string | null {
  if (!dateFrom || !dateTo) return 'Both start and end dates are required';
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 'Invalid date format';
  if (from > to) return 'Start date must be before or equal to end date';
  return null;
}