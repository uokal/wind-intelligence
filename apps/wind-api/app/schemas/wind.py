from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator, ConfigDict


class ActualGenerationRecord(BaseModel):
    """Normalized actual wind generation record."""
    model_config = ConfigDict(extra="forbid")
    
    delivery_start_utc: datetime = Field(..., description="Delivery interval start in UTC")
    generation_mw: float = Field(..., ge=0, description="Generation in MW")
    settlement_date: str = Field(..., description="Settlement date (YYYY-MM-DD)")
    settlement_period: int = Field(..., ge=1, le=50, description="Half-hour settlement period")
    source_dataset: str = Field(default="FUELHH")
    fuel_type: str = Field(default="WIND")

    @field_validator('generation_mw', mode='before')
    @classmethod
    def _parse_float(cls, v):
        if isinstance(v, str):
            return float(v)
        return v


class ForecastGenerationRecord(BaseModel):
    """Normalized forecast wind generation record (one version)."""
    model_config = ConfigDict(extra="forbid")
    
    delivery_start_utc: datetime = Field(..., description="Delivery interval start in UTC")
    publish_time_utc: datetime = Field(..., description="Forecast publication timestamp in UTC")
    generation_mw: float = Field(..., ge=0, description="Forecast generation in MW")
    settlement_date: str = Field(..., description="Settlement date (YYYY-MM-DD)")
    settlement_period: int = Field(..., ge=1, le=50, description="Half-hour settlement period")
    source_dataset: str = Field(default="WINDFOR")

    @field_validator('generation_mw', mode='before')
    @classmethod
    def _parse_float(cls, v):
        if isinstance(v, str):
            return float(v)
        return v


class ActualsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    
    date_from: str
    date_to: str
    interval_count: int
    unit: str = "MW"
    source_dataset: str = "FUELHH"
    records: List[ActualGenerationRecord]


class ForecastsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    
    date_from: str
    date_to: str
    interval_count: int
    version_count: int
    unit: str = "MW"
    source_dataset: str = "WINDFOR"
    records: List[ForecastGenerationRecord]


class CoverageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    
    date_from: str
    date_to: str
    expected_intervals: int
    actual_intervals: int
    forecast_intervals: int
    forecast_versions: int
    missing_actual_intervals: int
    missing_forecast_intervals: int
    duplicate_actual_records: int
    invalid_actual_records: int
    invalid_forecast_records: int
    actual_coverage_pct: float
    forecast_coverage_pct: float


class SelectedForecastRecord(BaseModel):
    """Day-ahead selected forecast for a delivery interval."""
    model_config = ConfigDict(extra="forbid")
    
    delivery_start_utc: datetime
    settlement_date: str
    settlement_period: int
    forecast_generation_mw: float
    forecast_publish_time_utc: datetime
    decision_cutoff_utc: datetime
    forecast_age_hours: float
    selection_status: str


class DayAheadForecastsResponse(BaseModel):
    """Response for day-ahead forecast selection endpoint."""
    model_config = ConfigDict(extra="forbid")
    
    date_from: str
    date_to: str
    interval_count: int
    cutoff_config: dict
    methodology: dict
    records: List[SelectedForecastRecord]


class AlignedRecord(BaseModel):
    """Actual vs forecast aligned record with error calculations."""
    model_config = ConfigDict(extra="forbid")
    
    delivery_start_utc: datetime
    settlement_date: str
    settlement_period: int
    actual_generation_mw: Optional[float] = None
    forecast_generation_mw: Optional[float] = None
    forecast_publish_time_utc: Optional[datetime] = None
    decision_cutoff_utc: datetime
    error_mw: Optional[float] = None
    absolute_error_mw: Optional[float] = None
    percentage_error: Optional[float] = None
    alignment_status: str


class TimeSeriesResponse(BaseModel):
    """Time-series response with actuals, forecasts, and errors."""
    model_config = ConfigDict(extra="forbid")
    
    date_from: str
    date_to: str
    interval_count: int
    cutoff_config: dict
    records: List[AlignedRecord]


class AccuracyMetricsResponse(BaseModel):
    """Core accuracy metrics."""
    model_config = ConfigDict(extra="forbid")
    
    mae_mw: float
    rmse_mw: float
    mean_error_mw: float
    mape_percent: Optional[float] = None
    mape_excluded_count: int
    mape_included_count: int


class DirectionalMetricsResponse(BaseModel):
    """Over/under estimation metrics."""
    model_config = ConfigDict(extra="forbid")
    
    overestimation_count: int
    underestimation_count: int
    exact_match_count: int
    overestimation_volume_mw: float
    underestimation_volume_mw: float
    overestimation_frequency_pct: float
    underestimation_frequency_pct: float


class DistributionMetricsResponse(BaseModel):
    """Error distribution metrics."""
    model_config = ConfigDict(extra="forbid")
    
    max_absolute_error_mw: float
    median_absolute_error_mw: float
    p90_absolute_error_mw: float
    p95_absolute_error_mw: float
    p99_absolute_error_mw: float


class CoverageMetricsResponse(BaseModel):
    """Data coverage metrics."""
    model_config = ConfigDict(extra="forbid")
    
    total_evaluated_intervals: int
    matched_intervals: int
    missing_forecast_intervals: int
    missing_actual_intervals: int
    evaluation_coverage_pct: float


class BusinessInsightsResponse(BaseModel):
    """Business interpretation insights."""
    model_config = ConfigDict(extra="forbid")
    
    systematic_bias: str
    bias_magnitude_mw: float
    bias_direction: str
    higher_error_periods: List[str]
    key_finding: str
    caveats: List[str]


class AnalyticsResponse(BaseModel):
    """Complete analytics response."""
    model_config = ConfigDict(extra="forbid")
    
    date_from: str
    date_to: str
    methodology: dict
    cutoff_config: dict
    dataset_provenance: dict
    accuracy_metrics: AccuracyMetricsResponse
    directional_metrics: DirectionalMetricsResponse
    distribution_metrics: DistributionMetricsResponse
    coverage_metrics: CoverageMetricsResponse
    business_insights: BusinessInsightsResponse