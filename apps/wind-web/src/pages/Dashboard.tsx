import { TopNav } from '../components/layout/TopNav';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from 'react';

import {
  Calendar,
  Clock,
  Globe,
  Filter,
  RotateCcw,
  ChevronDown,
  AlertCircle,
  Info,
  Database,
} from 'lucide-react';
import { api, createApiParams, validateDateRange } from '../services/api';
import type {
  AnalyticsParams,
  AnalyticsResponse,
  TimeSeriesResponse,
  DayAheadForecastsResponse,
  CoverageResponse,
} from '../types/api';
import {
  formatNumber,
  formatPercentage,
  formatDateTime,
  formatDate,
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

const GenerationChart = lazy(() =>
  import('../components/charts/ForecastCharts').then((m) => ({
    default: m.GenerationChart,
  })),
);
const ErrorChart = lazy(() =>
  import('../components/charts/ForecastCharts').then((m) => ({
    default: m.ErrorChart,
  })),
);

export function Dashboard() {
  const [dateFrom, setDateFrom] = useState('2026-01-01');
  const [dateTo, setDateTo] = useState('2026-01-31');
  const [cutoffHour, setCutoffHour] = useState(DEFAULT_CUTOFF_HOUR);
  const [cutoffMinute, setCutoffMinute] = useState(DEFAULT_CUTOFF_MINUTE);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);

  const [data, setData] = useState<DashboardData>({
    accuracy: null,
    timeSeries: null,
    dayAhead: null,
    coverage: null,
  });

  const [loadingStates, setLoadingStates] = useState<
    Record<string, LoadingState>
  >({
    accuracy: 'idle',
    timeSeries: 'idle',
    dayAhead: 'idle',
    coverage: 'idle',
  });

  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  const getParams = useCallback((): AnalyticsParams => {
    return createApiParams(
      dateFrom,
      dateTo,
      cutoffHour,
      cutoffMinute,
      timezone,
    );
  }, [dateFrom, dateTo, cutoffHour, cutoffMinute, timezone]);

  const fetchAll = useCallback(async () => {
    const validationError = validateDateRange(dateFrom, dateTo);
    if (validationError) {
      setError(validationError);
      return;
    }

    Object.values(abortControllersRef.current).forEach((c) => c.abort());
    setError(null);
    setSelectedDay(null);
    const params = getParams();
    const controllers: Record<string, AbortController> = {};
    const keys = ['accuracy', 'timeSeries', 'dayAhead', 'coverage'] as const;

    keys.forEach((key) => {
      controllers[key] = new AbortController();
      setLoadingStates((prev) => ({ ...prev, [key]: 'loading' }));
    });

    abortControllersRef.current = controllers;

    try {
      const [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes] =
        await Promise.allSettled([
          api.getAccuracy(params, { signal: controllers.accuracy.signal }),
          api.getTimeSeries(params, { signal: controllers.timeSeries.signal }),
          api.getDayAheadForecasts(params, {
            signal: controllers.dayAhead.signal,
          }),
          api.getCoverage(
            { date_from: dateFrom, date_to: dateTo },
            { signal: controllers.coverage.signal },
          ),
        ]);

      if (
        controllers !== abortControllersRef.current ||
        controllers.accuracy.signal.aborted
      )
        return;

      const results = [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes];
      setLoadingStates(
        Object.fromEntries(
          keys.map((key, index) => [
            key,
            results[index].status === 'fulfilled' ? 'success' : 'error',
          ]),
        ),
      );

      const newData: DashboardData = {
        accuracy: accuracyRes.status === 'fulfilled' ? accuracyRes.value : null,
        timeSeries:
          timeSeriesRes.status === 'fulfilled' ? timeSeriesRes.value : null,
        dayAhead: dayAheadRes.status === 'fulfilled' ? dayAheadRes.value : null,
        coverage: coverageRes.status === 'fulfilled' ? coverageRes.value : null,
      };

      setData(newData);
      setLastRefresh(new Date());

      const errors = keys
        .filter((key) => {
          const res = [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes][
            keys.indexOf(key)
          ];
          return res.status === 'rejected';
        })
        .map((key) => {
          const res = [accuracyRes, timeSeriesRes, dayAheadRes, coverageRes][
            keys.indexOf(key)
          ];
          return res.status === 'rejected'
            ? `${key}: ${res.reason.message}`
            : '';
        })
        .filter(Boolean);

      if (errors.length > 0) {
        setError(`Some requests failed: ${errors.join('; ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [dateFrom, dateTo, cutoffHour, cutoffMinute, timezone, getParams]);

  const handleRefresh = useCallback(() => {
    fetchAll();
  }, [fetchAll]);

  const handleFilterChange = useCallback(() => {
    const validationError = validateDateRange(dateFrom, dateTo);
    if (validationError) setError(validationError);
    else fetchAll();
  }, [dateFrom, dateTo, fetchAll]);

  useEffect(() => {
    fetchAll();
    return () => {
      Object.values(abortControllersRef.current).forEach((c) => c.abort());
    };
  }, [fetchAll]);

  const chartData =
    selectedDay && data.timeSeries
      ? data.timeSeries.records.filter((r) => r.settlement_date === selectedDay)
      : (data.timeSeries?.records ?? []);

  const dayAheadForDay =
    selectedDay && data.dayAhead
      ? data.dayAhead.records.filter((r) => r.settlement_date === selectedDay)
      : (data.dayAhead?.records ?? []);

  const availableDays = data.timeSeries
    ? [...new Set(data.timeSeries.records.map((r) => r.settlement_date))].sort()
    : [];

  const kpiData = data.accuracy;
  const accuracy = kpiData?.accuracy_metrics;
  const directional = kpiData?.directional_metrics;
  const distribution = kpiData?.distribution_metrics;
  const coverageMetrics = kpiData?.coverage_metrics;
  const insights = kpiData?.business_insights;
  const methodology = kpiData?.methodology;
  const cutoffConfig = kpiData?.cutoff_config;
  const provenance = kpiData?.dataset_provenance;

  const isLoading = Object.values(loadingStates).some((s) => s === 'loading');
  const hasData = !!data.accuracy || !!data.timeSeries;

  const apiConnected =
    loadingStates.accuracy === 'success' ||
    loadingStates.timeSeries === 'success' ||
    loadingStates.coverage === 'success';

  return (
    <div className="min-h-screen bg-bg">
      <TopNav
        apiConnected={apiConnected}
        lastRefresh={lastRefresh}
        onRefresh={handleRefresh}
        loading={isLoading}
      />

      <main className="container py-4 md:py-6">
        {error && (
          <div
            className="mb-4 p-3 rounded-lg bg-error-light border border-error/20 text-error text-sm flex items-start gap-2"
            role="alert"
          >
            <AlertCircle
              className="icon-md flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span>{error}</span>
          </div>
        )}

        {/* A. Page Introduction */}
        <section className="mb-6" aria-labelledby="page-intro-heading">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 id="page-intro-heading" className="page-title">
                Wind Forecast Accuracy
              </h1>
              <p className="page-subtitle mt-1">
                UK Wind Generation — Day-ahead Forecast Accuracy
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
              <span className="flex items-center gap-1.5">
                <Database className="icon-sm" aria-hidden="true" />
                Elexon BMRS (FUELHH + WINDFOR)
              </span>
              <span className="flex items-center gap-1.5">
                <Globe className="icon-sm" aria-hidden="true" />
                Europe/London
              </span>
              {lastRefresh && (
                <span className="flex items-center gap-1.5">
                  <RotateCcw className="icon-sm" aria-hidden="true" />
                  Last refresh:{' '}
                  {lastRefresh.toLocaleString('en-GB', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* B. Filter Toolbar */}
        <section className="card p-4 mb-6" aria-labelledby="filters-heading">
          <h2 id="filters-heading" className="sr-only">
            Filters
          </h2>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col sm:flex-row gap-3 items-end flex-wrap"
          >
            <div className="w-full sm:w-auto flex-1 min-w-[160px]">
              <label htmlFor="dateFrom" className="form-label">
                <Calendar className="icon-sm inline mr-1" aria-hidden="true" />
                Start date
              </label>
              <input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="w-full sm:w-auto flex-1 min-w-[160px]">
              <label htmlFor="dateTo" className="form-label">
                <Calendar className="icon-sm inline mr-1" aria-hidden="true" />
                End date
              </label>
              <input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="w-full sm:w-auto flex-1 min-w-[120px]">
              <label htmlFor="cutoffHour" className="form-label">
                <Clock className="icon-sm inline mr-1" aria-hidden="true" />
                Cutoff hour (0-23)
              </label>
              <input
                id="cutoffHour"
                type="number"
                min="0"
                max="23"
                value={cutoffHour}
                onChange={(e) =>
                  setCutoffHour(parseInt(e.target.value, 10) || 0)
                }
                className="form-input"
              />
            </div>
            <div className="w-full sm:w-auto flex-1 min-w-[120px]">
              <label htmlFor="cutoffMinute" className="form-label">
                <Clock className="icon-sm inline mr-1" aria-hidden="true" />
                Cutoff minute (0-59)
              </label>
              <input
                id="cutoffMinute"
                type="number"
                min="0"
                max="59"
                value={cutoffMinute}
                onChange={(e) =>
                  setCutoffMinute(parseInt(e.target.value, 10) || 0)
                }
                className="form-input"
              />
            </div>
            <div className="w-full sm:w-auto flex-1 min-w-[160px]">
              <label htmlFor="timezone" className="form-label">
                <Globe className="icon-sm inline mr-1" aria-hidden="true" />
                Timezone
              </label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="form-input"
              >
                <option value="Europe/London">Europe/London</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleFilterChange}
                aria-label="Apply filters"
                disabled={isLoading}
                className="btn btn-secondary gap-2"
              >
                <Filter className="icon-sm" aria-hidden="true" />
                <span className="hidden sm:inline">Apply</span>
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                aria-label="Refresh dashboard"
                disabled={isLoading}
                className="btn btn-primary gap-2"
              >
                <RotateCcw
                  className={`icon-sm ${isLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">
                  {isLoading ? 'Loading…' : 'Refresh'}
                </span>
              </button>
            </div>
          </form>
        </section>

        {/* C. KPI Cards */}
        <section aria-labelledby="kpi-heading" className="mb-6">
          <h2 id="kpi-heading" className="sr-only">
            Key Performance Indicators
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              value={coverageMetrics?.evaluation_coverage_pct}
              unit="%"
              description="Intervals with both forecast and actual"
              loading={loadingStates.coverage === 'loading'}
            />
          </div>

          {/* Optional MAPE card */}
          {accuracy && accuracy.mape_percent !== null && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <KPICard
                title="Mean Absolute Percentage Error (MAPE)"
                value={accuracy.mape_percent}
                unit="%"
                description={`Excludes ${accuracy.mape_excluded_count} intervals with actual = 0 MW`}
                loading={loadingStates.accuracy === 'loading'}
              />
            </div>
          )}
        </section>

        {/* D. Main Chart - Actual vs Forecast Generation */}
        <section
          className="card p-4 md:p-6 mb-6"
          aria-labelledby="main-chart-heading"
        >
          <h2 id="main-chart-heading" className="section-title mb-4">
            Forecast vs Actual Generation
          </h2>

          {availableDays.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <label htmlFor="selectedDay" className="form-label mb-0">
                <Calendar className="icon-sm inline mr-1" aria-hidden="true" />
                View day:
              </label>
              <select
                id="selectedDay"
                value={selectedDay || ''}
                onChange={(e) => setSelectedDay(e.target.value || null)}
                className="form-input max-w-xs"
              >
                <option value="">
                  All days ({chartData.length} intervals)
                </option>
                {availableDays.map((day) => (
                  <option key={day} value={day}>
                    {formatDate(day)} (
                    {
                      dayAheadForDay.filter((d) => d.settlement_date === day)
                        .length
                    }{' '}
                    intervals)
                  </option>
                ))}
              </select>
            </div>
          )}

          {loadingStates.timeSeries === 'loading' ? (
            <ChartSkeleton height={400} />
          ) : chartData.length === 0 ? (
            <EmptyState message="No time-series data available for the selected range." />
          ) : (
            <Suspense fallback={<ChartSkeleton height={400} />}>
              <GenerationChart chartData={chartData} />
            </Suspense>
          )}

          <p className="mt-4 text-sm text-text-muted">
            <strong>Error convention:</strong> Error = Forecast - Actual.
            Positive = overestimation (forecast greater than actual), Negative =
            underestimation. Gaps indicate missing actual or forecast data.
          </p>
        </section>

        {/* E. Forecast Error Chart */}
        <section
          className="card p-4 md:p-6 mb-6"
          aria-labelledby="error-chart-heading"
        >
          <h2 id="error-chart-heading" className="section-title mb-4">
            Forecast Error (MW)
          </h2>

          {loadingStates.timeSeries === 'loading' ? (
            <ChartSkeleton height={300} />
          ) : chartData.length === 0 ? (
            <EmptyState message="No error data available." />
          ) : (
            <Suspense fallback={<ChartSkeleton height={300} />}>
              <ErrorChart chartData={chartData} />
            </Suspense>
          )}

          <p className="mt-4 text-sm text-text-muted">
            Red bars = overestimation (forecast greater than actual), Blue bars
            = underestimation (forecast less than actual), Gray = missing data.
            Zero line indicates perfect forecast.
          </p>
        </section>

        {/* F. Accuracy Details */}
        {kpiData &&
          accuracy &&
          directional &&
          distribution &&
          coverageMetrics && (
            <section
              className="card p-4 md:p-6 mb-6"
              aria-labelledby="accuracy-heading"
            >
              <h2 id="accuracy-heading" className="section-title mb-4">
                Accuracy Details
              </h2>
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
                    description={`Excludes ${accuracy.mape_excluded_count} intervals with actual = 0 MW`}
                  />
                )}
                <MetricDetail
                  label="Overestimation Frequency"
                  value={formatPercentage(
                    directional.overestimation_frequency_pct,
                  )}
                  unit=""
                  description={`Over: ${directional.overestimation_count} intervals`}
                />
                <MetricDetail
                  label="Underestimation Frequency"
                  value={formatPercentage(
                    directional.underestimation_frequency_pct,
                  )}
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
                  label="P95 Absolute Error"
                  value={formatNumber(distribution.p95_absolute_error_mw)}
                  unit="MW"
                  description="95th percentile of absolute errors"
                />
                <MetricDetail
                  label="Evaluated Intervals"
                  value={formatNumber(coverageMetrics.matched_intervals)}
                  unit=""
                  description={`of ${coverageMetrics.total_evaluated_intervals} total`}
                />
                <MetricDetail
                  label="Missing Forecast"
                  value={formatNumber(
                    coverageMetrics.missing_forecast_intervals,
                  )}
                  unit=""
                  description="Intervals with no eligible forecast"
                />
                <MetricDetail
                  label="Missing Actual"
                  value={formatNumber(coverageMetrics.missing_actual_intervals)}
                  unit=""
                  description="Intervals with no actual generation"
                />
              </div>

              {/* Business Insights */}
              {insights && (
                <div className="p-4 rounded-lg bg-bg border border-border">
                  <h3 className="font-semibold text-heading mb-2 flex items-center gap-2">
                    <Info className="icon-sm text-accent" aria-hidden="true" />
                    Key Finding
                  </h3>
                  <p className="text-text mb-4">{insights.key_finding}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                    <div>
                      <span className="font-medium text-heading">
                        Systematic bias:
                      </span>{' '}
                      <span
                        className={
                          insights.bias_direction === 'positive'
                            ? 'text-overestimation'
                            : insights.bias_direction === 'negative'
                              ? 'text-underestimation'
                              : 'text-success'
                        }
                      >
                        {insights.systematic_bias} (
                        {formatNumber(insights.bias_magnitude_mw)} MW)
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-heading">
                        Higher error periods:
                      </span>{' '}
                      <span className="text-text-muted">
                        {insights.higher_error_periods.join(', ') ||
                          'None identified'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium text-heading mb-2">Caveats</h4>
                    <ul className="list-disc list-inside text-sm text-text-muted space-y-1">
                      {insights.caveats.map((caveat, i) => (
                        <li key={i}>{caveat}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}

        {/* G. Data Quality */}
        {data.coverage && (
          <section
            className="card p-4 md:p-6 mb-6"
            aria-labelledby="data-quality-heading"
          >
            <h2 id="data-quality-heading" className="section-title mb-4">
              Data Quality
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <DataQualityCard
                label="Expected Intervals"
                value={formatNumber(data.coverage.expected_intervals)}
              />
              <DataQualityCard
                label="Actual Intervals"
                value={formatNumber(data.coverage.actual_intervals)}
              />
              <DataQualityCard
                label="Forecast Intervals"
                value={formatNumber(data.coverage.forecast_intervals)}
              />
              <DataQualityCard
                label="Forecast Versions"
                value={formatNumber(data.coverage.forecast_versions)}
              />
              <DataQualityCard
                label="Actual Coverage"
                value={formatPercentage(data.coverage.actual_coverage_pct)}
              />
              <DataQualityCard
                label="Forecast Coverage"
                value={formatPercentage(data.coverage.forecast_coverage_pct)}
              />
              <DataQualityCard
                label="Missing Actual"
                value={formatNumber(data.coverage.missing_actual_intervals)}
              />
              <DataQualityCard
                label="Missing Forecast"
                value={formatNumber(data.coverage.missing_forecast_intervals)}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="p-4 rounded-lg bg-bg border border-border">
                <h3 className="font-medium text-heading mb-2">Methodology</h3>
                <ul className="list-disc list-inside text-text-muted space-y-1">
                  {methodology &&
                    Object.entries(methodology).map(([key, value]) => (
                      <li key={key}>
                        <span className="font-medium">{key}:</span> {value}
                      </li>
                    ))}
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-bg border border-border">
                <h3 className="font-medium text-heading mb-2">
                  Dataset Provenance
                </h3>
                <ul className="list-disc list-inside text-text-muted space-y-1">
                  {provenance &&
                    Object.entries(provenance).map(([key, value]) => (
                      <li key={key}>
                        <span className="font-medium">{key}:</span> {value}
                      </li>
                    ))}
                </ul>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-actual-light border border-actual/20 text-actual text-sm">
              <strong>Note:</strong> This analysis uses historical Elexon BMRS
              data (FUELHH actuals, WINDFOR forecasts). Data is not live; it
              represents the January 2026 proxy period. Coverage percentages
              reflect data availability in the Elexon archive.
            </div>
          </section>
        )}

        {/* H. Methodology (Collapsible) */}
        <section
          className="card p-4 md:p-6 mb-6"
          aria-labelledby="methodology-heading"
        >
          <h2 id="methodology-heading">
            <button
              type="button"
              onClick={() => setShowMethodology(!showMethodology)}
              className="flex items-center justify-between w-full text-left section-title"
              aria-expanded={showMethodology}
              aria-controls="methodology-content"
            >
              <span className="flex items-center gap-2">
                <Info className="icon-md text-accent" aria-hidden="true" />
                Methodology & Assumptions
              </span>
              <span
                className={`icon-md transition-transform ${showMethodology ? 'rotate-180' : ''}`}
              >
                <ChevronDown
                  className="icon-md text-text-muted"
                  aria-hidden="true"
                />
              </span>
            </button>
          </h2>
          <div
            id="methodology-content"
            className={showMethodology ? 'mt-4' : 'hidden'}
          >
            <div className="space-y-3 text-sm text-text-muted">
              <div className="p-4 rounded-lg bg-bg border border-border">
                <h3 className="font-medium text-heading mb-2">Data Sources</h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    <strong>Actual Generation:</strong> Elexon BMRS FUELHH
                    dataset, filtered to WIND fuel type. Half-hourly settlement
                    periods in MW.
                  </li>
                  <li>
                    <strong>Forecasts:</strong> Elexon BMRS WINDFOR dataset via
                    the official Insights API. Historical publications at 06:00
                    and 10:00 UTC on D-1 for each delivery date.
                  </li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-bg border border-border">
                <h3 className="font-medium text-heading mb-2">
                  Forecast Selection Methodology
                </h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    <strong>Cutoff:</strong> Default 12:00 Europe/London on D-1
                    (EPEX SPOT day-ahead gate closure).
                  </li>
                  <li>
                    <strong>Eligibility:</strong> Only forecasts published on or
                    before the cutoff are eligible.
                  </li>
                  <li>
                    <strong>Selection:</strong> For each delivery hour, select
                    the latest eligible forecast by publishTime.
                  </li>
                  <li>
                    <strong>Tie-breaking:</strong> If multiple forecasts share
                    the same publishTime, select the one with the lowest
                    generation_mw (deterministic).
                  </li>
                  <li>
                    <strong>Expansion:</strong> Each hourly forecast covers two
                    half-hour settlement periods; the selected value is applied
                    to both.
                  </li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-bg border border-border">
                <h3 className="font-medium text-heading mb-2">
                  Alignment & Error Calculation
                </h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Actuals and selected forecasts are aligned by UTC delivery
                    interval start.
                  </li>
                  <li>
                    Error = Forecast − Actual (positive = overestimation).
                  </li>
                  <li>
                    MAPE excludes intervals where actual generation = 0 MW.
                  </li>
                  <li>
                    Missing actual/forecast intervals excluded from error
                    metrics.
                  </li>
                </ul>
              </div>
              <div className="p-4 rounded-lg bg-bg border border-border">
                <h3 className="font-medium text-heading mb-2">
                  Known Limitations
                </h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Analysis limited to January 2026 (31 days, 1,488 intervals).
                  </li>
                  <li>
                    Only 06:00 and 10:00 UTC D-1 publications fetched;
                    additional eligible publications before cutoff may exist.
                  </li>
                  <li>
                    DST handling via zoneinfo; assumes 48 periods/day (no
                    spring-forward/fall-back adjustment in Jan).
                  </li>
                  <li>
                    Elexon public endpoint is rate-limited; API key recommended
                    for production.
                  </li>
                  <li>
                    No caching layer; each request fetches fresh from Elexon.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Decision-Time Forecast Transparency */}
        {data.dayAhead && dayAheadForDay.length > 0 && (
          <section
            className="card p-4 md:p-6 mb-6"
            aria-labelledby="transparency-heading"
          >
            <h2 id="transparency-heading" className="section-title mb-4">
              Decision-Time Forecast Transparency
            </h2>
            <p className="text-sm text-text-muted mb-4">
              Forecasts selected for each delivery interval based on the latest
              eligible publication before the procurement cutoff (
              {cutoffConfig?.hour?.toString().padStart(2, '0')}:
              {cutoffConfig?.minute?.toString().padStart(2, '0')}{' '}
              {cutoffConfig?.timezone} on D-1). Forecasts published after the
              cutoff are excluded (look-ahead bias prevention).
            </p>
            <div className="table-container scrollbar-thin">
              <table className="table" role="table">
                <thead>
                  <tr>
                    <th>Delivery</th>
                    <th>Decision Cutoff</th>
                    <th>Forecast (MW)</th>
                    <th>Published</th>
                    <th>Age (hrs)</th>
                    <th>Actual (MW)</th>
                    <th>Error (MW)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayAheadForDay.map((record, idx) => {
                    const aligned = data.timeSeries?.records.find(
                      (r) =>
                        r.settlement_date === record.settlement_date &&
                        r.settlement_period === record.settlement_period,
                    );
                    const actualMw = aligned?.actual_generation_mw ?? null;
                    const errorMw = aligned?.error_mw ?? null;
                    return (
                      <tr
                        key={`${record.settlement_date}-${record.settlement_period}`}
                        className={idx % 2 === 0 ? 'bg-bg' : ''}
                      >
                        <td className="text-mono">
                          {formatDate(record.settlement_date)} SP
                          {record.settlement_period}
                        </td>
                        <td>{formatDateTime(record.decision_cutoff_utc)}</td>
                        <td className="text-mono font-medium">
                          {formatNumber(record.forecast_generation_mw)}
                        </td>
                        <td>
                          {formatDateTime(record.forecast_publish_time_utc)}
                        </td>
                        <td className="text-mono">
                          {formatNumber(record.forecast_age_hours, 1)}
                        </td>
                        <td className="text-mono">
                          {actualMw !== null ? formatNumber(actualMw) : '—'}
                        </td>
                        <td className="text-mono">
                          <span className={getErrorColor(errorMw)}>
                            {errorMw !== null ? formatNumber(errorMw) : '—'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${getSelectionStatusColor(record.selection_status)}`}
                          >
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

        {!hasData && !isLoading && (
          <EmptyState
            message="No data available. Check your date range and ensure the API is accessible."
            action={{ label: 'Retry', onClick: handleRefresh }}
          />
        )}
      </main>
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
      <div className="card p-4 md:p-6 animate-pulse">
        <div className="h-4 bg-border rounded w-3/4 mb-2"></div>
        <div className="h-8 bg-border rounded w-1/2 mb-1"></div>
        <div className="h-3 bg-border rounded w-2/3"></div>
      </div>
    );
  }

  return (
    <div className="card p-4 md:p-6">
      <h3 className="kpi-label mb-1">{title}</h3>
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`kpi-value ${valueColor || ''}`}>
          {value !== null && value !== undefined ? formatNumber(value) : '—'}
        </span>
        <span className="kpi-unit">{unit}</span>
      </div>
      <p className="text-xs text-text-muted">{description}</p>
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
    <div className="p-4 rounded-lg bg-bg border border-border">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-1 mb-1">
        <span className={`text-2xl font-semibold ${valueColor || ''}`}>
          {value}
        </span>
        <span className="text-text-muted">{unit}</span>
      </div>
      <p className="text-xs text-text-muted">{description}</p>
    </div>
  );
}

function DataQualityCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 text-center">
      <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-2xl font-semibold text-heading">{value}</p>
    </div>
  );
}

function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div
      className="animate-pulse bg-border rounded-lg"
      style={{ height: `${height}px` }}
    />
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
    <div className="card p-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-border flex items-center justify-center mb-4">
        <Info className="icon-xl text-text-muted" aria-hidden="true" />
      </div>
      <h3 className="font-medium text-heading mb-1">No data</h3>
      <p className="text-text-muted mb-4">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn btn-primary gap-2"
        >
          <RotateCcw className="icon-sm" aria-hidden="true" />
          {action.label}
        </button>
      )}
    </div>
  );
}

export default Dashboard;
