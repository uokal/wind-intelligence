from datetime import datetime, date, timedelta, timezone
from typing import List, Optional, Tuple
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from app.schemas.wind import (
    ForecastGenerationRecord,
    ActualGenerationRecord,
)

LONDON_TZ = ZoneInfo("Europe/London")
UTC_TZ = timezone.utc


@dataclass(frozen=True)
class DecisionCutoffConfig:
    """Configuration for day-ahead procurement decision cutoff."""
    hour: int = 12
    minute: int = 0
    timezone: str = "Europe/London"

    def __post_init__(self):
        if not 0 <= self.hour <= 23:
            raise ValueError("hour must be 0-23")
        if not 0 <= self.minute <= 59:
            raise ValueError("minute must be 0-59")

    def get_cutoff_utc(self, delivery_date: date) -> datetime:
        """Get the cutoff timestamp in UTC for a given delivery date."""
        cutoff_local = datetime(
            delivery_date.year,
            delivery_date.month,
            delivery_date.day,
            self.hour,
            self.minute,
            tzinfo=LONDON_TZ,
        ) - timedelta(days=1)
        return cutoff_local.astimezone(UTC_TZ)


@dataclass(frozen=True)
class SelectedForecast:
    """Result of forecast selection for a single delivery interval."""
    delivery_start_utc: datetime
    settlement_date: str
    settlement_period: int
    forecast_generation_mw: float
    forecast_publish_time_utc: datetime
    decision_cutoff_utc: datetime
    forecast_age_hours: float
    selection_status: str  # "selected", "no_eligible_forecast", "no_forecast_at_all"


@dataclass(frozen=True)
class AlignedRecord:
    """Actual and selected forecast aligned by delivery interval."""
    delivery_start_utc: datetime
    settlement_date: str
    settlement_period: int
    actual_generation_mw: Optional[float]
    forecast_generation_mw: Optional[float]
    forecast_publish_time_utc: Optional[datetime]
    decision_cutoff_utc: datetime
    error_mw: Optional[float]
    absolute_error_mw: Optional[float]
    percentage_error: Optional[float]
    alignment_status: str  # "matched", "missing_actual", "missing_forecast"


def _delivery_key(record) -> Tuple[str, int]:
    """Extract delivery key from a record."""
    return (record.settlement_date, record.settlement_period)


def _select_latest_eligible_forecast(
    forecasts: List[ForecastGenerationRecord],
    cutoff_utc: datetime,
) -> Optional[ForecastGenerationRecord]:
    """
    Select the latest forecast published on or before the cutoff.
    
    Deterministic tie-breaking: if multiple forecasts have the same publish_time,
    select the one with the lowest generation_mw (arbitrary but deterministic).
    """
    eligible = [f for f in forecasts if f.publish_time_utc <= cutoff_utc]
    
    if not eligible:
        return None
    
    # Sort by publish_time_utc descending, then by generation_mw ascending for deterministic tie-breaking
    eligible.sort(key=lambda f: (-f.publish_time_utc.timestamp(), f.generation_mw))
    return eligible[0]


def select_day_ahead_forecasts(
    forecasts: List[ForecastGenerationRecord],
    delivery_date_from: date,
    delivery_date_to: date,
    config: DecisionCutoffConfig,
) -> List[SelectedForecast]:
    """
    Select day-ahead forecasts for all delivery intervals in the date range.
    
    For each 30-minute delivery interval:
    1. Determine the local delivery date
    2. Calculate the previous day's decision cutoff in UTC
    3. Find forecasts matching that delivery interval
    4. Exclude forecasts published after the cutoff
    5. Select the latest eligible forecast by publishTime
    6. Preserve the selected forecast's publishTime
    7. Mark intervals without an eligible forecast as missing
    """
    # Group forecasts by delivery interval
    forecasts_by_interval = {}
    for f in forecasts:
        key = _delivery_key(f)
        if key not in forecasts_by_interval:
            forecasts_by_interval[key] = []
        forecasts_by_interval[key].append(f)
    
    results = []
    
    current_date = delivery_date_from
    while current_date <= delivery_date_to:
        cutoff_utc = config.get_cutoff_utc(current_date)
        
        # January has 48 periods (no DST change)
        for period in range(1, 49):
            key = (current_date.isoformat(), period)
            interval_forecasts = forecasts_by_interval.get(key, [])
            
            # Calculate delivery start UTC
            from app.services.wind_data import _settlement_to_utc
            delivery_start_utc = _settlement_to_utc(current_date.isoformat(), period)
            
            if not interval_forecasts:
                results.append(SelectedForecast(
                    delivery_start_utc=delivery_start_utc,
                    settlement_date=current_date.isoformat(),
                    settlement_period=period,
                    forecast_generation_mw=0.0,
                    forecast_publish_time_utc=datetime.min.replace(tzinfo=UTC_TZ),
                    decision_cutoff_utc=cutoff_utc,
                    forecast_age_hours=0.0,
                    selection_status="no_forecast_at_all",
                ))
                continue
            
            selected = _select_latest_eligible_forecast(interval_forecasts, cutoff_utc)
            
            if selected is None:
                results.append(SelectedForecast(
                    delivery_start_utc=delivery_start_utc,
                    settlement_date=current_date.isoformat(),
                    settlement_period=period,
                    forecast_generation_mw=0.0,
                    forecast_publish_time_utc=datetime.min.replace(tzinfo=UTC_TZ),
                    decision_cutoff_utc=cutoff_utc,
                    forecast_age_hours=0.0,
                    selection_status="no_eligible_forecast",
                ))
            else:
                age_hours = (cutoff_utc - selected.publish_time_utc).total_seconds() / 3600
                results.append(SelectedForecast(
                    delivery_start_utc=delivery_start_utc,
                    settlement_date=current_date.isoformat(),
                    settlement_period=period,
                    forecast_generation_mw=selected.generation_mw,
                    forecast_publish_time_utc=selected.publish_time_utc,
                    decision_cutoff_utc=cutoff_utc,
                    forecast_age_hours=age_hours,
                    selection_status="selected",
                ))
        
        current_date += timedelta(days=1)
    
    return results


