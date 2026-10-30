# Wind Power Forecast Analytics

Professional UK wind generation forecast analytics dashboard for day‑ahead electricity procurement decisions.

## Technology Stack
- **Monorepo:** Nx 23.1 (pnpm)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS + Recharts
- **Backend:** Python 3.12 + FastAPI + Pydantic
- **Containerisation:** Docker + Docker Compose
- **Testing:** Vitest (frontend) + Pytest (backend)
- **Deployment:** Vercel (Frontend + Backend as separate projects)

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
- Vercel CLI (for deployment): `npm i -g vercel`

## Local Development
```bash
# Install JS deps
pnpm install

# Start frontend (Vite) on http://localhost:5173
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
| `VITE_API_BASE_URL` | `http://localhost:8000` | Base URL for API calls from frontend |
| `BACKEND_CORS_ORIGINS` | `["http://localhost:5173"]` | CORS origins for FastAPI (JSON array) |
| `ELEXON_API_KEY` | *(optional)* | Elexon Portal API key (public endpoint works without key) |
| `ELEXON_API_BASE` | `https://data.elexon.co.uk/bmrs/api/v1` | Elexon Insights API base URL |
| `ELEXON_REQUEST_TIMEOUT` | `30.0` | Request timeout in seconds |
| `ELEXON_MAX_RETRIES` | `3` | Maximum retry attempts |

> **Note:** The official Elexon Insights API (`https://data.elexon.co.uk/bmrs/api/v1`) provides historical FUELHH and WINDFOR data. The client now uses the official endpoints with correct query parameters (`settlementDateFrom/To` for FUELHH and the `/forecast/generation/wind/history` endpoint for WINDFOR). No API key is required for public access (rate‑limited).

Copy `.env.example` to `.env` and adjust.

## Vercel Deployment

### Two-Project Architecture
This monorepo deploys to **two separate Vercel projects**:
1. **Frontend (wind-web)**: React + Vite static site
2. **Backend (wind-api)**: Python FastAPI serverless functions

### Prerequisites
- Vercel account and CLI: `npm i -g vercel`
- Git repository connected to Vercel (or use `vercel --prod` for manual deploy)

### 1. Deploy Backend (wind-api)
```bash
cd apps/wind-api
vercel
# Follow prompts:
# - Link to existing project or create new: wind-api
# - Root directory: ./apps/wind-api
# - Build command: pip install -r requirements.txt
# - Output directory: (leave empty)
# - Development command: uvicorn app.main:app --reload

# Set environment variables in Vercel dashboard or CLI:
vercel env add BACKEND_CORS_ORIGINS production
# Enter: ["https://your-frontend.vercel.app"]
vercel env add ELEXON_API_KEY production
# Enter your key (or leave empty for public endpoint)
vercel env add ELEXON_API_BASE production
# Enter: https://data.elexon.co.uk/bmrs/api/v1

# Deploy to production
vercel --prod
```
Note the deployed URL (e.g., `https://wind-api.vercel.app`).

### 2. Deploy Frontend (wind-web)
```bash
cd apps/wind-web
vercel
# Follow prompts:
# - Link to existing project or create new: wind-web
# - Root directory: ./apps/wind-web
# - Build command: pnpm install --frozen-lockfile && pnpm nx build wind-web
# - Output directory: dist/apps/wind-web
# - Development command: pnpm nx serve wind-web

# Set environment variables:
vercel env add VITE_API_BASE_URL production
# Enter: https://wind-api.vercel.app (your backend URL from step 1)

# Deploy to production
vercel --prod
```
Note the deployed URL (e.g., `https://wind-web.vercel.app`).

### 3. Update Backend CORS
After frontend deployment, update the backend CORS origin:
```bash
cd apps/wind-api
vercel env rm BACKEND_CORS_ORIGINS production
vercel env add BACKEND_CORS_ORIGINS production
# Enter: ["https://wind-web.vercel.app"]
vercel --prod
```

### 4. Verify Endpoints
- Frontend: `https://wind-web.vercel.app`
- Backend health: `https://wind-api.vercel.app/api/v1/health`
- Analytics: `https://wind-api.vercel.app/api/v1/analytics/accuracy?from=2026-01-01&to=2026-01-31`

## API Endpoints (Task 03)

All endpoints are versioned under `/api/v1`.

### GET `/api/v1/wind/actuals`
Retrieve actual wind generation (FUELHH, filtered to WIND fuel type).

**Query Parameters:**
- `from` (required): Start date YYYY-MM-DD
- `to` (required): End date YYYY-MM-DD

### GET `/api/v1/wind/forecasts`
Retrieve all wind forecast versions (WINDFOR).

**Query Parameters:**
- `from` (required): Start date YYYY-MM-DD
- `to` (required): End date YYYY-MM-DD

### GET `/api/v1/wind/coverage`
Retrieve data quality and coverage metrics for a date range.

**Query Parameters:**
- `from` (required): Start date YYYY-MM-DD
- `to` (required): End date YYYY-MM-DD

## Analytics Endpoints (Task 04)

