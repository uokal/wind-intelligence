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
    
    WINDFOR provides hourly forecasts (odd settlement periods 1,3,5...47).
    Each hourly forecast covers two half-hour settlement periods.
    We expand each hourly forecast to two half-hour intervals.
    
    For each delivery date:
    1. Determine the previous day's decision cutoff in UTC
    2. Group forecasts by delivery date and hour (hour = (period-1)//2)
    3. For each hour, select the latest eligible forecast by publishTime
    6. Expand each selected hourly forecast to two half-hour intervals
    7. Preserve the selected forecast's publishTime
    """
    # Group forecasts by delivery date and hour (hour = (period-1)//2)
    forecasts_by_date_hour = {}
    for f in forecasts:
        key = (f.settlement_date, (f.settlement_period - 1) // 2)
        if key not in forecasts_by_date_hour:
            forecasts_by_date_hour[key] = []
        forecasts_by_date_hour[key].append(f)
    
    results = []
    
    current_date = delivery_date_from
    while current_date <= delivery_date_to:
        cutoff_utc = config.get_cutoff_utc(current_date)
        date_str = current_date.isoformat()
        
        # For each of the 24 hours in the day
        for hour in range(24):
            key = (date_str, hour)
            hour_forecasts = forecasts_by_date_hour.get(key, [])
            
            # Determine the two half-hour periods for this hour
            period_odd = hour * 2 + 1      # 1,3,5,...,47
            period_even = hour * 2 + 2     # 2,4,6,...,48
            
            # Calculate delivery start UTC for the two half-hours
            from app.services.wind_data import _settlement_to_utc
            delivery_start_utc_odd = _settlement_to_utc(date_str, period_odd)
            delivery_start_utc_even = delivery_start_utc_odd + timedelta(minutes=30)
            
            if not hour_forecasts:
                # No forecast for this hour at all
                for period in (period_odd, period_even):
                    delivery_start = delivery_start_utc_odd if period == period_odd else delivery_start_utc_even
                    results.append(SelectedForecast(
                        delivery_start_utc=delivery_start,
                        settlement_date=date_str,
                        settlement_period=period,
                        forecast_generation_mw=0.0,
                        forecast_publish_time_utc=datetime.min.replace(tzinfo=UTC_TZ),
                        decision_cutoff_utc=cutoff_utc,
                        forecast_age_hours=0.0,
                        selection_status="no_forecast_at_all",
                    ))
                continue
            
            # Select latest eligible forecast for this hour
            cutoff_utc = config.get_cutoff_utc(current_date)
            selected = _select_latest_eligible_forecast(hour_forecasts, cutoff_utc)
            
            if selected is None:
                for period in (period_odd, period_even):
                    delivery_start = delivery_start_utc_odd if period == period_odd else delivery_start_utc_even
                    results.append(SelectedForecast(
                        delivery_start_utc=delivery_start,
                        settlement_date=date_str,
                        settlement_period=period,
                        forecast_generation_mw=0.0,
                        forecast_publish_time_utc=datetime.min.replace(tzinfo=UTC_TZ),
                        decision_cutoff_utc=cutoff_utc,
                        forecast_age_hours=0.0,
                        selection_status="no_eligible_forecast",
                    ))
            else:
                age_hours = (cutoff_utc - selected.publish_time_utc).total_seconds() / 3600
                gen_mw = selected.generation_mw
                pub_time = selected.publish_time_utc
                
                # Create two half-hour entries from the hourly forecast
                for period, delivery_start in [(period_odd, delivery_start_utc_odd), (period_even, delivery_start_utc_even)]:
                    results.append(SelectedForecast(
                        delivery_start_utc=delivery_start,
                        settlement_date=date_str,
                        settlement_period=period,
                        forecast_generation_mw=gen_mw,
                        forecast_publish_time_utc=pub_time,
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
    Only forecasts with selection_status == 'selected' are considered.
    """
    actuals_by_interval = {_delivery_key(a): a for a in actuals}
    # Only consider forecasts that were actually selected (i.e., have a valid publication)
    forecasts_by_interval = {
        _delivery_key(f): f for f in selected_forecasts if f.selection_status == "selected"
    }
    
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