def align_actuals_and_forecasts(
    actuals: List[ActualGenerationRecord],
    selected_forecasts: List[SelectedForecast],
) -> List[AlignedRecord]:
    """
    Match actual and forecast records by normalized UTC delivery interval.
    
    For each interval, return aligned record with error calculations.
    """
    actuals_by_interval = {_delivery_key(a): a for a in actuals}
    forecasts_by_interval = {_delivery_key(f): f for f in selected_forecasts}
    
    all_keys = set(actuals_by_interval.keys()) | set(forecasts_by_interval.keys())
    
    results = []
    for key in sorted(all_keys):
        settlement_date, settlement_period = key
        actual = actuals_by_interval.get(key)
        forecast = forecasts_by_interval.get(key)
        
        if actual and forecast:
            error_mw = forecast.forecast_generation_mw - actual.generation_mw
            abs_error_mw = abs(error_mw)
            pct_error = None
            if actual.generation_mw > 1.0:  # epsilon = 1 MW
                pct_error = (error_mw / actual.generation_mw) * 100
            
            results.append(AlignedRecord(
                delivery_start_utc=actual.delivery_start_utc,
                settlement_date=settlement_date,
                settlement_period=settlement_period,
                actual_generation_mw=actual.generation_mw,
                forecast_generation_mw=forecast.forecast_generation_mw,
                forecast_publish_time_utc=forecast.forecast_publish_time_utc,
                decision_cutoff_utc=forecast.decision_cutoff_utc,
                error_mw=error_mw,
                absolute_error_mw=abs_error_mw,
                percentage_error=pct_error,
                alignment_status="matched",
            ))
        elif actual and not forecast:
            results.append(AlignedRecord(
                delivery_start_utc=actual.delivery_start_utc,
                settlement_date=settlement_date,
                settlement_period=settlement_period,
                actual_generation_mw=actual.generation_mw,
                forecast_generation_mw=None,
                forecast_publish_time_utc=None,
                decision_cutoff_utc=forecasts_by_interval.get(key, SelectedForecast(
                    delivery_start_utc=actual.delivery_start_utc,
                    settlement_date=settlement_date,
                    settlement_period=settlement_period,
                    forecast_generation_mw=0.0,
                    forecast_publish_time_utc=datetime.min.replace(tzinfo=UTC_TZ),
                    decision_cutoff_utc=datetime.min.replace(tzinfo=UTC_TZ),
                    forecast_age_hours=0.0,
                    selection_status="missing",
                )).decision_cutoff_utc,
                error_mw=None,
                absolute_error_mw=None,
                percentage_error=None,
                alignment_status="missing_forecast",
            ))
        elif forecast and not actual:
            results.append(AlignedRecord(
                delivery_start_utc=forecast.delivery_start_utc,
                settlement_date=settlement_date,
                settlement_period=settlement_period,
                actual_generation_mw=None,
                forecast_generation_mw=forecast.forecast_generation_mw,
                forecast_publish_time_utc=forecast.forecast_publish_time_utc,
                decision_cutoff_utc=forecast.decision_cutoff_utc,
                error_mw=None,
                absolute_error_mw=None,
                percentage_error=None,
                alignment_status="missing_actual",
            ))
    
    return results