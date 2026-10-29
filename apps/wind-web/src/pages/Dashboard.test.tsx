import { render, screen, waitFor } from '@testing-library/react';
import { Dashboard } from './Dashboard';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../services/api';

// Mock the API module
vi.mock('../services/api', () => ({
  api: {
    getAccuracy: vi.fn(),
    getTimeSeries: vi.fn(),
    getDayAheadForecasts: vi.fn(),
    getCoverage: vi.fn(),
    getHealth: vi.fn(),
  },
  createApiParams: vi.fn((dateFrom, dateTo, cutoffHour, cutoffMinute, timezone) => ({
    date_from: dateFrom,
    date_to: dateTo,
    cutoff_hour: cutoffHour,
    cutoff_minute: cutoffMinute,
    timezone,
  })),
  validateDateRange: vi.fn(() => null),
}));

const mockAccuracyResponse = {
  date_from: '2026-01-01',
  date_to: '2026-01-31',
  methodology: {
    forecast_selection: 'Latest eligible forecast',
    error_sign_convention: 'Error = Forecast - Actual (positive = overestimation)',
    mape_zero_handling: 'Exclude intervals where actual == 0 MW',
    aggregation_level: 'Per settlement period',
  },
  cutoff_config: { hour: 12, minute: 0, timezone: 'Europe/London' },
  dataset_provenance: {
    actuals_dataset: 'Elexon BMRS FUELHH',
    forecasts_dataset: 'Elexon BMRS WINDFOR',
    delivery_date_range: '2026-01-01 to 2026-01-31',
    expected_intervals: 1488,
  },
  accuracy_metrics: {
    mae_mw: 245.67,
    rmse_mw: 312.45,
    mean_error_mw: 45.23,
    mape_percent: 8.92,
    mape_excluded_count: 12,
    mape_included_count: 1476,
  },
  directional_metrics: {
    overestimation_count: 890,
    underestimation_count: 586,
    exact_match_count: 12,
    overestimation_volume_mw: 185420.5,
    underestimation_volume_mw: -124680.3,
    overestimation_frequency_pct: 59.93,
    underestimation_frequency_pct: 39.45,
  },
  distribution_metrics: {
    max_absolute_error_mw: 2145.0,
    median_absolute_error_mw: 156.0,
    p90_absolute_error_mw: 623.0,
    p95_absolute_error_mw: 892.0,
    p99_absolute_error_mw: 1456.0,
  },
  coverage_metrics: {
    total_evaluated_intervals: 1488,
    matched_intervals: 1445,
    missing_forecast_intervals: 28,
    missing_actual_intervals: 15,
    evaluation_coverage_pct: 97.11,
  },
  business_insights: {
    systematic_bias: 'overestimation',
    bias_magnitude_mw: 45.23,
    bias_direction: 'positive',
    higher_error_periods: ['periods_with_extreme_errors'],
    key_finding: 'Forecasts systematically overestimate wind generation by 45.2 MW on average.',
    caveats: ['Test caveat 1', 'Test caveat 2'],
  },
};

const mockTimeSeriesResponse = {
  date_from: '2026-01-01',
  date_to: '2026-01-31',
  interval_count: 1488,
  cutoff_config: { hour: 12, minute: 0, timezone: 'Europe/London' },
  records: [
    {
      delivery_start_utc: '2026-01-01T00:00:00Z',
      settlement_date: '2026-01-01',
      settlement_period: 1,
      actual_generation_mw: 5000.0,
      forecast_generation_mw: 5200.0,
      forecast_publish_time_utc: '2025-12-31T10:00:00Z',
      decision_cutoff_utc: '2025-12-31T12:00:00Z',
      error_mw: 200.0,
      absolute_error_mw: 200.0,
      percentage_error: 4.0,
      alignment_status: 'matched',
    },
  ],
};

const mockDayAheadResponse = {
  date_from: '2026-01-01',
  date_to: '2026-01-31',
  interval_count: 1488,
  cutoff_config: { hour: 12, minute: 0, timezone: 'Europe/London' },
  methodology: {},
  records: [
    {
      delivery_start_utc: '2026-01-01T00:00:00Z',
      settlement_date: '2026-01-01',
      settlement_period: 1,
      forecast_generation_mw: 5200.0,
      forecast_publish_time_utc: '2025-12-31T10:00:00Z',
      decision_cutoff_utc: '2025-12-31T12:00:00Z',
      forecast_age_hours: 2.0,
      selection_status: 'selected',
    },
  ],
};

