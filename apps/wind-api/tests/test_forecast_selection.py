import pytest
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

from app.services.forecast_selection import (
    select_day_ahead_forecasts,
    align_actuals_and_forecasts,
    DecisionCutoffConfig,
    _select_latest_eligible_forecast,
    SelectedForecast,
    AlignedRecord,
)
from app.services.analytics import (
    compute_accuracy_metrics,
    compute_directional_metrics,
    compute_distribution_metrics,
    compute_coverage_metrics,
    compute_business_insights,
    compute_full_analytics,
    AccuracyMetrics,
    DirectionalMetrics,
    DistributionMetrics,
)
from app.schemas.wind import (
    ActualGenerationRecord,
    ForecastGenerationRecord,
)


LONDON_TZ = ZoneInfo("Europe/London")
UTC_TZ = timezone.utc


def _make_actual(settlement_date: str, period: int, mw: float) -> ActualGenerationRecord:
    from app.services.wind_data import _settlement_to_utc
    return ActualGenerationRecord(
        delivery_start_utc=_settlement_to_utc(settlement_date, period),
        generation_mw=mw,
        settlement_date=settlement_date,
        settlement_period=period,
    )


def _make_forecast(settlement_date: str, period: int, publish_time: datetime, mw: float) -> ForecastGenerationRecord:
    from app.services.wind_data import _settlement_to_utc
    return ForecastGenerationRecord(
        delivery_start_utc=_settlement_to_utc(settlement_date, period),
        publish_time_utc=publish_time,
        generation_mw=mw,
        settlement_date=settlement_date,
        settlement_period=period,
    )


class TestDecisionCutoffConfig:
    """Test decision cutoff configuration."""
    
    def test_default_cutoff(self):
        config = DecisionCutoffConfig()
        assert config.hour == 12
        assert config.minute == 0
        assert config.timezone == "Europe/London"
    
    def test_custom_cutoff(self):
        config = DecisionCutoffConfig(hour=10, minute=30, timezone="Europe/London")
        assert config.hour == 10
        assert config.minute == 30
    
    def test_invalid_hour_raises(self):
        with pytest.raises(ValueError):
            DecisionCutoffConfig(hour=24)
        with pytest.raises(ValueError):
            DecisionCutoffConfig(hour=-1)
    
    def test_invalid_minute_raises(self):
        with pytest.raises(ValueError):
            DecisionCutoffConfig(minute=60)
        with pytest.raises(ValueError):
            DecisionCutoffConfig(minute=-1)
    
    def test_get_cutoff_utc_january(self):
        """January is UTC (GMT), so 12:00 London = 12:00 UTC"""
        config = DecisionCutoffConfig(hour=12, minute=0)
        cutoff = config.get_cutoff_utc(date(2026, 1, 15))
        # Delivery 2026-01-15 -> Decision 2026-01-14 12:00 London = 12:00 UTC
        assert cutoff == datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
    
    def test_get_cutoff_utc_july_bst(self):
        """July is BST (UTC+1), so 12:00 London = 11:00 UTC"""
        config = DecisionCutoffConfig(hour=12, minute=0)
        cutoff = config.get_cutoff_utc(date(2026, 7, 15))
        # Delivery 2026-07-15 -> Decision 2026-07-14 12:00 BST = 11:00 UTC
        assert cutoff == datetime(2026, 7, 14, 11, 0, tzinfo=UTC_TZ)


