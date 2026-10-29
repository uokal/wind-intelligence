import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_endpoint():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "wind-analytics-api"

def test_root_endpoint():
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["service"] == "wind-analytics-api"