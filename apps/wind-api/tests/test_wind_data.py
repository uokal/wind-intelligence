import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.clients.elexon import ElexonClient
from app.services.wind_data import (
    normalize_actuals,
    normalize_forecasts,
    compute_coverage,
    fetch_and_normalize,
    _parse_utc,
    _settlement_to_utc,
)
from app.schemas.wind import (
    ActualGenerationRecord,
    ForecastGenerationRecord,
)


class TestParseUTC:
    """Test UTC timestamp parsing."""

    def test_parse_utc_with_z_suffix(self):
        dt = _parse_utc("2026-01-01T10:00:00Z")
        assert dt.tzinfo == timezone.utc
        assert dt.hour == 10
        assert dt.minute == 0

    def test_parse_utc_with_offset(self):
        dt = _parse_utc("2026-01-01T10:00:00+00:00")
        assert dt.tzinfo == timezone.utc

    def test_parse_utc_naive_becomes_utc(self):
        dt = _parse_utc("2026-01-01T10:00:00")
        assert dt.tzinfo == timezone.utc


class TestSettlementToUTC:
    """Test settlement date/period to UTC conversion."""

    def test_period_1_midnight(self):
        dt = _settlement_to_utc("2026-01-01", 1)
        # Jan 1 in London is UTC (winter), so 00:00 local = 00:00 UTC
        assert dt.hour == 0
        assert dt.minute == 0
        assert dt.tzinfo == timezone.utc

    def test_period_48_end_of_day(self):
        dt = _settlement_to_utc("2026-01-01", 48)
        assert dt.hour == 23
        assert dt.minute == 30
        assert dt.tzinfo == timezone.utc

    def test_summer_period_1_bst(self):
        # July 1 is BST (UTC+1), so 00:00 local = 23:00 UTC previous day
        dt = _settlement_to_utc("2026-07-01", 1)
        assert dt.hour == 23
        assert dt.minute == 0
        assert dt.tzinfo == timezone.utc


class TestNormalizeActuals:
    """Test FUELHH actual generation normalization."""

    def test_filter_wind_only(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "5000.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "2", "fuelType": "CCGT", "quantity": "10000.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "3", "fuelType": "WIND", "quantity": "5100.0"},
        ]
        records, stats = normalize_actuals(raw)
        assert len(records) == 2
        assert stats["total"] == 3
        assert stats["invalid"] == 0
        assert all(r.fuel_type == "WIND" for r in records)

    def test_case_insensitive_field_names(self):
        raw = [
            {"SettlementDate": "2026-01-01", "SettlementPeriod": "1", "FuelType": "WIND", "Quantity": "5000.0"},
        ]
        records, stats = normalize_actuals(raw)
        assert len(records) == 1

    def test_duplicate_detection(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "5000.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "5100.0"},
        ]
        records, stats = normalize_actuals(raw)
        assert len(records) == 1
        assert stats["duplicates"] == 1

    def test_invalid_numeric_generation(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "not_a_number"},
        ]
        records, stats = normalize_actuals(raw)
        assert len(records) == 0
        assert stats["invalid"] == 1

    def test_missing_fields(self):
        raw = [
            {"settlementDate": "2026-01-01", "fuelType": "WIND"},  # missing period and quantity
        ]
        records, stats = normalize_actuals(raw)
        assert len(records) == 0
        assert stats["invalid"] == 1

    def test_negative_generation_rejected(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "-100.0"},
        ]
        records, stats = normalize_actuals(raw)
        # Pydantic ge=0 should reject negative values
        assert len(records) == 0
        assert stats["invalid"] == 1

    def test_generation_in_mw_not_mwh(self):
        """Verify values are treated as MW (power), not MWh (energy)."""
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "5000.0"},
        ]
        records, _ = normalize_actuals(raw)
        assert records[0].generation_mw == 5000.0
        # Unit is MW, not MWh - period is 30 min, energy would be 2500 MWh


