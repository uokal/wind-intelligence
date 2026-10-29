import os
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
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
    # period 1 = 00:00-00:30 local
    period = local_dt.hour * 2 + (local_dt.minute // 30) + 1
    return settlement_date, period


class ElexonClient:
    """Async client for Elexon FUELHH and WINDFOR datasets using the official Insights API.
    Falls back to legacy api.bmreports.com if needed (not implemented here).
    """

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.api_key = api_key or ELEXON_API_KEY
        self.base_url = base_url or ELEXON_API_BASE
        self.timeout = timeout or REQUEST_TIMEOUT
        # API key is optional for the public Insights API
        if not self.api_key:
            logger.info("Elexon API key not set; using public endpoint (rate limited)")

    @retry(
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(MAX_RETRIES),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        reraise=True,
    )
    async def _get(self, dataset: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generic GET for dataset endpoints. Maps dataset to official Insights API endpoint."""
        endpoint_map = {
            "FUELHH": "/datasets/FUELHH/stream",
            "WINDFOR": "/datasets/WINDFOR/stream",
        }
        endpoint = endpoint_map.get(dataset)
        if not endpoint:
            raise ElexonClientError(f"Unknown dataset: {dataset}")
        url = f"{self.base_url}{endpoint}"
        # API key can be passed as query param if provided
        if self.api_key:
            params["apikey"] = self.api_key
        logger.debug("Requesting %s with params %s", url, params)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()

    async def get_fuelhh(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetch FUELHH (actual generation) for date range inclusive.
        Returns list of dicts with keys: settlementDate, settlementPeriod, fuelType, quantity (MW).
        """
        params = {"start": from_date, "end": to_date}
        raw = await self._get("FUELHH", params)
        records = []
        for entry in raw:
            # Keep only wind
            if entry.get("fuelType") != "WIND":
                continue
            records.append({
                "settlementDate": entry.get("settlementDate"),
                "settlementPeriod": entry.get("settlementPeriod"),
                "fuelType": entry.get("fuelType"),
                "quantity": entry.get("generation"),
            })
        return records

    async def get_windfor(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetch WINDFOR (forecast) for date range inclusive.
        Returns list of dicts with keys: settlementDate, settlementPeriod, publishTime, generation (MW).
        """
        params = {"start": from_date, "end": to_date}
        raw = await self._get("WINDFOR", params)
        records = []
        for entry in raw:
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