class TestSelectLatestEligibleForecast:
    """Test core forecast selection logic."""
    
    def test_single_forecast_before_cutoff(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5000.0),
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is not None
        assert selected.generation_mw == 5000.0
    
    def test_multiple_forecasts_select_latest(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 6, 0, tzinfo=UTC_TZ), 5000.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5100.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 11, 0, tzinfo=UTC_TZ), 5200.0),
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is not None
        assert selected.generation_mw == 5200.0  # Latest before cutoff
    
    def test_exclude_post_cutoff_forecasts(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5000.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 14, 0, tzinfo=UTC_TZ), 5200.0),  # After cutoff
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is not None
        assert selected.generation_mw == 5000.0  # Only pre-cutoff eligible
    
    def test_all_forecasts_post_cutoff_returns_none(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 14, 0, tzinfo=UTC_TZ), 5200.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 16, 0, tzinfo=UTC_TZ), 5300.0),
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is None
    
    def test_no_forecasts_returns_none(self):
        forecasts = []
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is None
    
    def test_identical_publish_timestamps_deterministic_tiebreak(self):
        """Same publish_time -> pick lower generation_mw (deterministic)."""
        pub_time = datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ)
        forecasts = [
            _make_forecast("2026-01-15", 1, pub_time, 5200.0),
            _make_forecast("2026-01-15", 1, pub_time, 5100.0),
            _make_forecast("2026-01-15", 1, pub_time, 5300.0),
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is not None
        assert selected.generation_mw == 5100.0  # Lowest MW for tiebreak
    
    def test_out_of_order_records(self):
        """Records not sorted by publish_time should still work."""
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 11, 0, tzinfo=UTC_TZ), 5200.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 6, 0, tzinfo=UTC_TZ), 5000.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5100.0),
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is not None
        assert selected.generation_mw == 5200.0  # Latest before cutoff
    
    def test_duplicate_forecast_records(self):
        """Exact duplicate records (same publish_time, same MW) should be handled."""
        pub_time = datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ)
        forecasts = [
            _make_forecast("2026-01-15", 1, pub_time, 5100.0),
            _make_forecast("2026-01-15", 1, pub_time, 5100.0),  # Exact duplicate
        ]
        cutoff = datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ)
        selected = _select_latest_eligible_forecast(forecasts, cutoff)
        assert selected is not None
        assert selected.generation_mw == 5100.0


class TestSelectDayAheadForecasts:
    """Test full day-ahead forecast selection for date range."""
    
    def test_january_2026_expected_intervals(self):
        """January 2026: 31 days * 48 periods = 1488 intervals."""
        forecasts = []
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 1), date(2026, 1, 31), config)
        assert len(selected) == 1488
    
    def test_all_intervals_marked_no_forecast_when_empty(self):
        forecasts = []
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 1), date(2026, 1, 1), config)
        assert all(s.selection_status == "no_forecast_at_all" for s in selected)
    
    def test_forecast_before_cutoff_selected(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5000.0),
        ]
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 15), date(2026, 1, 15), config)
        
        # Find period 1
        period_1 = next(s for s in selected if s.settlement_period == 1)
        assert period_1.selection_status == "selected"
        assert period_1.forecast_generation_mw == 5000.0
        assert period_1.forecast_publish_time_utc == datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ)
    
    def test_forecast_after_cutoff_marked_no_eligible(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 14, 0, tzinfo=UTC_TZ), 5200.0),
        ]
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 15), date(2026, 1, 15), config)
        
        period_1 = next(s for s in selected if s.settlement_period == 1)
        assert period_1.selection_status == "no_eligible_forecast"
    
    def test_multiple_versions_per_interval_selects_latest_eligible(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 6, 0, tzinfo=UTC_TZ), 5000.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5100.0),
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 14, 0, tzinfo=UTC_TZ), 5200.0),  # Post cutoff
        ]
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 15), date(2026, 1, 15), config)
        
        period_1 = next(s for s in selected if s.settlement_period == 1)
        assert period_1.selection_status == "selected"
        assert period_1.forecast_generation_mw == 5100.0  # Latest eligible (10:00)
    
    def test_forecast_age_calculated(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 6, 0, tzinfo=UTC_TZ), 5000.0),
        ]
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 15), date(2026, 1, 15), config)
        
        period_1 = next(s for s in selected if s.settlement_period == 1)
        # Cutoff 12:00, forecast 06:00 = 6 hours age
        assert period_1.forecast_age_hours == 6.0
    
    def test_custom_cutoff_hour(self):
        forecasts = [
            _make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 11, 0, tzinfo=UTC_TZ), 5000.0),
        ]
        config = DecisionCutoffConfig(hour=10, minute=0)  # 10:00 cutoff
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 15), date(2026, 1, 15), config)
        
        period_1 = next(s for s in selected if s.settlement_period == 1)
        assert period_1.selection_status == "no_eligible_forecast"  # 11:00 > 10:00 cutoff
    
    def test_dst_transition_july(self):
        """Test July DST transition (BST = UTC+1)."""
        # In July, London is UTC+1. 12:00 London = 11:00 UTC
        forecasts = [
            _make_forecast("2026-07-15", 1, datetime(2026, 7, 14, 10, 0, tzinfo=UTC_TZ), 5000.0),  # 11:00 BST
        ]
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 7, 15), date(2026, 7, 15), config)
        
        period_1 = next(s for s in selected if s.settlement_period == 1)
        assert period_1.selection_status == "selected"  # 10:00 UTC = 11:00 BST < 12:00 BST


