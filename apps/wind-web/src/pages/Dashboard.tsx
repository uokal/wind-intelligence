import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';
import { api, createApiParams, validateDateRange } from '../services/api';
import type { AnalyticsParams, AnalyticsResponse, TimeSeriesResponse, DayAheadForecastsResponse, CoverageResponse } from '../types/api';
import {
  formatNumber,
  formatPercentage,
  formatDateTime,
  formatDate,
  formatTime,
  getSelectionStatusLabel,
  getSelectionStatusColor,
  getErrorColor,
  getBiasLabel,
} from '../utils/format';

type LoadingState = 'idle' | 'loading' | 'success' | 'error';

interface DashboardData {
  accuracy: AnalyticsResponse | null;
  timeSeries: TimeSeriesResponse | null;
  dayAhead: DayAheadForecastsResponse | null;
  coverage: CoverageResponse | null;
}

const DEFAULT_CUTOFF_HOUR = 12;
const DEFAULT_CUTOFF_MINUTE = 0;
const DEFAULT_TIMEZONE = 'Europe/London';

export function Dashboard() {
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState('2026-01-31');
  const [cutoffHour, setCutoffHour] = useState(DEFAULT_CUTOFF_HOUR);
  const [cutoffMinute, setCutoffMinute] = useState(DEFAULT_CUTOFF_MINUTE);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [data, setData] = useState<DashboardData>({
    accuracy: null,
    timeSeries: null,
    dayAhead: null,
    coverage: null,
  });

  const [loadingStates, setLoadingStates] = useState<Record<string, LoadingState>>({
    accuracy: 'idle',
    timeSeries: 'idle',
    dayAhead: 'idle',
    coverage: 'idle',
  });

  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  const getParams = useCallback((): AnalyticsParams => {
    return createApiParams(dateFrom, dateTo, cutoffHour, cutoffMinute, timezone);
  }, [dateFrom, dateTo, cutoffHour, cutoffMinute, timezone]);

  const fetchAll = useCallback(async () => {
    const validationError = validateDateRange(dateFrom, dateTo);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    const params = getParams();
    const controllers: Record<string, AbortController> = {};
    const keys = ['accuracy', 'timeSeries', 'dayAhead', 'coverage'] as const;

    keys.forEach((key) => {
      controllers[key] = new AbortController();
      setLoadingStates((prev) => ({ ...prev, [key]: 'loading' }));
    });

    abortControllersRef.current = controllers;

    try {
      const [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes] = await Promise.allSettled([
        api.getAccuracy(params, { signal: controllers.accuracy.signal }),
        api.getTimeSeries(params, { signal: controllers.timeSeries.signal }),
        api.getDayAheadForecasts(params, { signal: controllers.dayAhead.signal }),
        api.getCoverage({ date_from: dateFrom, date_to: dateTo }, { signal: controllers.coverage.signal }),
      ]);

      const newData: DashboardData = {
        accuracy: accuracyRes.status === 'fulfilled' ? accuracyRes.value : null,
        timeSeries: timeSeriesRes.status === 'fulfilled' ? timeSeriesRes.value : null,
        dayAhead: dayAheadRes.status === 'fulfilled' ? dayAheadRes.value : null,
        coverage: coverageRes.status === 'fulfilled' ? coverageRes.value : null,
      };

      setData(newData);
      setLastRefresh(new Date());

      const errors = keys
        .filter((key) => {
          const res = [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes][keys.indexOf(key)];
          return res.status === 'rejected';
        })
        .map((key) => {
          const res = [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes][keys.indexOf(key)];
          return res.status === 'rejected' ? `${key}: ${res.reason.message}` : '';
        })
        .filter(Boolean);

      if (errors.length > 0) {
        setError(`Some requests failed: ${errors.join('; ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      keys.forEach((key) => {
        setLoadingStates((prev) => ({ ...prev, [key]: 'success' }));
      });
    }
  }, [dateFrom, dateTo, cutoffHour, cutoffMinute, timezone, getParams]);

  const handleRefresh = useCallback(() => {
    fetchAll();
  }, [fetchAll]);

  const handleFilterChange = useCallback(() => {
    const validationError = validateDateRange(dateFrom, dateTo);
    if (!validationError) {
      fetchAll();
    }
  }, [dateFrom, dateTo, fetchAll]);

  useEffect(() => {
    fetchAll();
    return () => {
      Object.values(abortControllersRef.current).forEach((c) => c.abort());
    };
  }, [fetchAll]);

  // Derived data for charts
  const chartData = selectedDay && data.timeSeries
    ? data.timeSeries.records.filter((r) => r.settlement_date === selectedDay)
    : data.timeSeries?.records ?? [];

  const dayAheadForDay = selectedDay && data.dayAhead
    ? data.dayAhead.records.filter((r) => r.settlement_date === selectedDay)
    : data.dayAhead?.records ?? [];

  const availableDays = data.timeSeries
    ? [...new Set(data.timeSeries.records.map((r) => r.settlement_date))].sort()
    : [];

  const kpiData = data.accuracy;
  const accuracy = kpiData?.accuracy_metrics;
  const directional = kpiData?.directional_metrics;
  const distribution = kpiData?.distribution_metrics;
  const coverage = kpiData?.coverage_metrics;
  const insights = kpiData?.business_insights;
  const methodology = kpiData?.methodology;
  const cutoffConfig = kpiData?.cutoff_config;
  const provenance = kpiData?.dataset_provenance;

  const isLoading = Object.values(loadingStates).some((s) => s === 'loading');
  const hasData = !!data.accuracy || !!data.timeSeries;

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <section className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Wind Intelligence</h1>
            <p className="text-gray-600 mt-1">Day-Ahead Wind Generation Analytics</p>
          </div>
          <div className="text-sm text-gray-500 flex flex-wrap gap-4">
            <span>Data source: <span className="font-medium">Elexon BMRS</span></span>
            <span>Timezone: <span className="font-medium">Europe/London</span></span>
            {lastRefresh && (
              <span>Last refresh: <span className="font-medium">{formatDateTime(lastRefresh.toISOString())}</span></span>
            )}
          </div>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col md:flex-row gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="dateFrom" className="block text-sm font-medium text-gray-700 mb-1">
              Start date
            </label>
            <input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="dateTo" className="block text-sm font-medium text-gray-700 mb-1">
              End date
            </label>
            <input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="cutoffHour" className="block text-sm font-medium text-gray-700 mb-1">
              Cutoff hour (0-23)
            </label>
            <input
              id="cutoffHour"
              type="number"
              min="0"
              max="23"
              value={cutoffHour}
              onChange={(e) => setCutoffHour(parseInt(e.target.value, 10) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="cutoffMinute" className="block text-sm font-medium text-gray-700 mb-1">
              Cutoff minute (0-59)
            </label>
            <input
              id="cutoffMinute"
              type="number"
              min="0"
              max="59"
              value={cutoffMinute}
              onChange={(e) => setCutoffMinute(parseInt(e.target.value, 10) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-1">
              Timezone
            </label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="Europe/London">Europe/London</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading…' : 'Refresh Data'}
            </button>
            <button
              type="button"
              onClick={handleFilterChange}
              disabled={isLoading}
              className="px-4 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              Apply Filters
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm" role="alert">
            {error}
          </div>
        )}
      </section>

      {/* KPI Cards */}
      <section aria-labelledby="kpi-heading" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <h2 id="kpi-heading" className="sr-only">Key Performance Indicators</h2>
        <KPICard
          title="Mean Absolute Error (MAE)"
          value={accuracy?.mae_mw}
          unit="MW"
          description="Average magnitude of forecast error"
          loading={loadingStates.accuracy === 'loading'}
        />
        <KPICard
          title="Root Mean Squared Error (RMSE)"
          value={accuracy?.rmse_mw}
          unit="MW"
          description="Penalizes large errors more heavily"
          loading={loadingStates.accuracy === 'loading'}
        />
        <KPICard
          title="Mean Forecast Bias"
          value={accuracy?.mean_error_mw}
          unit="MW"
          description={getBiasLabel(accuracy?.mean_error_mw ?? 0).label}
          valueColor={getBiasLabel(accuracy?.mean_error_mw ?? 0).color}
          loading={loadingStates.accuracy === 'loading'}
        />
        <KPICard
          title="Evaluation Coverage"
          value={coverage?.evaluation_coverage_pct}
          unit="%"
          description="Intervals with both forecast and actual"
          loading={loadingStates.coverage === 'loading'}
        />
      </section>

      {/* Optional MAPE card */}
      {accuracy && accuracy.mape_percent !== null && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KPICard
            title="Mean Absolute Percentage Error (MAPE)"
            value={accuracy.mape_percent}
            unit="%"
            description={`Excludes ${accuracy.mape_excluded_count} intervals with actual ≤ 1 MW`}
            loading={loadingStates.accuracy === 'loading'}
          />
        </section>
      )}

      {/* Chart Section */}
      <section className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Forecast vs Actual Generation</h2>
          {availableDays.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="selectedDay" className="text-sm font-medium text-gray-700">
                View day:
              </label>
              <select
                id="selectedDay"
                value={selectedDay || ''}
                onChange={(e) => setSelectedDay(e.target.value || null)}
                className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[180px]"
              >
                <option value="">All days ({chartData.length} intervals)</option>
                {availableDays.map((day) => (
                  <option key={day} value={day}>
                    {formatDate(day)} ({dayAheadForDay.filter((d) => d.settlement_date === day).length} intervals)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loadingStates.timeSeries === 'loading' ? (
          <ChartSkeleton height={400} />
        ) : chartData.length === 0 ? (
          <EmptyState message="No time-series data available for the selected range." />
        ) : (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="delivery_start_utc"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(value) => formatTime(value)}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#d1d5db' }}
                  tickLine={{ stroke: '#d1d5db' }}
                />
                <YAxis
                  tickFormatter={(value) => `${formatNumber(value)} MW`}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#d1d5db' }}
                  tickLine={{ stroke: '#d1d5db' }}
                />
<Tooltip
                  formatter={(value, name) => [typeof value === 'number' ? formatNumber(value) : '—', name]}
                  labelFormatter={(value) => (value ? formatDateTime(String(value)) : '')}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="forecast_generation_mw"
                  name="Forecast (MW)"
                  stroke="#0d9488"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual_generation_mw"
                  name="Actual (MW)"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="mt-4 text-sm text-gray-600">
          <strong>Error convention:</strong> Error = Forecast − Actual. Positive = overestimation (forecast {' > '} actual), Negative = underestimation.
          Gaps indicate missing actual or forecast data.
        </p>
      </section>

      {/* Forecast Error Visualization */}
      <section className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Forecast Error (MW)</h2>
        {loadingStates.timeSeries === 'loading' ? (
          <ChartSkeleton height={300} />
        ) : chartData.length === 0 ? (
          <EmptyState message="No error data available." />
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="delivery_start_utc"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(value) => formatTime(value)}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#d1d5db' }}
                  tickLine={{ stroke: '#d1d5db' }}
                />
                <YAxis
                  tickFormatter={(value) => `${formatNumber(value)} MW`}
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#d1d5db' }}
                  tickLine={{ stroke: '#d1d5db' }}
                />
<Tooltip
                  formatter={(value, name) => [typeof value === 'number' ? formatNumber(value) : '—', name]}
                  labelFormatter={(value) => (value ? formatDateTime(String(value)) : '')}
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                  }}
                />
                <Legend />
                <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
                <Bar
                  dataKey="error_mw"
                  name="Error (MW)"
                  radius={[4, 4, 0, 0]}
                >
                  {chartData.map((entry, index) => (
                    <Bar
                      key={index}
                      fill={entry.error_mw === null ? '#9ca3af' : entry.error_mw > 0 ? '#ef4444' : '#3b82f6'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
<p className="mt-4 text-sm text-gray-600">
           Red bars = overestimation (forecast {' > '} actual), Blue bars = underestimation (forecast {' < '} actual), Gray = missing data.
           Zero line indicates perfect forecast.
         </p>
      </section>

      {/* Accuracy Analysis Section */}
      {kpiData && accuracy && directional && distribution && coverage && (
        <section className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Accuracy Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <MetricDetail
              label="MAE"
              value={formatNumber(accuracy.mae_mw)}
              unit="MW"
              description="Mean Absolute Error — average absolute forecast error"
            />
            <MetricDetail
              label="RMSE"
              value={formatNumber(accuracy.rmse_mw)}
              unit="MW"
              description="Root Mean Squared Error — penalizes large errors"
            />
            <MetricDetail
              label="Mean Error (Bias)"
              value={formatNumber(accuracy.mean_error_mw)}
              unit="MW"
              description={`Systematic tendency: ${getBiasLabel(accuracy.mean_error_mw).label}`}
              valueColor={getBiasLabel(accuracy.mean_error_mw).color}
            />
            {accuracy.mape_percent !== null && (
              <MetricDetail
                label="MAPE"
                value={formatPercentage(accuracy.mape_percent)}
                unit=""
                description={`Excludes ${accuracy.mape_excluded_count} intervals with actual ≤ 1 MW`}
              />
            )}
            <MetricDetail
              label="Overestimation Frequency"
              value={formatPercentage(directional.overestimation_frequency_pct)}
              unit=""
              description={`Over: ${directional.overestimation_count} intervals`}
            />
            <MetricDetail
              label="Underestimation Frequency"
              value={formatPercentage(directional.underestimation_frequency_pct)}
              unit=""
              description={`Under: ${directional.underestimation_count} intervals`}
            />
            <MetricDetail
              label="Max Absolute Error"
              value={formatNumber(distribution.max_absolute_error_mw)}
              unit="MW"
              description="Largest single forecast error"
            />
            <MetricDetail
              label="P90 Absolute Error"
              value={formatNumber(distribution.p90_absolute_error_mw)}
              unit="MW"
              description="90th percentile of absolute errors"
            />
            <MetricDetail
              label="Evaluated Intervals"
              value={formatNumber(coverage.matched_intervals)}
              unit=""
              description={`of ${coverage.total_evaluated_intervals} total`}
            />
            <MetricDetail
              label="Missing Forecast"
              value={formatNumber(coverage.missing_forecast_intervals)}
              unit=""
              description="Intervals with no eligible forecast"
            />
            <MetricDetail
              label="Missing Actual"
              value={formatNumber(coverage.missing_actual_intervals)}
              unit=""
              description="Intervals with no actual generation"
            />
          </div>

          {/* Business Insights */}
          {insights && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-2">Key Finding</h3>
              <p className="text-gray-700 mb-4">{insights.key_finding}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-900">Systematic bias:</span>{' '}
                  <span className={insights.bias_direction === 'positive' ? 'text-red-600' : insights.bias_direction === 'negative' ? 'text-blue-600' : 'text-green-600'}>
                    {insights.systematic_bias} ({formatNumber(insights.bias_magnitude_mw)} MW)
                  </span>
                </div>
                <div>
                  <span className="font-medium text-gray-900">Higher error periods:</span>{' '}
                  <span className="text-gray-700">{insights.higher_error_periods.join(', ') || 'None identified'}</span>
                </div>
              </div>
              <div className="mt-4">
                <h4 className="font-medium text-gray-900 mb-2">Caveats</h4>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                  {insights.caveats.map((caveat, i) => (
                    <li key={i}>{caveat}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Decision-Time Forecast Transparency */}
      {data.dayAhead && dayAheadForDay.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Decision-Time Forecast Transparency</h2>
          <p className="text-sm text-gray-600 mb-4">
            Forecasts selected for each delivery interval based on the latest eligible publication before the
            procurement cutoff ({cutoffConfig?.hour?.toString().padStart(2, '0')}:{cutoffConfig?.minute?.toString().padStart(2, '0')} {cutoffConfig?.timezone} on D-1).
            Forecasts published after the cutoff are excluded (look-ahead bias prevention).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left p-2 font-medium text-gray-700">Delivery</th>
                  <th className="text-left p-2 font-medium text-gray-700">Decision Cutoff</th>
                  <th className="text-left p-2 font-medium text-gray-700">Forecast (MW)</th>
                  <th className="text-left p-2 font-medium text-gray-700">Published</th>
                  <th className="text-left p-2 font-medium text-gray-700">Age (hrs)</th>
                  <th className="text-left p-2 font-medium text-gray-700">Actual (MW)</th>
                  <th className="text-left p-2 font-medium text-gray-700">Error (MW)</th>
                  <th className="text-left p-2 font-medium text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {dayAheadForDay.map((record, idx) => {
                  const aligned = data.timeSeries?.records.find(
                    (r) => r.settlement_date === record.settlement_date && r.settlement_period === record.settlement_period
                  );
                  const actualMw = aligned?.actual_generation_mw ?? null;
                  const errorMw = aligned?.error_mw ?? null;
                  return (
                    <tr key={`${record.settlement_date}-${record.settlement_period}`} className={idx % 2 === 0 ? 'bg-gray-50' : ''}>
                      <td className="p-2 border-b border-gray-100">
                        {formatDate(record.settlement_date)} SP{record.settlement_period}
                      </td>
                      <td className="p-2 border-b border-gray-100">{formatDateTime(record.decision_cutoff_utc)}</td>
                      <td className="p-2 border-b border-gray-100 font-mono">{formatNumber(record.forecast_generation_mw)}</td>
                      <td className="p-2 border-b border-gray-100">{formatDateTime(record.forecast_publish_time_utc)}</td>
                      <td className="p-2 border-b border-gray-100 font-mono">{formatNumber(record.forecast_age_hours, 1)}</td>
                      <td className="p-2 border-b border-gray-100 font-mono">{actualMw !== null ? formatNumber(actualMw) : '—'}</td>
                      <td className="p-2 border-b border-gray-100 font-mono">
                        <span className={getErrorColor(errorMw)}>{errorMw !== null ? formatNumber(errorMw) : '—'}</span>
                      </td>
                      <td className="p-2 border-b border-gray-100">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${getSelectionStatusColor(record.selection_status)}`}>
                          {getSelectionStatusLabel(record.selection_status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Data Quality Panel */}
      {data.coverage && (
        <section className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Data Quality & Provenance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <DataQualityCard label="Expected Intervals" value={formatNumber(data.coverage.expected_intervals)} />
            <DataQualityCard label="Actual Intervals" value={formatNumber(data.coverage.actual_intervals)} />
            <DataQualityCard label="Forecast Intervals" value={formatNumber(data.coverage.forecast_intervals)} />
            <DataQualityCard label="Forecast Versions" value={formatNumber(data.coverage.forecast_versions)} />
            <DataQualityCard label="Actual Coverage" value={formatPercentage(data.coverage.actual_coverage_pct)} />
            <DataQualityCard label="Forecast Coverage" value={formatPercentage(data.coverage.forecast_coverage_pct)} />
            <DataQualityCard label="Missing Actual" value={formatNumber(data.coverage.missing_actual_intervals)} />
            <DataQualityCard label="Missing Forecast" value={formatNumber(data.coverage.missing_forecast_intervals)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-2">Methodology</h3>
              <ul className="list-disc list-inside text-gray-600 space-y-1">
                {methodology && Object.entries(methodology).map(([key, value]) => (
                  <li key={key}><span className="font-medium">{key}:</span> {value}</li>
                ))}
              </ul>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-2">Dataset Provenance</h3>
              <ul className="list-disc list-inside text-gray-600 space-y-1">
                {provenance && Object.entries(provenance).map(([key, value]) => (
                  <li key={key}><span className="font-medium">{key}:</span> {value}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-800 text-sm">
            <strong>Note:</strong> This analysis uses historical Elexon BMRS data (FUELHH actuals, WINDFOR forecasts).
            Data is not live; it represents the January 2026 proxy period. Coverage percentages reflect data availability in the Elexon archive.
          </div>
        </section>
      )}

      {!hasData && !isLoading && (
        <EmptyState
          message="No data available. Check your date range and ensure the API is accessible."
          action={{ label: 'Retry', onClick: handleRefresh }}
        />
      )}
    </div>
  );
}

function KPICard({
  title,
  value,
  unit,
  description,
  loading = false,
  valueColor,
}: {
  title: string;
  value: number | null | undefined;
  unit: string;
  description: string;
  loading?: boolean;
  valueColor?: string;
}) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4 md:p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
        <div className="h-8 bg-gray-200 rounded w-1/2 mb-1"></div>
        <div className="h-3 bg-gray-200 rounded w-2/3"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 md:p-6">
      <h3 className="text-sm font-medium text-gray-600 mb-1">{title}</h3>
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`text-3xl font-bold ${valueColor || 'text-gray-900'}`}>{value !== null && value !== undefined ? formatNumber(value) : '—'}</span>
        <span className="text-gray-500 text-lg">{unit}</span>
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  );
}

function MetricDetail({
  label,
  value,
  unit,
  description,
  valueColor,
}: {
  label: string;
  value: string;
  unit: string;
  description: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`text-2xl font-bold ${valueColor || 'text-gray-900'}`}>{value}</span>
        <span className="text-gray-500">{unit}</span>
      </div>
      <p className="text-xs text-gray-500">{description}</p>
    </div>
  );
}

function DataQualityCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 text-center">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div className="animate-pulse h-[{height}px] bg-gray-100 rounded-lg" style={{ height }} />
  );
}

function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <h3 className="mt-2 text-sm font-medium text-gray-900">No data</h3>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default Dashboard;