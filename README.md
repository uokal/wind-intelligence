# Wind Power Forecast Analytics

Professional UK wind generation forecast analytics dashboard for day‑ahead electricity procurement decisions.

## Technology Stack
- **Monorepo:** Nx 23.1 (pnpm)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS + Recharts (later)
- **Backend:** Python 3.12 + FastAPI + Pydantic
- **Containerisation:** Docker + Docker Compose
- **Testing:** Vitest (frontend) + Pytest (backend)
- **CI/CD:** GitHub Actions (planned)

## Workspace Structure
```
wind-intelligence/
├─ apps/
│  ├─ wind-web/          # React + Vite dashboard
│  └─ wind-api/          # FastAPI service
├─ libs/                 # (future shared libraries)
├─ docker-compose.yml
├─ docs/                 # Architecture & methodology docs
└─ README.md
```

## Prerequisites
- Node ≥ 20, pnpm ≥ 8
- Python 3.12 (or Docker)
- Docker & Docker Compose (for containerised run)

## Local Development
```bash
# Install JS deps
pnpm install

# Start frontend (Vite) on http://localhost:4200
pnpm exec nx serve wind-web

# Start backend (FastAPI) on http://localhost:8000
pnpm exec nx serve wind-api
```

## Docker
```bash
docker compose up --build
# Frontend → http://localhost
# Backend  → http://localhost:8000
```

## Testing
```bash
# Frontend
pnpm exec nx test wind-web

# Backend (inside container or local venv)
pnpm exec nx test wind-api
```

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost` | Base URL for API calls from frontend |
| `BACKEND_CORS_ORIGINS` | `["http://localhost"]` | CORS origins for FastAPI |
| `ELEXON_API_KEY` | *(required)* | Elexon Portal API key |
| `ELEXON_API_BASE` | `https://api.bmreports.com/BMRS` | Elexon API base URL |
| `ELEXON_REQUEST_TIMEOUT` | `30.0` | Request timeout in seconds |
| `ELEXON_MAX_RETRIES` | `3` | Maximum retry attempts |

Copy `.env.example` to `.env` and adjust.

## API Endpoints (Task 03)

All endpoints are versioned under `/api/v1`.

### GET `/api/v1/wind/actuals`
Retrieve actual wind generation (FUELHH, filtered to WIND fuel type).

**Query Parameters:**
- `from` (required): Start date YYYY-MM-DD
- `to` (required): End date YYYY-MM-DD

**Response:**
```json
{
  "date_from": "2026-01-01",
  "date_to": "2026-01-31",
  "interval_count": 1488,
  "unit": "MW",
  "source_dataset": "FUELHH",
  "records": [
    {
      "delivery_start_utc": "2026-01-01T00:00:00+00:00",
      "generation_mw": 5234.5,
      "settlement_date": "2026-01-01",
      "settlement_period": 1,
      "source_dataset": "FUELHH",
      "fuel_type": "WIND"
    }
  ]
}
```

### GET `/api/v1/wind/forecasts`
Retrieve all wind forecast versions (WINDFOR).

**Query Parameters:**
- `from` (required): Start date YYYY-MM-DD
- `to` (required): End date YYYY-MM-DD

**Response:**
```json
{
  "date_from": "2026-01-01",
  "date_to": "2026-01-31",
  "interval_count": 1488,
  "version_count": 4500,
  "unit": "MW",
  "source_dataset": "WINDFOR",
  "records": [
    {
      "delivery_start_utc": "2026-01-01T00:00:00+00:00",
      "publish_time_utc": "2025-12-31T10:00:00+00:00",
      "generation_mw": 5200.0,
      "settlement_date": "2026-01-01",
      "settlement_period": 1,
      "source_dataset": "WINDFOR"
    }
  ]
}
```

### GET `/api/v1/wind/coverage`
Retrieve data quality and coverage metrics for a date range.

**Query Parameters:**
- `from` (required): Start date YYYY-MM-DD
- `to` (required): End date YYYY-MM-DD

**Response:**
```json
{
  "date_from": "2026-01-01",
  "date_to": "2026-01-31",
  "expected_intervals": 1488,
  "actual_intervals": 1488,
  "forecast_intervals": 1488,
  "forecast_versions": 4500,
  "missing_actual_intervals": 0,
  "missing_forecast_intervals": 0,
  "duplicate_actual_records": 0,
  "invalid_actual_records": 0,
  "invalid_forecast_records": 0,
  "actual_coverage_pct": 100.0,
  "forecast_coverage_pct": 100.0
}
```

## API Documentation
When the backend runs, interactive OpenAPI docs are at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Current Implementation Status (Task 03)
- ✅ Nx workspace with two apps (`wind-web`, `wind-api`)
- ✅ React + Vite + Tailwind dashboard with sidebar, top‑nav, dashboard page
- ✅ FastAPI health endpoint (`GET /api/v1/health`) with CORS & structured logging
- ✅ Dockerfiles (multi‑stage) and `docker-compose.yml`
- ✅ Basic Vitest component tests & Pytest health tests
- ✅ Frontend ↔ Backend health‑check integration (shows connected/unavailable)
- ✅ Elexon API client with retry/backoff (`app/clients/elexon.py`)
- ✅ FUELHH actual generation normalization (WIND filter, MW units, UTC timestamps)
- ✅ WINDFOR forecast normalization (multiple versions preserved, publishTime UTC)
- ✅ Data quality & coverage service (`app/services/wind_data.py`)
- ✅ Versioned API routes: `/api/v1/wind/actuals`, `/api/v1/wind/forecasts`, `/api/v1/wind/coverage`
- ✅ Comprehensive Pytest suite (40 tests) covering filtering, parsing, duplicates, coverage, errors
- ✅ Test fixtures for FUELHH and WINDFOR XML responses
- ✅ Ruff linting clean, Pydantic V2 validators

## AI Disclosure
This project was developed with AI assistance (Claude/Opencode) for a technical evaluation. All architectural decisions, code review, and validation performed by human.

## License
MIT