class TestAlignActualsAndForecasts:
    """Test actual vs forecast alignment."""
    
    def test_matched_interval(self):
        actuals = [_make_actual("2026-01-15", 1, 5000.0)]
        forecasts = [SelectedForecast(
            delivery_start_utc=datetime(2026, 1, 15, 0, 0, tzinfo=UTC_TZ),
            settlement_date="2026-01-15",
            settlement_period=1,
            forecast_generation_mw=5200.0,
            forecast_publish_time_utc=datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ),
            decision_cutoff_utc=datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ),
            forecast_age_hours=2.0,
            selection_status="selected",
        )]
        
        aligned = align_actuals_and_forecasts(actuals, forecasts)
        assert len(aligned) == 1
        r = aligned[0]
        assert r.alignment_status == "matched"
        assert r.actual_generation_mw == 5000.0
        assert r.forecast_generation_mw == 5200.0
        assert r.error_mw == 200.0  # Forecast - Actual
        assert r.absolute_error_mw == 200.0
        assert r.percentage_error == 4.0  # 200/5000 * 100
    
    def test_missing_forecast(self):
        actuals = [_make_actual("2026-01-15", 1, 5000.0)]
        forecasts = []
        
        aligned = align_actuals_and_forecasts(actuals, forecasts)
        assert len(aligned) == 1
        r = aligned[0]
        assert r.alignment_status == "missing_forecast"
        assert r.actual_generation_mw == 5000.0
        assert r.forecast_generation_mw is None
        assert r.error_mw is None
    
    def test_missing_actual(self):
        actuals = []
        forecasts = [SelectedForecast(
            delivery_start_utc=datetime(2026, 1, 15, 0, 0, tzinfo=UTC_TZ),
            settlement_date="2026-01-15",
            settlement_period=1,
            forecast_generation_mw=5200.0,
            forecast_publish_time_utc=datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ),
            decision_cutoff_utc=datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ),
            forecast_age_hours=2.0,
            selection_status="selected",
        )]
        
        aligned = align_actuals_and_forecasts(actuals, forecasts)
        assert len(aligned) == 1
        r = aligned[0]
        assert r.alignment_status == "missing_actual"
        assert r.actual_generation_mw is None
        assert r.forecast_generation_mw == 5200.0
        assert r.error_mw is None
    
    def test_zero_actual_excluded_from_mape(self):
        actuals = [_make_actual("2026-01-15", 1, 0.0)]
        forecasts = [SelectedForecast(
            delivery_start_utc=datetime(2026, 1, 15, 0, 0, tzinfo=UTC_TZ),
            settlement_date="2026-01-15",
            settlement_period=1,
            forecast_generation_mw=100.0,
            forecast_publish_time_utc=datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ),
            decision_cutoff_utc=datetime(2026, 1, 14, 12, 0, tzinfo=UTC_TZ),
            forecast_age_hours=2.0,
            selection_status="selected",
        )]
        
        aligned = align_actuals_and_forecasts(actuals, forecasts)
        r = aligned[0]
        assert r.alignment_status == "matched"
        assert r.error_mw == 100.0
        assert r.percentage_error is None  # Excluded due to zero actual


