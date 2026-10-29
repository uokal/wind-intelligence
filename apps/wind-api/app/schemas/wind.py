from datetime import datetime
from typing import List
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