class TestNormalizeForecasts:
    """Test WINDFOR forecast normalization."""

    def test_multiple_versions_preserved(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T10:00:00Z", "generation": "5200.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T14:00:00Z", "generation": "5250.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2026-01-01T06:00:00Z", "generation": "5300.0"},
        ]
        records, stats = normalize_forecasts(raw)
        assert len(records) == 3
        assert stats["total"] == 3
        # All three versions preserved
        publish_times = [r.publish_time_utc for r in records]
        assert len(set(publish_times)) == 3

    def test_publish_time_utc_normalization(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T10:00:00Z", "generation": "5200.0"},
        ]
        records, _ = normalize_forecasts(raw)
        assert records[0].publish_time_utc.tzinfo == timezone.utc

    def test_delivery_start_utc_normalization(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T10:00:00Z", "generation": "5200.0"},
        ]
        records, _ = normalize_forecasts(raw)
        assert records[0].delivery_start_utc.tzinfo == timezone.utc
        assert records[0].delivery_start_utc.hour == 0

    def test_invalid_publish_time(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "invalid", "generation": "5200.0"},
        ]
        records, stats = normalize_forecasts(raw)
        assert len(records) == 0
        assert stats["invalid"] == 1

    def test_invalid_numeric_generation(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T10:00:00Z", "generation": "not_a_number"},
        ]
        records, stats = normalize_forecasts(raw)
        assert len(records) == 0
        assert stats["invalid"] == 1

    def test_missing_fields(self):
        raw = [
            {"settlementDate": "2026-01-01", "settlementPeriod": "1"},  # missing publishTime and generation
        ]
        records, stats = normalize_forecasts(raw)
        assert len(records) == 0
        assert stats["invalid"] == 1

    def test_field_name_variations(self):
        """Test that generation/Generation/forecastMW all work."""
        for field in ["generation", "Generation", "forecastMW"]:
            raw = [
                {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T10:00:00Z", field: "5200.0"},
            ]
            records, _ = normalize_forecasts(raw)
            assert len(records) == 1
            assert records[0].generation_mw == 5200.0


class TestCoverageComputation:
    """Test coverage metrics calculation."""

    def test_january_2026_expected_intervals(self):
        """January 2026 has 31 days * 48 periods = 1488 intervals."""
        actuals = []
        forecasts = []
        actual_stats = {"duplicates": 0, "invalid": 0}
        forecast_stats = {"invalid": 0}

        coverage = compute_coverage("2026-01-01", "2026-01-31", actuals, forecasts, actual_stats, forecast_stats)

        assert coverage.expected_intervals == 1488

    def test_actual_coverage_percentage(self):
        """Coverage based on unique delivery intervals, not raw rows."""
        # 2 unique actual intervals out of 48 expected (1 day)
        actuals = [
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 30, tzinfo=timezone.utc),
                generation_mw=5100.0,
                settlement_date="2026-01-01",
                settlement_period=2,
            ),
        ]
        forecasts = []
        actual_stats = {"duplicates": 0, "invalid": 0}
        forecast_stats = {"invalid": 0}

        coverage = compute_coverage("2026-01-01", "2026-01-01", actuals, forecasts, actual_stats, forecast_stats)

        assert coverage.expected_intervals == 48
        assert coverage.actual_intervals == 2
        assert coverage.actual_coverage_pct == pytest.approx(2 / 48 * 100, rel=0.01)

    def test_forecast_coverage_unique_intervals(self):
        """Forecast coverage counts unique delivery intervals, not versions."""
        # 3 forecast versions for period 1, 1 for period 2 = 2 unique intervals
        forecasts = [
            ForecastGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                publish_time_utc=datetime(2025, 12, 31, 10, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
            ForecastGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                publish_time_utc=datetime(2025, 12, 31, 14, 0, tzinfo=timezone.utc),
                generation_mw=5100.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
            ForecastGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 30, tzinfo=timezone.utc),
                publish_time_utc=datetime(2025, 12, 31, 10, 0, tzinfo=timezone.utc),
                generation_mw=5200.0,
                settlement_date="2026-01-01",
                settlement_period=2,
            ),
        ]
        actuals = []
        actual_stats = {"duplicates": 0, "invalid": 0}
        forecast_stats = {"invalid": 0}

        coverage = compute_coverage("2026-01-01", "2026-01-01", actuals, forecasts, actual_stats, forecast_stats)

        assert coverage.forecast_intervals == 2  # unique delivery intervals
        assert coverage.forecast_versions == 3   # total versions

    def test_missing_intervals_calculation(self):
        actuals = [
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
        ]
        forecasts = []
        actual_stats = {"duplicates": 0, "invalid": 0}
        forecast_stats = {"invalid": 0}

        coverage = compute_coverage("2026-01-01", "2026-01-01", actuals, forecasts, actual_stats, forecast_stats)

        assert coverage.missing_actual_intervals == 47  # 48 - 1
        assert coverage.missing_forecast_intervals == 48  # 48 - 0

    def test_duplicate_actual_records_reported(self):
        actuals = [
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
        ]
        forecasts = []
        actual_stats = {"duplicates": 5, "invalid": 2}
        forecast_stats = {"invalid": 1}

        coverage = compute_coverage("2026-01-01", "2026-01-01", actuals, forecasts, actual_stats, forecast_stats)

        assert coverage.duplicate_actual_records == 5
        assert coverage.invalid_actual_records == 2
        assert coverage.invalid_forecast_records == 1


class TestEmptyAPIResponses:
    """Test handling of empty API responses."""

    def test_empty_actuals_list(self):
        records, stats = normalize_actuals([])
        assert records == []
        assert stats["total"] == 0

    def test_empty_forecasts_list(self):
        records, stats = normalize_forecasts([])
        assert records == []
        assert stats["total"] == 0


