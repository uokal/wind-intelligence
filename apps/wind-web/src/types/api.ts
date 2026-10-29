export interface SelectedForecastRecord {
  delivery_start_utc: string;
  settlement_date: string;
  settlement_period: number;
  forecast_generation_mw: number;
  forecast_publish_time_utc: string;
  decision_cutoff_utc: string;
  forecast_age_hours: number;
  selection_status: string;
}

export interface DayAheadForecastsResponse {
  date_from: string;
  date_to: string;
  interval_count: number;
  cutoff_config: CutoffConfig;
  methodology: Record<string, string>;
  records: SelectedForecastRecord[];
}

export interface AlignedRecord {
  delivery_start_utc: string;
  settlement_date: string;
  settlement_period: number;
  actual_generation_mw: number | null;
  forecast_generation_mw: number | null;
  forecast_publish_time_utc: string | null;
  decision_cutoff_utc: string;
  error_mw: number | null;
  absolute_error_mw: number | null;
  percentage_error: number | null;
  alignment_status: string;
}

export interface TimeSeriesResponse {
  date_from: string;
  date_to: string;
  interval_count: number;
  cutoff_config: CutoffConfig;
  records: AlignedRecord[];
}

export interface AccuracyMetricsResponse {
  mae_mw: number;
  rmse_mw: number;
  mean_error_mw: number;
  mape_percent: number | null;
  mape_excluded_count: number;
  mape_included_count: number;
}

export interface DirectionalMetricsResponse {
  overestimation_count: number;
  underestimation_count: number;
  exact_match_count: number;
  overestimation_volume_mw: number;
  underestimation_volume_mw: number;
  overestimation_frequency_pct: number;
  underestimation_frequency_pct: number;
}

export interface DistributionMetricsResponse {
  max_absolute_error_mw: number;
  median_absolute_error_mw: number;
  p90_absolute_error_mw: number;
  p95_absolute_error_mw: number;
  p99_absolute_error_mw: number;
}

export interface CoverageMetricsResponse {
  total_evaluated_intervals: number;
  matched_intervals: number;
  missing_forecast_intervals: number;
  missing_actual_intervals: number;
  evaluation_coverage_pct: number;
}

export interface BusinessInsightsResponse {
  systematic_bias: string;
  bias_magnitude_mw: number;
  bias_direction: string;
  higher_error_periods: string[];
  key_finding: string;
  caveats: string[];
}

export interface AnalyticsResponse {
  date_from: string;
  date_to: string;
  methodology: Record<string, string>;
  cutoff_config: CutoffConfig;
  dataset_provenance: Record<string, string>;
  accuracy_metrics: AccuracyMetricsResponse;
  directional_metrics: DirectionalMetricsResponse;
  distribution_metrics: DistributionMetricsResponse;
  coverage_metrics: CoverageMetricsResponse;
  business_insights: BusinessInsightsResponse;
}

export interface CutoffConfig {
  hour: number;
  minute: number;
  timezone: string;
}

export interface AnalyticsParams {
  date_from: string;
  date_to: string;
  cutoff_hour: number;
  cutoff_minute: number;
  timezone: string;
}

export interface CoverageResponse {
  date_from: string;
  date_to: string;
  expected_intervals: number;
  actual_intervals: number;
  forecast_intervals: number;
  forecast_versions: number;
  missing_actual_intervals: number;
  missing_forecast_intervals: number;
  duplicate_actual_records: number;
  invalid_actual_records: number;
  invalid_forecast_records: number;
  actual_coverage_pct: number;
  forecast_coverage_pct: number;
}