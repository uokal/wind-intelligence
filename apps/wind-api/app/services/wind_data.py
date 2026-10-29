from datetime import datetime, timedelta, timezone
from typing import List, Tuple, Dict, Any

from app.clients.elexon import ElexonClient
from app.schemas.wind import (
    ActualGenerationRecord,
    ForecastGenerationRecord,
    CoverageResponse,
)


def _parse_utc(dt_str: str) -> datetime:
    """Parse ISO datetime string to UTC-aware datetime."""
    # Elexon returns ISO format with 'Z' or offset
    dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _settlement_to_utc(settlement_date: str, settlement_period: int) -> datetime:
    """Convert settlement date (YYYY-MM-DD) and period (1-48) to interval start UTC.
    Settlement periods are in Europe/London local time. For simplicity we treat
    settlement_date as local date and compute local start then convert to UTC.
    """
    import pytz
    local_tz = pytz.timezone("Europe/London")
    # period 1 => 00:00-00:30 local
    local_start = local_tz.localize(
        datetime.strptime(settlement_date, "%Y-%m-%d") + 
        timedelta(minutes=30 * (settlement_period - 1))
    )
    return local_start.astimezone(timezone.utc)


def normalize_actuals(raw_records: List[Dict[str, Any]]) -> Tuple[List[ActualGenerationRecord], Dict[str, int]]:
    """Normalize FUELHH records to ActualGenerationRecord, return (records, stats)."""
    stats = {"total": 0, "invalid": 0, "duplicates": 0}
    seen = set()
    records = []
    for rec in raw_records:
        stats["total"] += 1
        try:
            fuel_type = rec.get("fuelType") or rec.get("FuelType")
            if fuel_type != "WIND":
                continue
            settlement_date = rec.get("settlementDate") or rec.get("SettlementDate")
            period_str = rec.get("settlementPeriod") or rec.get("SettlementPeriod")
            gen_str = rec.get("quantity") or rec.get("Quantity")
            if not settlement_date or not period_str or gen_str is None:
                stats["invalid"] += 1
                continue
            period = int(period_str)
            generation = float(gen_str)
            key = (settlement_date, period)
            if key in seen:
                stats["duplicates"] += 1
                continue
            seen.add(key)
            delivery_start = _settlement_to_utc(settlement_date, period)
            records.append(ActualGenerationRecord(
                delivery_start_utc=delivery_start,
                generation_mw=generation,
                settlement_date=settlement_date,
                settlement_period=period,
            ))
        except Exception:
            stats["invalid"] += 1
    return records, stats


def normalize_forecasts(raw_records: List[Dict[str, Any]]) -> Tuple[List[ForecastGenerationRecord], Dict[str, int]]:
    """Normalize WINDFOR records to ForecastGenerationRecord, keep all versions."""
    stats = {"total": 0, "invalid": 0}
    records = []
    for rec in raw_records:
        stats["total"] += 1
        try:
            settlement_date = rec.get("settlementDate") or rec.get("SettlementDate")
            period_str = rec.get("settlementPeriod") or rec.get("SettlementPeriod")
            pub_str = rec.get("publishTime") or rec.get("PublishTime")
            gen_str = rec.get("generation") or rec.get("Generation") or rec.get("forecastMW")
            if not settlement_date or not period_str or not pub_str or gen_str is None:
                stats["invalid"] += 1
                continue
            period = int(period_str)
            generation = float(gen_str)
            publish_time = _parse_utc(pub_str)
            delivery_start = _settlement_to_utc(settlement_date, period)
            records.append(ForecastGenerationRecord(
                delivery_start_utc=delivery_start,
                publish_time_utc=publish_time,
                generation_mw=generation,
                settlement_date=settlement_date,
                settlement_period=period,
            ))
        except Exception:
            stats["invalid"] += 1
    return records, stats


def compute_coverage(
    date_from: str,
    date_to: str,
    actuals: List[ActualGenerationRecord],
    forecasts: List[ForecastGenerationRecord],
    actual_stats: Dict[str, int],
    forecast_stats: Dict[str, int],
) -> CoverageResponse:
    """Compute coverage metrics for the date range."""
    # Expected intervals: each day 48 periods (ignore clock change for Jan)
    from datetime import datetime
    d0 = datetime.strptime(date_from, "%Y-%m-%d")
    d1 = datetime.strptime(date_to, "%Y-%m-%d")
    days = (d1 - d0).days + 1
    expected = days * 48

    actual_intervals = {(r.settlement_date, r.settlement_period) for r in actuals}
    forecast_intervals = {(r.settlement_date, r.settlement_period) for r in forecasts}
    forecast_versions = len(forecasts)

    missing_actual = expected - len(actual_intervals)
    missing_forecast = expected - len(forecast_intervals)

    actual_cov = (len(actual_intervals) / expected * 100) if expected else 0.0
    forecast_cov = (len(forecast_intervals) / expected * 100) if expected else 0.0

    return CoverageResponse(
        date_from=date_from,
        date_to=date_to,
        expected_intervals=expected,
        actual_intervals=len(actual_intervals),
        forecast_intervals=len(forecast_intervals),
        forecast_versions=forecast_versions,
        missing_actual_intervals=max(0, missing_actual),
        missing_forecast_intervals=max(0, missing_forecast),
        duplicate_actual_records=actual_stats.get("duplicates", 0),
        invalid_actual_records=actual_stats.get("invalid", 0),
        invalid_forecast_records=forecast_stats.get("invalid", 0),
        actual_coverage_pct=round(actual_cov, 2),
        forecast_coverage_pct=round(forecast_cov, 2),
    )


async def fetch_and_normalize(
    client: ElexonClient,
    date_from: str,
    date_to: str,
) -> Tuple[List[ActualGenerationRecord], List[ForecastGenerationRecord], CoverageResponse]:
    """High-level fetch for a date range."""
    actual_raw = await client.get_fuelhh(date_from, date_to)
    forecast_raw = await client.get_windfor(date_from, date_to)

    actuals, actual_stats = normalize_actuals(actual_raw)
    forecasts, forecast_stats = normalize_forecasts(forecast_raw)

    coverage = compute_coverage(date_from, date_to, actuals, forecasts, actual_stats, forecast_stats)
    return actuals, forecasts, coverage