class TestAccuracyMetrics:
    """Test core accuracy metric calculations."""
    
    def test_mae_calculation(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=5100.0, forecast_generation_mw=4900.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=-200.0, absolute_error_mw=200.0, percentage_error=-3.92,
                          alignment_status="matched"),
        ]
        metrics = compute_accuracy_metrics(aligned)
        assert metrics.mae_mw == 200.0  # Mean of 200, 200
    
    def test_rmse_calculation(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=5100.0, forecast_generation_mw=4900.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=-200.0, absolute_error_mw=200.0, percentage_error=-3.92,
                          alignment_status="matched"),
        ]
        metrics = compute_accuracy_metrics(aligned)
        assert metrics.rmse_mw == 200.0  # sqrt(mean(200^2, 200^2)) = 200
    
    def test_mean_error_bias(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=5100.0, forecast_generation_mw=5000.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=-100.0, absolute_error_mw=100.0, percentage_error=-1.96,
                          alignment_status="matched"),
        ]
        metrics = compute_accuracy_metrics(aligned)
        assert metrics.mean_error_mw == 50.0  # Mean of 200, -100
    
    def test_mape_excludes_zero_actual(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=0.0, forecast_generation_mw=100.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=100.0, absolute_error_mw=100.0, percentage_error=None,
                          alignment_status="matched"),
        ]
        metrics = compute_accuracy_metrics(aligned)
        assert metrics.mape_percent == 4.0  # Only first interval included
        assert metrics.mape_included_count == 1
        assert metrics.mape_excluded_count == 1
    
    def test_mape_all_zero_actual_returns_none(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=0.0, forecast_generation_mw=100.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=100.0, absolute_error_mw=100.0, percentage_error=None,
                          alignment_status="matched"),
        ]
        metrics = compute_accuracy_metrics(aligned)
        assert metrics.mape_percent is None
        assert metrics.mape_excluded_count == 1
        assert metrics.mape_included_count == 0
    
    def test_empty_records_returns_zeros(self):
        metrics = compute_accuracy_metrics([])
        assert metrics.mae_mw == 0.0
        assert metrics.rmse_mw == 0.0
        assert metrics.mean_error_mw == 0.0
        assert metrics.mape_percent is None


class TestDirectionalMetrics:
    """Test over/under estimation metrics."""
    
    def test_over_under_counts(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=5100.0, forecast_generation_mw=4900.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=-200.0, absolute_error_mw=200.0, percentage_error=-3.92,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,1,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=3,
                          actual_generation_mw=5000.0, forecast_generation_mw=5000.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=0.0, absolute_error_mw=0.0, percentage_error=0.0,
                          alignment_status="matched"),
        ]
        metrics = compute_directional_metrics(aligned)
        assert metrics.overestimation_count == 1
        assert metrics.underestimation_count == 1
        assert metrics.exact_match_count == 1
        assert metrics.overestimation_volume_mw == 200.0
        assert metrics.underestimation_volume_mw == -200.0
        assert metrics.overestimation_frequency_pct == pytest.approx(33.33, rel=0.01)
        assert metrics.underestimation_frequency_pct == pytest.approx(33.33, rel=0.01)
    
    def test_positive_bias_overestimation_dominates(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=5100.0, forecast_generation_mw=5300.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=3.92,
                          alignment_status="matched"),
        ]
        metrics = compute_directional_metrics(aligned)
        assert metrics.overestimation_count == 2
        assert metrics.underestimation_count == 0
        assert metrics.overestimation_volume_mw == 400.0
        assert metrics.underestimation_volume_mw == 0.0


class TestDistributionMetrics:
    """Test error distribution percentiles."""
    
    def test_percentiles(self):
        # 10 values: 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=i,
                          actual_generation_mw=5000.0, forecast_generation_mw=5000.0 + v, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=v, absolute_error_mw=v, percentage_error=v/50,
                          alignment_status="matched")
            for i, v in enumerate([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], 1)
        ]
        metrics = compute_distribution_metrics(aligned)
        assert metrics.max_absolute_error_mw == 1000.0
        assert metrics.median_absolute_error_mw == 550.0  # (500+600)/2
        assert metrics.p90_absolute_error_mw == 910.0  # 90th percentile
        assert metrics.p95_absolute_error_mw == 955.0
        assert metrics.p99_absolute_error_mw == 991.0