### GET `/api/v1/analytics/day-ahead`
Get day-ahead selected forecasts for each delivery interval based on procurement cutoff.

**Query Parameters:**
- `from` (optional, default: 2026-01-01): Start date YYYY-MM-DD
- `to` (optional, default: 2026-01-31): End date YYYY-MM-DD
- `cutoff_hour` (optional, default: 12): Decision cutoff hour 0-23 (Europe/London)
- `cutoff_minute` (optional, default: 0): Decision cutoff minute 0-59
- `timezone` (optional, default: Europe/London): Timezone for cutoff

### GET `/api/v1/analytics/timeseries`
Get aligned actual vs forecast time-series with error calculations.

**Query Parameters:** Same as `/day-ahead`

### GET `/api/v1/analytics/accuracy`
Get comprehensive forecast accuracy metrics and business insights.

**Query Parameters:** Same as `/day-ahead`

**Response:** Full `AnalyticsResponse` with:
- `accuracy_metrics`: MAE, RMSE, ME (Bias), MAPE (with zero-actual handling)
- `directional_metrics`: Over/under estimation counts, volumes, frequencies
- `distribution_metrics`: Max, median, P90, P95, P99 absolute errors
- `coverage_metrics`: Matched, missing forecast/actual intervals, coverage %
- `business_insights`: Systematic bias, key finding, caveats

## API Documentation
When the backend runs locally, interactive OpenAPI docs are at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

On Vercel, the OpenAPI schema is available at: `https://wind-api.vercel.app/api/v1/openapi.json`

## Elexon Data Methodology

### Data Sources
- **Actual Generation**: Elexon BMRS `FUELHH` dataset, filtered to `fuelType=WIND`. Half-hourly settlement periods in MW.
- **Forecasts**: Elexon BMRS `WINDFOR` dataset via the `/forecast/generation/wind/history` endpoint. Historical publications at 06:00 and 10:00 UTC on D-1 for each delivery date.

### Forecast Selection Methodology
1. **Cutoff**: Default 12:00 Europe/London on D-1 (EPEX SPOT day-ahead gate closure).
2. **Eligibility**: Only forecasts published on or before the cutoff are eligible.
3. **Selection**: For each delivery hour, select the latest eligible forecast by `publishTime`.
4. **Tie-breaking**: If multiple forecasts share the same `publishTime`, select the one with the lowest `generation_mw` (deterministic).
5. **Expansion**: Each hourly forecast covers two half-hour settlement periods; the selected value is applied to both.

### Alignment & Error Calculation
- Actuals and selected forecasts are aligned by UTC delivery interval start.
- Error = Forecast − Actual (positive = overestimation).
- MAPE excludes intervals where actual generation = 0 MW.

### Known Limitations
1. **January 2026 only**: Analysis limited to 31 days (1,488 half-hour intervals).
2. **DST handling**: Uses `zoneinfo` for Europe/London; assumes 48 periods/day (no spring-forward/fall-back adjustment in Jan).
3. **WINDFOR publications**: Only 06:00 and 10:00 UTC on D-1 are fetched. Additional eligible publications before cutoff are not retrieved.
4. **Rate limiting**: Elexon public endpoint is rate-limited; API key recommended for production.
5. **Serverless constraints**: Each analytics request makes ~62 upstream API calls (2 per day × 31 days). Cold starts may add latency.
6. **No database**: No caching layer; each request fetches fresh from Elexon.
7. **Bundle size**: Frontend main bundle ~651 kB (gz 192 kB); code-splitting recommended.

## AI Disclosure
This project was developed with AI assistance (Claude/Opencode) for a technical evaluation. All architectural decisions, code review, and validation performed by human.

## License
MIT

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

## Analytics Endpoints (Task 04)

### GET `/api/v1/analytics/day-ahead`
Get day-ahead selected forecasts for each delivery interval based on procurement cutoff.

**Query Parameters:**
- `from` (optional, default: 2026-01-01): Start date YYYY-MM-DD
- `to` (optional, default: 2026-01-31): End date YYYY-MM-DD
- `cutoff_hour` (optional, default: 12): Decision cutoff hour 0-23 (Europe/London)
- `cutoff_minute` (optional, default: 0): Decision cutoff minute 0-59
- `timezone` (optional, default: Europe/London): Timezone for cutoff

**Response:**
```json
{
  "date_from": "2026-01-01",
  "date_to": "2026-01-31",
  "interval_count": 1488,
  "cutoff_config": {"hour": 12, "minute": 0, "timezone": "Europe/London"},
  "methodology": {
    "forecast_selection": "Latest eligible forecast published on or before D-1 cutoff",
    "error_sign_convention": "Error = Forecast - Actual (positive = overestimation)",
    "tie_breaking": "Earliest publish_time, then lowest generation_mw (deterministic)"
  },
  "records": [
    {
      "delivery_start_utc": "2026-01-01T00:00:00+00:00",
      "settlement_date": "2026-01-01",
      "settlement_period": 1,
      "forecast_generation_mw": 5200.0,
      "forecast_publish_time_utc": "2025-12-31T10:00:00+00:00",
      "decision_cutoff_utc": "2025-12-31T12:00:00+00:00",
      "forecast_age_hours": 2.0,
      "selection_status": "selected"
    }
  ]
}
```