const mockCoverageResponse = {
  date_from: '2026-01-01',
  date_to: '2026-01-31',
  expected_intervals: 1488,
  actual_intervals: 1470,
  forecast_intervals: 1460,
  forecast_versions: 5000,
  missing_actual_intervals: 18,
  missing_forecast_intervals: 28,
  duplicate_actual_records: 0,
  invalid_actual_records: 0,
  invalid_forecast_records: 0,
  actual_coverage_pct: 98.79,
  forecast_coverage_pct: 98.12,
};

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Dashboard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Dashboard', () => {
  test('renders dashboard title and controls', () => {
    api.getAccuracy.mockResolvedValue(mockAccuracyResponse);
    api.getTimeSeries.mockResolvedValue(mockTimeSeriesResponse);
    api.getDayAheadForecasts.mockResolvedValue(mockDayAheadResponse);
    api.getCoverage.mockResolvedValue(mockCoverageResponse);

    renderDashboard();

    expect(screen.getByText('Wind Forecast Intelligence')).toBeInTheDocument();
    expect(screen.getByText('UK Wind Generation — Day-ahead Forecast Accuracy')).toBeInTheDocument();
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    expect(screen.getByLabelText('End date')).toBeInTheDocument();
    expect(screen.getByLabelText('Cutoff hour (0-23)')).toBeInTheDocument();
    expect(screen.getByLabelText('Cutoff minute (0-59)')).toBeInTheDocument();
    expect(screen.getByText(/Elexon BMRS/)).toBeInTheDocument();
  });

  test('successful analytics response renders KPI values', async () => {
    api.getAccuracy.mockResolvedValue(mockAccuracyResponse);
    api.getTimeSeries.mockResolvedValue(mockTimeSeriesResponse);
    api.getDayAheadForecasts.mockResolvedValue(mockDayAheadResponse);
    api.getCoverage.mockResolvedValue(mockCoverageResponse);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByText('245.67').length).toBeGreaterThan(0); // MAE
      expect(screen.getAllByText('312.45').length).toBeGreaterThan(0); // RMSE
      expect(screen.getAllByText('45.23').length).toBeGreaterThan(0); // Bias
      expect(screen.getAllByText('97.11').length).toBeGreaterThan(0); // Coverage
    });
  });

  test('API failure shows error message', async () => {
    api.getAccuracy.mockRejectedValue(new Error('Network error'));
    api.getTimeSeries.mockRejectedValue(new Error('Network error'));
    api.getDayAheadForecasts.mockRejectedValue(new Error('Network error'));
    api.getCoverage.mockRejectedValue(new Error('Network error'));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Some requests failed/)).toBeInTheDocument();
    });
  });

  test('error convention explanation is displayed in header', async () => {
    api.getAccuracy.mockResolvedValue(mockAccuracyResponse);
    api.getTimeSeries.mockResolvedValue(mockTimeSeriesResponse);
    api.getDayAheadForecasts.mockResolvedValue(mockDayAheadResponse);
    api.getCoverage.mockResolvedValue(mockCoverageResponse);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Error convention/)).toBeInTheDocument();
    });
  });

  test('data source is displayed in header', async () => {
    api.getAccuracy.mockResolvedValue(mockAccuracyResponse);
    api.getTimeSeries.mockResolvedValue(mockTimeSeriesResponse);
    api.getDayAheadForecasts.mockResolvedValue(mockDayAheadResponse);
    api.getCoverage.mockResolvedValue(mockCoverageResponse);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Elexon BMRS/)).toBeInTheDocument();
    });
  });

  test('empty dataset shows empty state', async () => {
    const emptyAccuracy = {
      ...mockAccuracyResponse,
      accuracy_metrics: {
        mae_mw: 0,
        rmse_mw: 0,
        mean_error_mw: 0,
        mape_percent: null,
        mape_excluded_count: 0,
        mape_included_count: 0,
      },
      directional_metrics: {
        overestimation_count: 0,
        underestimation_count: 0,
        exact_match_count: 0,
        overestimation_volume_mw: 0,
        underestimation_volume_mw: 0,
        overestimation_frequency_pct: 0,
        underestimation_frequency_pct: 0,
      },
      distribution_metrics: {
        max_absolute_error_mw: 0,
        median_absolute_error_mw: 0,
        p90_absolute_error_mw: 0,
        p95_absolute_error_mw: 0,
        p99_absolute_error_mw: 0,
      },
      coverage_metrics: {
        total_evaluated_intervals: 0,
        matched_intervals: 0,
        missing_forecast_intervals: 0,
        missing_actual_intervals: 0,
        evaluation_coverage_pct: 0,
      },
      business_insights: {
        systematic_bias: 'neutral',
        bias_magnitude_mw: 0,
        bias_direction: 'zero',
        higher_error_periods: [],
        key_finding: 'No data available',
        caveats: [],
      },
    };
    const emptyTimeSeries = { ...mockTimeSeriesResponse, records: [] };
    const emptyDayAhead = { ...mockDayAheadResponse, records: [] };
    const emptyCoverage = {
      ...mockCoverageResponse,
      expected_intervals: 0,
      actual_intervals: 0,
      forecast_intervals: 0,
      forecast_versions: 0,
      missing_actual_intervals: 0,
      missing_forecast_intervals: 0,
    };

    api.getAccuracy.mockResolvedValue(emptyAccuracy);
    api.getTimeSeries.mockResolvedValue(emptyTimeSeries);
    api.getDayAheadForecasts.mockResolvedValue(emptyDayAhead);
    api.getCoverage.mockResolvedValue(emptyCoverage);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });
  });

  test('Elexon timeout shows error', async () => {
    api.getAccuracy.mockRejectedValue(new Error('Timeout'));
    api.getTimeSeries.mockRejectedValue(new Error('Timeout'));
    api.getDayAheadForecasts.mockRejectedValue(new Error('Timeout'));
    api.getCoverage.mockRejectedValue(new Error('Timeout'));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Some requests failed/)).toBeInTheDocument();
    });
  });

  test('HTTP 429 rate limit shows error', async () => {
    const rateLimitError = new Error('Rate limited');
    (rateLimitError as any).status = 429;
    api.getAccuracy.mockRejectedValue(rateLimitError);
    api.getTimeSeries.mockRejectedValue(rateLimitError);
    api.getDayAheadForecasts.mockRejectedValue(rateLimitError);
    api.getCoverage.mockRejectedValue(rateLimitError);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Some requests failed/)).toBeInTheDocument();
    });
  });

  test('HTTP 500 upstream error shows error', async () => {
    const serverError = new Error('Internal Server Error');
    (serverError as any).status = 500;
    api.getAccuracy.mockRejectedValue(serverError);
    api.getTimeSeries.mockRejectedValue(serverError);
    api.getDayAheadForecasts.mockRejectedValue(serverError);
    api.getCoverage.mockRejectedValue(serverError);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Some requests failed/)).toBeInTheDocument();
    });
  });

  test('missing forecast records displayed', async () => {
    const timeSeriesMissingForecast = {
      ...mockTimeSeriesResponse,
      records: [
        {
          delivery_start_utc: '2026-01-01T00:00:00Z',
          settlement_date: '2026-01-01',
          settlement_period: 1,
          actual_generation_mw: 5000.0,
          forecast_generation_mw: null,
          forecast_publish_time_utc: null,
          decision_cutoff_utc: '2025-12-31T12:00:00Z',
          error_mw: null,
          absolute_error_mw: null,
          percentage_error: null,
          alignment_status: 'missing_forecast',
        },
      ],
    };
    const dayAheadMissing = {
      ...mockDayAheadResponse,
      records: [
        {
          delivery_start_utc: '2026-01-01T00:00:00Z',
          settlement_date: '2026-01-01',
          settlement_period: 1,
          forecast_generation_mw: 0,
          forecast_publish_time_utc: '1970-01-01T00:00:00Z',
          decision_cutoff_utc: '2025-12-31T12:00:00Z',
          forecast_age_hours: 0,
          selection_status: 'no_eligible_forecast',
        },
      ],
    };

    api.getAccuracy.mockResolvedValue(mockAccuracyResponse);
    api.getTimeSeries.mockResolvedValue(timeSeriesMissingForecast);
    api.getDayAheadForecasts.mockResolvedValue(dayAheadMissing);
    api.getCoverage.mockResolvedValue(mockCoverageResponse);

    renderDashboard();

    await waitFor(() => {
      // The transparency table shows selection status label
      expect(screen.getByText('No eligible forecast (after cutoff)')).toBeInTheDocument();
    });
  });

  test('missing actual records displayed', async () => {
    const timeSeriesMissingActual = {
      ...mockTimeSeriesResponse,
      records: [
        {
          delivery_start_utc: '2026-01-01T00:00:00Z',
          settlement_date: '2026-01-01',
          settlement_period: 1,
          actual_generation_mw: null,
          forecast_generation_mw: 5200.0,
          forecast_publish_time_utc: '2025-12-31T10:00:00Z',
          decision_cutoff_utc: '2025-12-31T12:00:00Z',
          error_mw: null,
          absolute_error_mw: null,
          percentage_error: null,
          alignment_status: 'missing_actual',
        },
      ],
    };

    api.getAccuracy.mockResolvedValue(mockAccuracyResponse);
    api.getTimeSeries.mockResolvedValue(timeSeriesMissingActual);
    api.getDayAheadForecasts.mockResolvedValue(mockDayAheadResponse);
    api.getCoverage.mockResolvedValue(mockCoverageResponse);

    renderDashboard();

    await waitFor(() => {
      // The chart area shows gaps; there is no explicit "Missing actual" text.
      // Verify that the chart renders without error.
      expect(screen.getByText('Forecast vs Actual Generation')).toBeInTheDocument();
    });
  });
});