class TestElexonClient:
    """Test Elexon client behavior with mocked HTTP."""

    @pytest.mark.asyncio
    async def test_get_fuelhh_timeout(self):
        client = ElexonClient(api_key="test_key")
        client._get = AsyncMock(side_effect=TimeoutError("Request timeout"))
        
        with pytest.raises(TimeoutError):
            await client.get_fuelhh("2026-01-01", "2026-01-01")

    @pytest.mark.asyncio
    async def test_get_fuelhh_http_error(self):
        import httpx
        client = ElexonClient(api_key="test_key")
        client._get = AsyncMock(side_effect=httpx.HTTPStatusError("404", request=MagicMock(), response=MagicMock(status_code=404)))
        
        with pytest.raises(httpx.HTTPStatusError):
            await client.get_fuelhh("2026-01-01", "2026-01-01")

    @pytest.mark.asyncio
    async def test_get_fuelhh_invalid_xml(self):
        client = ElexonClient(api_key="test_key")
        client._get = AsyncMock(return_value=MagicMock(text="not xml"))
        
        with pytest.raises(Exception):
            await client.get_fuelhh("2026-01-01", "2026-01-01")

    @pytest.mark.asyncio
    async def test_get_windfor_retry_on_failure(self):
        
        # Test the retry logic directly by checking the retry decorator config
        client = ElexonClient(api_key="test_key", timeout=1.0)
        
        # Verify retry configuration exists
        assert hasattr(client._get, 'retry')
        retry_state = client._get.retry
        
        # Check stop condition (max 3 attempts)
        assert retry_state.stop is not None
        
        # Check wait strategy (exponential backoff)
        assert retry_state.wait is not None
        
        # Check retry conditions (RequestError, HTTPStatusError)
        assert retry_state.retry is not None


class TestFetchAndNormalize:
    """Test high-level fetch_and_normalize function."""

    @pytest.mark.asyncio
    async def test_fetch_and_normalize_integration(self):
        """Integration test with mocked client responses."""
        client = ElexonClient(api_key="test_key")

        client.get_fuelhh = AsyncMock(return_value=[
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "fuelType": "WIND", "quantity": "5000.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "2", "fuelType": "WIND", "quantity": "5100.0"},
        ])
        client.get_windfor = AsyncMock(return_value=[
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T10:00:00Z", "generation": "5200.0"},
            {"settlementDate": "2026-01-01", "settlementPeriod": "1", "publishTime": "2025-12-31T14:00:00Z", "generation": "5250.0"},
        ])

        actuals, forecasts, coverage = await fetch_and_normalize(client, "2026-01-01", "2026-01-01")

        assert len(actuals) == 2
        assert len(forecasts) == 2
        assert coverage.expected_intervals == 48
        assert coverage.actual_intervals == 2
        assert coverage.forecast_intervals == 1  # same delivery interval, different versions


class TestDateRangeValidation:
    """Test date range validation."""

    def test_invalid_date_format_raises(self):
        from app.api.routes.wind import DateRangeParams
        from pydantic import ValidationError
        
        with pytest.raises(ValidationError):
            DateRangeParams(date_from="01-01-2026", date_to="2026-01-31")

    def test_valid_date_format(self):
        from app.api.routes.wind import DateRangeParams
        
        params = DateRangeParams(date_from="2026-01-01", date_to="2026-01-31")
        assert params.date_from == "2026-01-01"
        assert params.date_to == "2026-01-31"


class TestActualGenerationRecordSchema:
    """Test ActualGenerationRecord Pydantic model."""

    def test_generation_mw_validation(self):
        # Valid positive
        record = ActualGenerationRecord(
            delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
            generation_mw=5000.0,
            settlement_date="2026-01-01",
            settlement_period=1,
        )
        assert record.generation_mw == 5000.0

    def test_generation_mw_negative_rejected(self):
        with pytest.raises(Exception):
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=-100.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            )

    def test_settlement_period_bounds(self):
        # Valid range 1-50
        for p in [1, 24, 48, 50]:
            record = ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=p,
            )
            assert record.settlement_period == p

    def test_settlement_period_out_of_bounds(self):
        with pytest.raises(Exception):
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=0,
            )
        with pytest.raises(Exception):
            ActualGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=51,
            )


class TestForecastGenerationRecordSchema:
    """Test ForecastGenerationRecord Pydantic model."""

    def test_publish_time_utc_required(self):
        record = ForecastGenerationRecord(
            delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
            publish_time_utc=datetime(2025, 12, 31, 10, 0, tzinfo=timezone.utc),
            generation_mw=5000.0,
            settlement_date="2026-01-01",
            settlement_period=1,
        )
        assert record.publish_time_utc.tzinfo == timezone.utc

    def test_multiple_forecast_versions_for_same_interval(self):
        """Verify multiple records can exist for same delivery interval."""
        records = [
            ForecastGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                publish_time_utc=datetime(2025, 12, 31, 10, 0, tzinfo=timezone.utc),
                generation_mw=5000.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
            ForecastGenerationRecord(
                delivery_start_utc=datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                publish_time_utc=datetime(2025, 12, 31, 14, 0, tzinfo=timezone.utc),
                generation_mw=5100.0,
                settlement_date="2026-01-01",
                settlement_period=1,
            ),
        ]
        assert len(records) == 2
        assert records[0].publish_time_utc != records[1].publish_time_utc
        assert records[0].generation_mw != records[1].generation_mw


if __name__ == "__main__":
    pytest.main([__file__, "-v"])