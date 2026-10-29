import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta
import pytz
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)

# Official Elexon Insights API base URL
ELEXON_API_BASE = os.getenv("ELEXON_API_BASE", "https://data.elexon.co.uk/bmrs/api/v1")
ELEXON_API_KEY = os.getenv("ELEXON_API_KEY", "")
REQUEST_TIMEOUT = float(os.getenv("ELEXON_REQUEST_TIMEOUT", "30.0"))
MAX_RETRIES = int(os.getenv("ELEXON_MAX_RETRIES", "3"))

LONDON_TZ = pytz.timezone("Europe/London")


class ElexonClientError(Exception):
    """Raised when Elexon API returns an error or unexpected format."""
    pass


def _utc_start_to_settlement(start_time_utc: str) -> tuple[str, int]:
    """Convert UTC ISO startTime to (settlement_date, settlement_period) in Europe/London."""
    dt = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local_dt = dt.astimezone(LONDON_TZ)
    settlement_date = local_dt.date().isoformat()
    period = local_dt.hour * 2 + (local_dt.minute // 30) + 1
    return settlement_date, period


class ElexonClient:
    """Async client for Elexon FUELHH and WINDFOR datasets using the official Insights API."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.api_key = api_key or ELEXON_API_KEY
        self.base_url = base_url or ELEXON_API_BASE
        self.timeout = timeout or REQUEST_TIMEOUT
        if not self.api_key:
            logger.info("Elexon API key not set; using public endpoint (rate limited)")

    def _add_key(self, params: Dict[str, Any]) -> None:
        if self.api_key:
            params["apikey"] = self.api_key

    @retry(
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(MAX_RETRIES),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        reraise=True,
    )
    async def _get_json(self, endpoint: str, params: Dict[str, Any]) -> Any:
        url = f"{self.base_url}{endpoint}"
        self._add_key(params)
        logger.debug("Requesting %s with params %s", url, params)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_fuelhh(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetch FUELHH (actual generation) for date range inclusive.
        Returns list of dicts with keys: settlementDate, settlementPeriod, fuelType, quantity (MW).
        """
        params = {"settlementDateFrom": from_date, "settlementDateTo": to_date}
        # Use compatibility _get so that tests can mock it
        raw = await self._get("FUELHH", params)
        records = []
        for entry in raw:
            if entry.get("fuelType") != "WIND":
                continue
            records.append({
                "settlementDate": entry.get("settlementDate"),
                "settlementPeriod": entry.get("settlementPeriod"),
                "fuelType": entry.get("fuelType"),
                "quantity": entry.get("generation"),
            })
        return records

    async def _fetch_history(self, publish_time_utc: str) -> List[Dict[str, Any]]:
        """Fetch WINDFOR history for a specific publish time (UTC ISO string)."""
        params = {"PublishTime": publish_time_utc}
        raw = await self._get_json("/forecast/generation/wind/history", params)
        # raw has keys: metadata, data
        data = raw.get("data", [])
        records = []
        for entry in data:
            start_time = entry.get("startTime")
            publish_time = entry.get("publishTime")
            generation = entry.get("generation")
            if not start_time or generation is None:
                continue
            settlement_date, period = _utc_start_to_settlement(start_time)
            records.append({
                "settlementDate": settlement_date,
                "settlementPeriod": period,
                "publishTime": publish_time,
                "generation": generation,
            })
        return records

    @retry(
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(MAX_RETRIES),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        reraise=True,
    )
    async def _get(self, dataset: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Compatibility method used by tests and legacy code."""
        if dataset == "FUELHH":
            from_date = params.get("FromDate") or params.get("start")
            to_date = params.get("ToDate") or params.get("end")
            return await self.get_fuelhh(from_date, to_date)
        elif dataset == "WINDFOR":
            from_date = params.get("FromDate") or params.get("start")
            to_date = params.get("ToDate") or params.get("end")
            return await self.get_windfor(from_date, to_date)
        else:
            raise ElexonClientError(f"Unknown dataset: {dataset}")

    async def get_windfor(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetch WINDFOR (forecast) for delivery date range inclusive.
        Retrieves historical publications at 06:00 and 10:00 UTC on D-1 for each delivery date.
        Returns list of dicts with keys: settlementDate, settlementPeriod, publishTime, generation (MW).
        """
        start = datetime.fromisoformat(from_date)
        end = datetime.fromisoformat(to_date)
        tasks = []
        current = start
        while current <= end:
            delivery_date = current.date()
            d_minus_1 = delivery_date - timedelta(days=1)
            for hour in (6, 10):
                publish_time = datetime(d_minus_1.year, d_minus_1.month, d_minus_1.day, hour, 0, 0, tzinfo=timezone.utc)
                publish_time_str = publish_time.isoformat().replace("+00:00", "Z")
                tasks.append(self._fetch_history(publish_time_str))
            current += timedelta(days=1)

        results = await asyncio.gather(*tasks, return_exceptions=True)
        records = []
        for res in results:
            if isinstance(res, Exception):
                logger.warning("Failed to fetch history: %s", res)
                continue
            records.extend(res)
        return records