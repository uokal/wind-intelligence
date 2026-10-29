from datetime import datetime, date
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel, field_validator, ConfigDict

from app.clients.elexon import ElexonClient
from app.services.wind_data import fetch_and_normalize
from app.services.forecast_selection import (
    select_day_ahead_forecasts,
    align_actuals_and_forecasts,
    DecisionCutoffConfig,
    SelectedForecast,
)
from app.services.analytics import compute_full_analytics, AnalyticsResponse
from app.schemas.wind import (
    DayAheadForecastsResponse,
    TimeSeriesResponse,
    AnalyticsResponse as AnalyticsResponseSchema,
    SelectedForecastRecord,
    AlignedRecord,
    AccuracyMetricsResponse,
    DirectionalMetricsResponse,
    DistributionMetricsResponse,
    CoverageMetricsResponse,
    BusinessInsightsResponse,
)

router = APIRouter()


class AnalyticsParams(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    date_from: str = Query("2026-01-01", alias="from", description="Start date YYYY-MM-DD (default: 2026-01-01)")
    date_to: str = Query("2026-01-31", alias="to", description="End date YYYY-MM-DD (default: 2026-01-31)")
    cutoff_hour: int = Query(12, ge=0, le=23, description="Decision cutoff hour (0-23) in Europe/London")
    cutoff_minute: int = Query(0, ge=0, le=59, description="Decision cutoff minute (0-59)")
    timezone: str = Query("Europe/London", description="Timezone for cutoff interpretation")

    @field_validator("date_from", "date_to")
    @classmethod
    def _validate_format(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Date must be YYYY-MM-DD")
        return v


def get_elexon_client() -> ElexonClient:
    return ElexonClient()


def _parse_date(d: str) -> date:
    return datetime.strptime(d, "%Y-%m-%d").date()


def _selected_to_schema(f: SelectedForecast) -> SelectedForecastRecord:
    return SelectedForecastRecord(
        delivery_start_utc=f.delivery_start_utc,
        settlement_date=f.settlement_date,
        settlement_period=f.settlement_period,
        forecast_generation_mw=f.forecast_generation_mw,
        forecast_publish_time_utc=f.forecast_publish_time_utc,
        decision_cutoff_utc=f.decision_cutoff_utc,
        forecast_age_hours=f.forecast_age_hours,
        selection_status=f.selection_status,
    )


def _aligned_to_schema(r) -> AlignedRecord:
    return AlignedRecord(
        delivery_start_utc=r.delivery_start_utc,
        settlement_date=r.settlement_date,
        settlement_period=r.settlement_period,
        actual_generation_mw=r.actual_generation_mw,
        forecast_generation_mw=r.forecast_generation_mw,
        forecast_publish_time_utc=r.forecast_publish_time_utc,
        decision_cutoff_utc=r.decision_cutoff_utc,
        error_mw=r.error_mw,
        absolute_error_mw=r.absolute_error_mw,
        percentage_error=r.percentage_error,
        alignment_status=r.alignment_status,
    )


def _analytics_to_schema(a: AnalyticsResponse) -> AnalyticsResponseSchema:
    return AnalyticsResponseSchema(
        date_from=a.date_from,
        date_to=a.date_to,
        methodology=a.methodology,
        cutoff_config=a.cutoff_config,
        dataset_provenance=a.dataset_provenance,
        accuracy_metrics=AccuracyMetricsResponse(
            mae_mw=a.accuracy_metrics.mae_mw,
            rmse_mw=a.accuracy_metrics.rmse_mw,
            mean_error_mw=a.accuracy_metrics.mean_error_mw,
            mape_percent=a.accuracy_metrics.mape_percent,
            mape_excluded_count=a.accuracy_metrics.mape_excluded_count,
            mape_included_count=a.accuracy_metrics.mape_included_count,
        ),
        directional_metrics=DirectionalMetricsResponse(
            overestimation_count=a.directional_metrics.overestimation_count,
            underestimation_count=a.directional_metrics.underestimation_count,
            exact_match_count=a.directional_metrics.exact_match_count,
            overestimation_volume_mw=a.directional_metrics.overestimation_volume_mw,
            underestimation_volume_mw=a.directional_metrics.underestimation_volume_mw,
            overestimation_frequency_pct=a.directional_metrics.overestimation_frequency_pct,
            underestimation_frequency_pct=a.directional_metrics.underestimation_frequency_pct,
        ),
        distribution_metrics=DistributionMetricsResponse(
            max_absolute_error_mw=a.distribution_metrics.max_absolute_error_mw,
            median_absolute_error_mw=a.distribution_metrics.median_absolute_error_mw,
            p90_absolute_error_mw=a.distribution_metrics.p90_absolute_error_mw,
            p95_absolute_error_mw=a.distribution_metrics.p95_absolute_error_mw,
            p99_absolute_error_mw=a.distribution_metrics.p99_absolute_error_mw,
        ),
        coverage_metrics=CoverageMetricsResponse(
            total_evaluated_intervals=a.coverage_metrics.total_evaluated_intervals,
            matched_intervals=a.coverage_metrics.matched_intervals,
            missing_forecast_intervals=a.coverage_metrics.missing_forecast_intervals,
            missing_actual_intervals=a.coverage_metrics.missing_actual_intervals,
            evaluation_coverage_pct=a.coverage_metrics.evaluation_coverage_pct,
        ),
        business_insights=BusinessInsightsResponse(
            systematic_bias=a.business_insights.systematic_bias,
            bias_magnitude_mw=a.business_insights.bias_magnitude_mw,
            bias_direction=a.business_insights.bias_direction,
            higher_error_periods=a.business_insights.higher_error_periods,
            key_finding=a.business_insights.key_finding,
            caveats=a.business_insights.caveats,
        ),
    )


@router.get(
    "/analytics/day-ahead",
    response_model=DayAheadForecastsResponse,
    summary="Get day-ahead selected forecasts for each delivery interval",
)
async def get_day_ahead_forecasts(
    params: AnalyticsParams = Depends(),
    client: ElexonClient = Depends(get_elexon_client),
):
    """
    Select the latest eligible wind forecast for each 30-minute delivery interval
    based on the day-ahead procurement decision cutoff.
    
    Default cutoff: 12:00 Europe/London on D-1 (EPEX SPOT gate closure).
    """
    try:
        actuals, forecasts, _ = await fetch_and_normalize(client, params.date_from, params.date_to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream Elexon error: {e}")
    
    config = DecisionCutoffConfig(
        hour=params.cutoff_hour,
        minute=params.cutoff_minute,
        timezone=params.timezone,
    )
    
    date_from = _parse_date(params.date_from)
    date_to = _parse_date(params.date_to)
    
    selected = select_day_ahead_forecasts(forecasts, date_from, date_to, config)
    
    methodology = {
        "forecast_selection": "Latest eligible forecast published on or before D-1 cutoff",
        "cutoff_assumption": f"{params.cutoff_hour:02d}:{params.cutoff_minute:02d} {params.timezone} on D-1",
        "error_sign_convention": "Error = Forecast - Actual (positive = overestimation)",
        "tie_breaking": "Earliest publish_time, then lowest generation_mw (deterministic)",
        "excluded_forecasts": "Any forecast published after cutoff",
    }
    
    cutoff_config = {
        "hour": params.cutoff_hour,
        "minute": params.cutoff_minute,
        "timezone": params.timezone,
    }
    
    return DayAheadForecastsResponse(
        date_from=params.date_from,
        date_to=params.date_to,
        interval_count=len(selected),
        cutoff_config=cutoff_config,
        methodology=methodology,
        records=[_selected_to_schema(f) for f in selected],
    )


@router.get(
    "/analytics/timeseries",
    response_model=TimeSeriesResponse,
    summary="Get aligned actual vs forecast time-series with errors",
)
async def get_timeseries(
    params: AnalyticsParams = Depends(),
    client: ElexonClient = Depends(get_elexon_client),
):
    """
    Get time-series of actual generation, selected day-ahead forecasts,
    and forecast errors for each delivery interval.
    """
    try:
        actuals, forecasts, _ = await fetch_and_normalize(client, params.date_from, params.date_to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream Elexon error: {e}")
    
    config = DecisionCutoffConfig(
        hour=params.cutoff_hour,
        minute=params.cutoff_minute,
        timezone=params.timezone,
    )
    
    date_from = _parse_date(params.date_from)
    date_to = _parse_date(params.date_to)
    
    selected = select_day_ahead_forecasts(forecasts, date_from, date_to, config)
    aligned = align_actuals_and_forecasts(actuals, selected)
    
    cutoff_config = {
        "hour": params.cutoff_hour,
        "minute": params.cutoff_minute,
        "timezone": params.timezone,
    }
    
    return TimeSeriesResponse(
        date_from=params.date_from,
        date_to=params.date_to,
        interval_count=len(aligned),
        cutoff_config=cutoff_config,
        records=[_aligned_to_schema(r) for r in aligned],
    )


@router.get(
    "/analytics/accuracy",
    response_model=AnalyticsResponseSchema,
    summary="Get comprehensive forecast accuracy metrics",
)
async def get_accuracy(
    params: AnalyticsParams = Depends(),
    client: ElexonClient = Depends(get_elexon_client),
):
    """
    Get comprehensive forecast accuracy analytics including:
    - MAE, RMSE, Mean Error (Bias), MAPE
    - Over/under estimation analysis
    - Error distribution percentiles
    - Data coverage metrics
    - Business insights
    """
    try:
        actuals, forecasts, _ = await fetch_and_normalize(client, params.date_from, params.date_to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream Elexon error: {e}")
    
    config = DecisionCutoffConfig(
        hour=params.cutoff_hour,
        minute=params.cutoff_minute,
        timezone=params.timezone,
    )
    
    date_from = _parse_date(params.date_from)
    date_to = _parse_date(params.date_to)
    
    selected = select_day_ahead_forecasts(forecasts, date_from, date_to, config)
    aligned = align_actuals_and_forecasts(actuals, selected)
    
    cutoff_config = {
        "hour": params.cutoff_hour,
        "minute": params.cutoff_minute,
        "timezone": params.timezone,
    }
    
    analytics = compute_full_analytics(aligned, params.date_from, params.date_to, cutoff_config)
    
    return _analytics_to_schema(analytics)