from typing import List, Optional
from dataclasses import dataclass
import math
import statistics

from app.services.forecast_selection import AlignedRecord


@dataclass(frozen=True)
class AccuracyMetrics:
    """Core accuracy metrics with explicit units."""
    mae_mw: float
    rmse_mw: float
    mean_error_mw: float  # Bias (positive = overestimation)
    mape_percent: Optional[float]
    mape_excluded_count: int
    mape_included_count: int


@dataclass(frozen=True)
class DirectionalMetrics:
    """Forecast over/under estimation analysis."""
    overestimation_count: int
    underestimation_count: int
    exact_match_count: int
    overestimation_volume_mw: float  # Sum of positive errors
    underestimation_volume_mw: float  # Sum of negative errors (negative value)
    overestimation_frequency_pct: float
    underestimation_frequency_pct: float


@dataclass(frozen=True)
class DistributionMetrics:
    """Error distribution statistics."""
    max_absolute_error_mw: float
    median_absolute_error_mw: float
    p90_absolute_error_mw: float
    p95_absolute_error_mw: float
    p99_absolute_error_mw: float


@dataclass(frozen=True)
class CoverageMetrics:
    """Data coverage and completeness metrics."""
    total_evaluated_intervals: int
    matched_intervals: int
    missing_forecast_intervals: int
    missing_actual_intervals: int
    evaluation_coverage_pct: float


@dataclass(frozen=True)
class BusinessInsights:
    """Descriptive, evidence-based business interpretation."""
    systematic_bias: str  # "overestimation", "underestimation", "neutral"
    bias_magnitude_mw: float
    bias_direction: str  # "positive", "negative", "zero"
    higher_error_periods: List[str]  # e.g., ["morning_ramp", "evening_ramp"]
    key_finding: str
    caveats: List[str]


@dataclass(frozen=True)
class AnalyticsResponse:
    """Complete analytics response."""
    date_from: str
    date_to: str
    methodology: dict
    cutoff_config: dict
    dataset_provenance: dict
    accuracy_metrics: AccuracyMetrics
    directional_metrics: DirectionalMetrics
    distribution_metrics: DistributionMetrics
    coverage_metrics: CoverageMetrics
    business_insights: BusinessInsights


def compute_accuracy_metrics(aligned_records: List[AlignedRecord]) -> AccuracyMetrics:
    """Compute MAE, RMSE, ME, MAPE from aligned records."""
    matched = [r for r in aligned_records if r.alignment_status == "matched"]
    
    if not matched:
        return AccuracyMetrics(
            mae_mw=0.0,
            rmse_mw=0.0,
            mean_error_mw=0.0,
            mape_percent=None,
            mape_excluded_count=0,
            mape_included_count=0,
        )
    
    errors = [r.error_mw for r in matched]
    abs_errors = [r.absolute_error_mw for r in matched]
    
    mae = statistics.mean(abs_errors)
    rmse = math.sqrt(statistics.mean(e * e for e in errors))
    mean_error = statistics.mean(errors)
    
    # MAPE with zero-actual handling (exclude only actual == 0)
    mape_included = [r for r in matched if r.actual_generation_mw is not None and r.actual_generation_mw > 0]
    mape_excluded_count = len(matched) - len(mape_included)
    
    if mape_included:
        mape_values = [abs(r.percentage_error) for r in mape_included if r.percentage_error is not None]
        mape = statistics.mean(mape_values) if mape_values else None
    else:
        mape = None
    
    return AccuracyMetrics(
        mae_mw=round(mae, 2),
        rmse_mw=round(rmse, 2),
        mean_error_mw=round(mean_error, 2),
        mape_percent=round(mape, 2) if mape is not None else None,
        mape_excluded_count=mape_excluded_count,
        mape_included_count=len(mape_included),
    )