class TestCoverageMetrics:
    """Test coverage calculations."""
    
    def test_coverage_calculation(self):
        aligned = [
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=1,
                          actual_generation_mw=5000.0, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=200.0, absolute_error_mw=200.0, percentage_error=4.0,
                          alignment_status="matched"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,0,30,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=2,
                          actual_generation_mw=5000.0, forecast_generation_mw=None, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=None, absolute_error_mw=None, percentage_error=None,
                          alignment_status="missing_forecast"),
            AlignedRecord(delivery_start_utc=datetime(2026,1,15,1,0,tzinfo=UTC_TZ), settlement_date="2026-01-15", settlement_period=3,
                          actual_generation_mw=None, forecast_generation_mw=5200.0, forecast_publish_time_utc=None,
                          decision_cutoff_utc=None, error_mw=None, absolute_error_mw=None, percentage_error=None,
                          alignment_status="missing_actual"),
        ]
        metrics = compute_coverage_metrics(aligned)
        assert metrics.total_evaluated_intervals == 3
        assert metrics.matched_intervals == 1
        assert metrics.missing_forecast_intervals == 1
        assert metrics.missing_actual_intervals == 1
        assert metrics.evaluation_coverage_pct == pytest.approx(33.33, rel=0.01)


class TestBusinessInsights:
    """Test business insight generation."""
    
    def test_overestimation_bias_insight(self):
        accuracy = AccuracyMetrics(mae_mw=200.0, rmse_mw=250.0, mean_error_mw=100.0, mape_percent=5.0, mape_excluded_count=0, mape_included_count=10)
        directional = DirectionalMetrics(overestimation_count=7, underestimation_count=3, exact_match_count=0,
                                         overestimation_volume_mw=1400.0, underestimation_volume_mw=-600.0,
                                         overestimation_frequency_pct=70.0, underestimation_frequency_pct=30.0)
        distribution = DistributionMetrics(max_absolute_error_mw=500.0, median_absolute_error_mw=150.0,
                                           p90_absolute_error_mw=400.0, p95_absolute_error_mw=450.0, p99_absolute_error_mw=490.0)
        
        insights = compute_business_insights([], accuracy, directional, distribution)
        assert insights.systematic_bias == "overestimation"
        assert insights.bias_direction == "positive"
        assert "overestimate" in insights.key_finding.lower()
    
    def test_underestimation_bias_insight(self):
        accuracy = AccuracyMetrics(mae_mw=200.0, rmse_mw=250.0, mean_error_mw=-100.0, mape_percent=5.0, mape_excluded_count=0, mape_included_count=10)
        directional = DirectionalMetrics(overestimation_count=3, underestimation_count=7, exact_match_count=0,
                                         overestimation_volume_mw=600.0, underestimation_volume_mw=-1400.0,
                                         overestimation_frequency_pct=30.0, underestimation_frequency_pct=70.0)
        distribution = DistributionMetrics(max_absolute_error_mw=500.0, median_absolute_error_mw=150.0,
                                           p90_absolute_error_mw=400.0, p95_absolute_error_mw=450.0, p99_absolute_error_mw=490.0)
        
        insights = compute_business_insights([], accuracy, directional, distribution)
        assert insights.systematic_bias == "underestimation"
        assert insights.bias_direction == "negative"
        assert "underestimate" in insights.key_finding.lower()
    
    def test_neutral_bias_insight(self):
        accuracy = AccuracyMetrics(mae_mw=200.0, rmse_mw=250.0, mean_error_mw=10.0, mape_percent=5.0, mape_excluded_count=0, mape_included_count=10)
        directional = DirectionalMetrics(overestimation_count=5, underestimation_count=5, exact_match_count=0,
                                         overestimation_volume_mw=1000.0, underestimation_volume_mw=-1000.0,
                                         overestimation_frequency_pct=50.0, underestimation_frequency_pct=50.0)
        distribution = DistributionMetrics(max_absolute_error_mw=500.0, median_absolute_error_mw=150.0,
                                           p90_absolute_error_mw=400.0, p95_absolute_error_mw=450.0, p99_absolute_error_mw=490.0)
        
        insights = compute_business_insights([], accuracy, directional, distribution)
        assert insights.systematic_bias == "neutral"
        assert insights.bias_direction == "zero"
        assert "no strong systematic bias" in insights.key_finding.lower()
    
    def test_caveats_included(self):
        accuracy = AccuracyMetrics(mae_mw=200.0, rmse_mw=250.0, mean_error_mw=0.0, mape_percent=5.0, mape_excluded_count=0, mape_included_count=10)
        directional = DirectionalMetrics(overestimation_count=5, underestimation_count=5, exact_match_count=0,
                                         overestimation_volume_mw=1000.0, underestimation_volume_mw=-1000.0,
                                         overestimation_frequency_pct=50.0, underestimation_frequency_pct=50.0)
        distribution = DistributionMetrics(max_absolute_error_mw=500.0, median_absolute_error_mw=150.0,
                                           p90_absolute_error_mw=400.0, p95_absolute_error_mw=450.0, p99_absolute_error_mw=490.0)
        
        insights = compute_business_insights([], accuracy, directional, distribution)
        assert len(insights.caveats) >= 5
        assert any("January 2026" in c for c in insights.caveats)
        assert any("12:00" in c for c in insights.caveats)
        assert any("MAPE excludes" in c for c in insights.caveats)


