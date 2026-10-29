import os
import logging
from typing import List, Dict, Any, Optional
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)

ELEXON_API_BASE = os.getenv("ELEXON_API_BASE", "https://api.bmreports.com/BMRS")
ELEXON_API_KEY = os.getenv("ELEXON_API_KEY", "")
REQUEST_TIMEOUT = float(os.getenv("ELEXON_REQUEST_TIMEOUT", "30.0"))
MAX_RETRIES = int(os.getenv("ELEXON_MAX_RETRIES", "3"))


class ElexonClientError(Exception):
    """Raised when Elexon API returns an error or unexpected format."""
    pass


class ElexonClient:
    """Thin async client for Elexon BMRS FUELHH and WINDFOR datasets."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.api_key = api_key or ELEXON_API_KEY
        self.base_url = base_url or ELEXON_API_BASE
        self.timeout = timeout or REQUEST_TIMEOUT
        if not self.api_key:
            logger.warning("Elexon API key not set; requests will fail")

    @retry(
        wait=wait_exponential(multiplier=1, min=1, max=10),
        stop=stop_after_attempt(MAX_RETRIES),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
        reraise=True,
    )
    async def _get(self, dataset: str, params: Dict[str, Any]) -> httpx.Response:
        url = f"{self.base_url}/{dataset}/v1"
        q = {**params, "APIKey": self.api_key, "ServiceType": "xml"}
        logger.debug("Requesting %s with params %s", url, {k: v for k, v in q.items() if k != "APIKey"})
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(url, params=q)
            resp.raise_for_status()
            return resp

    async def get_fuelhh(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetch FUELHH (actual generation) for date range inclusive."""
        params = {"FromDate": from_date, "ToDate": to_date}
        resp = await self._get("FUELHH", params)
        return self._parse_xml_to_records(resp.text)

    async def get_windfor(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetch WINDFOR (forecast) for date range inclusive."""
        params = {"FromDate": from_date, "ToDate": to_date}
        resp = await self._get("WINDFOR", params)
        return self._parse_xml_to_records(resp.text)

    @staticmethod
    def _parse_xml_to_records(xml_text: str) -> List[Dict[str, Any]]:
        """Parse Elexon XML response into list of dicts (generic)."""
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_text)
        records = []
        for item in root.findall(".//item"):
            record = {}
            for child in item:
                record[child.tag] = child.text
            records.append(record)
        return records