def compute_directional_metrics(aligned_records: List[AlignedRecord]) -> DirectionalMetrics:
    """Compute over/under estimation counts and volumes."""
    matched = [r for r in aligned_records if r.alignment_status == "matched"]
    
    if not matched:
        return DirectionalMetrics(
            overestimation_count=0,
            underestimation_count=0,
            exact_match_count=0,
            overestimation_volume_mw=0.0,
            underestimation_volume_mw=0.0,
            overestimation_frequency_pct=0.0,
            underestimation_frequency_pct=0.0,
        )
    
    total = len(matched)
    over_count = sum(1 for r in matched if r.error_mw is not None and r.error_mw > 0)
    under_count = sum(1 for r in matched if r.error_mw is not None and r.error_mw < 0)
    exact_count = sum(1 for r in matched if r.error_mw is not None and r.error_mw == 0)
    
    over_volume = sum(r.error_mw for r in matched if r.error_mw is not None and r.error_mw > 0)
    under_volume = sum(r.error_mw for r in matched if r.error_mw is not None and r.error_mw < 0)
    
    return DirectionalMetrics(
        overestimation_count=over_count,
        underestimation_count=under_count,
        exact_match_count=exact_count,
        overestimation_volume_mw=round(over_volume, 2),
        underestimation_volume_mw=round(under_volume, 2),
        overestimation_frequency_pct=round(over_count / total * 100, 2) if total > 0 else 0.0,
        underestimation_frequency_pct=round(under_count / total * 100, 2) if total > 0 else 0.0,
    )


def compute_distribution_metrics(aligned_records: List[AlignedRecord]) -> DistributionMetrics:
    """Compute error distribution percentiles."""
    matched = [r for r in aligned_records if r.alignment_status == "matched" and r.absolute_error_mw is not None]
    
    if not matched:
        return DistributionMetrics(
            max_absolute_error_mw=0.0,
            median_absolute_error_mw=0.0,
            p90_absolute_error_mw=0.0,
            p95_absolute_error_mw=0.0,
            p99_absolute_error_mw=0.0,
        )
    
    abs_errors = sorted(r.absolute_error_mw for r in matched)
    
    def percentile(data: List[float], p: float) -> float:
        """Compute percentile using linear interpolation."""
        if not data:
            return 0.0
        k = (len(data) - 1) * p
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return data[int(f)]
        return data[int(f)] + (k - f) * (data[int(c)] - data[int(f)])
    
    return DistributionMetrics(
        max_absolute_error_mw=round(max(abs_errors), 2),
        median_absolute_error_mw=round(percentile(abs_errors, 0.5), 2),
        p90_absolute_error_mw=round(percentile(abs_errors, 0.9), 2),
        p95_absolute_error_mw=round(percentile(abs_errors, 0.95), 2),
        p99_absolute_error_mw=round(percentile(abs_errors, 0.99), 2),
    )


def compute_coverage_metrics(aligned_records: List[AlignedRecord]) -> CoverageMetrics:
    """Compute coverage metrics."""
    total = len(aligned_records)
    matched = sum(1 for r in aligned_records if r.alignment_status == "matched")
    missing_forecast = sum(1 for r in aligned_records if r.alignment_status == "missing_forecast")
    missing_actual = sum(1 for r in aligned_records if r.alignment_status == "missing_actual")
    
    return CoverageMetrics(
        total_evaluated_intervals=total,
        matched_intervals=matched,
        missing_forecast_intervals=missing_forecast,
        missing_actual_intervals=missing_actual,
        evaluation_coverage_pct=round(matched / total * 100, 2) if total > 0 else 0.0,
    )


