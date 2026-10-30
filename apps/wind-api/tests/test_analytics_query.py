from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.api.routes import analytics
from app.main import app


@pytest.mark.parametrize("endpoint", ["accuracy", "timeseries", "day-ahead"])
def test_analytics_honors_public_date_and_cutoff_filters(monkeypatch, endpoint):
    fetch = AsyncMock(return_value=([], [], {}))
    monkeypatch.setattr(analytics, "fetch_and_normalize", fetch)
    with TestClient(app) as client:
        response = client.get(
            f"/api/v1/analytics/{endpoint}",
            params={"from": "2026-01-02", "to": "2026-01-03",
                    "cutoff_hour": 10, "cutoff_minute": 30, "timezone": "UTC"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["date_from"] == "2026-01-02"
    assert body["date_to"] == "2026-01-03"
    assert body["cutoff_config"] == {"hour": 10, "minute": 30, "timezone": "UTC"}
    assert fetch.await_args.args[1:] == ("2026-01-02", "2026-01-03")