class TestFullAnalytics:
    """Test complete analytics pipeline."""
    
    def test_full_pipeline_with_known_data(self):
        # Create simple known dataset
        actuals = [_make_actual("2026-01-15", 1, 5000.0)]
        forecasts = [_make_forecast("2026-01-15", 1, datetime(2026, 1, 14, 10, 0, tzinfo=UTC_TZ), 5200.0)]
        
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 15), date(2026, 1, 15), config)
        aligned = align_actuals_and_forecasts(actuals, selected)
        
        result = compute_full_analytics(aligned, "2026-01-15", "2026-01-15", {"hour": 12, "minute": 0, "timezone": "Europe/London"})
        
        assert result.date_from == "2026-01-15"
        assert result.date_to == "2026-01-15"
        assert result.accuracy_metrics.mae_mw == 200.0
        assert result.accuracy_metrics.mean_error_mw == 200.0  # Overestimation
        assert result.directional_metrics.overestimation_count == 1
        assert result.coverage_metrics.matched_intervals == 1
        assert result.methodology["error_sign_convention"] == "Error = Forecast - Actual (positive = overestimation)"
    
    def test_january_2026_full_range(self):
        """Test full January 2026 range produces 1488 intervals."""
        actuals = []
        forecasts = []
        config = DecisionCutoffConfig()
        selected = select_day_ahead_forecasts(forecasts, date(2026, 1, 1), date(2026, 1, 31), config)
        aligned = align_actuals_and_forecasts(actuals, selected)
        
        result = compute_full_analytics(aligned, "2026-01-01", "2026-01-31", {"hour": 12, "minute": 0, "timezone": "Europe/London"})
        
        assert result.coverage_metrics.total_evaluated_intervals == 1488
        assert result.dataset_provenance["expected_intervals"] == 1488


class TestAPIQueryValidation:
    """Test analytics API parameter validation."""
    
    def test_valid_default_params(self):
        from app.api.routes.analytics import AnalyticsParams
        params = AnalyticsParams(date_from="2026-01-01", date_to="2026-01-31")
        assert params.date_from == "2026-01-01"
        assert params.date_to == "2026-01-31"
        assert params.cutoff_hour == 12
        assert params.cutoff_minute == 0
        assert params.timezone == "Europe/London"
    
    def test_invalid_date_format(self):
        from app.api.routes.analytics import AnalyticsParams
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            AnalyticsParams(date_from="01-01-2026", date_to="2026-01-31")
    
    def test_invalid_cutoff_hour(self):
        from app.api.routes.analytics import AnalyticsParams
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            AnalyticsParams(date_from="2026-01-01", date_to="2026-01-31", cutoff_hour=24)
        with pytest.raises(ValidationError):
            AnalyticsParams(date_from="2026-01-01", date_to="2026-01-31", cutoff_hour=-1)
    
    def test_invalid_cutoff_minute(self):
        from app.api.routes.analytics import AnalyticsParams
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            AnalyticsParams(date_from="2026-01-01", date_to="2026-01-31", cutoff_minute=60)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])