def compute_business_insights(
    aligned_records: List[AlignedRecord],
    accuracy: AccuracyMetrics,
    directional: DirectionalMetrics,
    distribution: DistributionMetrics,
) -> BusinessInsights:
    """Generate descriptive business insights from metrics."""
    bias_mw = accuracy.mean_error_mw
    
    if bias_mw > 50:
        systematic_bias = "overestimation"
        bias_direction = "positive"
    elif bias_mw < -50:
        systematic_bias = "underestimation"
        bias_direction = "negative"
    else:
        systematic_bias = "neutral"
        bias_direction = "zero"
    
    # Check for higher error periods (simplified - would need more sophisticated analysis)
    higher_error_periods = []
    if distribution.p90_absolute_error_mw > distribution.median_absolute_error_mw * 2:
        higher_error_periods.append("periods_with_extreme_errors")
    
    # Key finding
    if systematic_bias == "overestimation":
        key_finding = f"Forecasts systematically overestimate wind generation by {abs(bias_mw):.1f} MW on average. Procurement decisions based on these forecasts may lead to over-procurement and balancing purchase costs."
    elif systematic_bias == "underestimation":
        key_finding = f"Forecasts systematically underestimate wind generation by {abs(bias_mw):.1f} MW on average. Procurement decisions may miss cheaper wind generation, leading to opportunity costs."
    else:
        key_finding = "Forecasts show no strong systematic bias. Errors appear symmetrically distributed around zero."
    
    caveats = [
        "Analysis limited to January 2026 (31 days, 1,488 intervals)",
        "Day-ahead cutoff assumption: 12:00 Europe/London on D-1 (EPEX SPOT gate closure)",
        "MAPE excludes intervals with actual generation == 0 MW",
        "Missing actual/forecast intervals excluded from error metrics",
        "Results based on Elexon BMRS FUELHH (actuals) and WINDFOR (forecasts) datasets",
        "No consumer demand data included; wind-only analysis",
    ]
    
    return BusinessInsights(
        systematic_bias=systematic_bias,
        bias_magnitude_mw=abs(bias_mw),
        bias_direction=bias_direction,
        higher_error_periods=higher_error_periods,
        key_finding=key_finding,
        caveats=caveats,
    )


def _expected_intervals(date_from: str, date_to: str) -> int:
    from datetime import datetime
    d0 = datetime.strptime(date_from, "%Y-%m-%d")
    d1 = datetime.strptime(date_to, "%Y-%m-%d")
    days = (d1 - d0).days + 1
    # Assume 48 periods per day (no DST handling for simplicity)
    return days * 48


def compute_full_analytics(
    aligned_records: List[AlignedRecord],
    date_from: str,
    date_to: str,
    cutoff_config: dict,
) -> AnalyticsResponse:
    """Compute complete analytics package."""
    
    accuracy = compute_accuracy_metrics(aligned_records)
    directional = compute_directional_metrics(aligned_records)
    distribution = compute_distribution_metrics(aligned_records)
    coverage = compute_coverage_metrics(aligned_records)
    # Override total_evaluated_intervals with expected intervals based on date range
    expected = _expected_intervals(date_from, date_to)
    coverage = CoverageMetrics(
        total_evaluated_intervals=expected,
        matched_intervals=coverage.matched_intervals,
        missing_forecast_intervals=coverage.missing_forecast_intervals,
        missing_actual_intervals=coverage.missing_actual_intervals,
        evaluation_coverage_pct=round(coverage.matched_intervals / expected * 100, 2) if expected else 0.0,
    )
    insights = compute_business_insights(aligned_records, accuracy, directional, distribution)
    
    methodology = {
        "forecast_selection": "Latest eligible forecast published on or before D-1 12:00 Europe/London",
        "error_sign_convention": "Error = Forecast - Actual (positive = overestimation)",
        "mape_zero_handling": "Exclude intervals where actual == 0 MW",
        "aggregation_level": "Per settlement period (30-min), daily rollup available",
    }
    
    dataset_provenance = {
        "actuals_dataset": "Elexon BMRS FUELHH (fuelType=WIND)",
        "forecasts_dataset": "Elexon BMRS WINDFOR",
        "delivery_date_range": f"{date_from} to {date_to}",
        "expected_intervals": expected,
    }
    
    return AnalyticsResponse(
        date_from=date_from,
        date_to=date_to,
        methodology=methodology,
        cutoff_config=cutoff_config,
        dataset_provenance=dataset_provenance,
        accuracy_metrics=accuracy,
        directional_metrics=directional,
        distribution_metrics=distribution,
        coverage_metrics=coverage,
        business_insights=insights,
    )