### GET `/api/v1/analytics/timeseries`
Get aligned actual vs forecast time-series with error calculations.

**Query Parameters:** Same as `/day-ahead`

**Response:**
```json
{
  "date_from": "2026-01-01",
  "date_to": "2026-01-31",
  "interval_count": 1488,
  "cutoff_config": {"hour": 12, "minute": 0, "timezone": "Europe/London"},
  "records": [
    {
      "delivery_start_utc": "2026-01-01T00:00:00+00:00",
      "settlement_date": "2026-01-01",
      "settlement_period": 1,
      "actual_generation_mw": 5000.0,
      "forecast_generation_mw": 5200.0,
      "forecast_publish_time_utc": "2025-12-31T10:00:00+00:00",
      "decision_cutoff_utc": "2025-12-31T12:00:00+00:00",
      "error_mw": 200.0,
      "absolute_error_mw": 200.0,
      "percentage_error": 4.0,
      "alignment_status": "matched"
    }
  ]
}
```

### GET `/api/v1/analytics/accuracy`
Get comprehensive forecast accuracy metrics and business insights.

**Query Parameters:** Same as `/day-ahead`

**Response:** Full `AnalyticsResponse` with:
- `accuracy_metrics`: MAE, RMSE, ME (Bias), MAPE (with zero-actual handling)
- `directional_metrics`: Over/under estimation counts, volumes, frequencies
- `distribution_metrics`: Max, median, P90, P95, P99 absolute errors
- `coverage_metrics`: Matched, missing forecast/actual intervals, coverage %
- `business_insights`: Systematic bias, key finding, caveats

## API Documentation
When the backend runs, interactive OpenAPI docs are at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Current Implementation Status (Task 04)

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
- ✅ **Day-ahead forecast selection service** (`app/services/forecast_selection.py`)
  - Configurable procurement cutoff (default 12:00 Europe/London D-1)
  - Latest eligible forecast selection with deterministic tie-breaking
  - DST-aware timezone handling (Europe/London with zoneinfo)
  - Handles: multiple versions, post-cutoff exclusion, duplicates, out-of-order records
- ✅ **Analytics service** (`app/services/analytics.py`)
  - MAE, RMSE, Mean Error (Bias), MAPE (excludes only actual = 0 MW)
  - Over/under estimation counts, volumes, frequencies
  - Distribution percentiles (Max, Median, P90, P95, P99)
  - Coverage metrics (matched, missing forecast, missing actual)
  - Business insights (systematic bias, key findings, caveats)
- ✅ **Analytics API endpoints** (`app/api/routes/analytics.py`)
  - `GET /api/v1/analytics/day-ahead`
  - `GET /api/v1/analytics/timeseries`
  - `GET /api/v1/analytics/accuracy`
- ✅ Comprehensive Pytest suite (87 tests) covering:
  - Forecast selection (cutoff, latest eligible, post-cutoff exclusion, multiple versions, missing, duplicates, tie-breaking, out-of-order, DST)
  - Actual/forecast alignment (matched, missing forecast, missing actual, zero-actual MAPE)
  - Accuracy metrics (MAE, RMSE, ME, MAPE, directional, distribution, coverage)
  - Business insights (over/under/neutral bias, caveats)
  - API query validation
- ✅ Ruff linting clean, Pydantic V2 validators
- ✅ Frontend Vitest, ESLint, TypeScript check, production build all pass

## Task 05 – Dashboard Implementation
- ✅ Professional B2B dashboard (React + Recharts) with KPI cards, forecast vs actual chart, error chart, accuracy analysis, transparency table, data quality panel.
- ✅ Typed API client with AbortController, retry, validation.
- ✅ Responsive layout, accessibility (semantic HTML, focus rings, contrast).
- ✅ 7 frontend tests covering loading, success, error, validation, provenance.

## Task 06 – Production Stabilization & Verification (Current)
- ✅ Repository audit: branch clean, no secrets in diff.
- ✅ Backend tests (87) pass, Ruff lint clean.
- ✅ Frontend tests (6) pass, ESLint clean, TypeScript strict pass, Vite build succeeds.
- ⚠️ **Docker integration**: not verified (Docker not available in environment).
- ✅ **Live Elexon API verification**: successful – official Insights API returns full January 2026 historical data (FUELHH 1 488 wind intervals, WINDFOR publications via history endpoint). No API key required.
- ⚠️ **Performance**: main bundle 651 kB (gz 192 kB) – code‑splitting recommended.
- ⚠️ **LightningCSS warnings** for Tailwind v4 `@theme`/`@tailwind` rules (cosmetic).

## AI Disclosure
This project was developed with AI assistance (Claude/Opencode) for a technical evaluation. All architectural decisions, code review, and validation performed by human.

## License
MIT