# Architecture Proposal

## 1. Overview

Minimal, maintainable Nx monorepo for wind generation forecast analytics dashboard.

```
wind-intelligence/
├── apps/
│   ├── web/                 # React + TypeScript + Vite + Tailwind + Recharts
│   └── api/                 # Python + FastAPI
├── libs/
│   ├── shared-types/        # TypeScript/Python shared contracts (OpenAPI/JSON Schema)
│   ├── elexon-client/       # Python: Elexon BMRS API wrapper
│   ├── forecast-selector/   # Python: Day-ahead forecast selection logic
│   ├── analytics/           # Python: MAE, RMSE, bias, MAPE, distributions
│   └── ui-components/       # TypeScript: Reusable React components (charts, tables)
├── docker/
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   └── docker-compose.yml
├── docs/                    # This documentation
└── .github/workflows/       # CI/CD
```

---

## 2. Technology Stack Decisions

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Monorepo** | Nx 23.x | Already present; supports JS/TS + Python via `@nx/python` |
| **Frontend** | React 18 + TypeScript + Vite | Assignment requirement; faster dev than Next.js for SPA |
| **Styling** | Tailwind CSS v4 | Already in repo; utility‑first, small bundle |
| **Charts** | Recharts | Assignment requirement; React‑native, declarative |
| **Backend** | Python 3.11 + FastAPI | Assignment requirement; async, auto OpenAPI, Pydantic validation |
| **Data** | Pandas + NumPy | Assignment requirement; standard for analytics |
| **API Client** | Direct `requests` to BMRS endpoints (or thin wrapper) | No extra dependency; full control over query params |
| **Containerization** | Docker multi‑stage | Production parity; single deployable unit |
| **Orchestration** | Docker Compose | Local dev + simple prod deployment |
| **Testing** | Vitest (frontend) + Pytest (backend) | Modern, fast, Nx‑integrated |
| **CI/CD** | GitHub Actions | Free for public repos; Nx Cloud optional |
| **Deployment** | **Vercel (frontend) + Heroku (backend)** | Vercel for static React; Heroku supports Dockerized Python services |

---

## 3. Nx Workspace Structure

### 3.1 Apps

#### `apps/web` — React SPA
```
apps/web/
├── src/
│   ├── main.tsx              # Entry point
│   ├── App.tsx               # Root component
│   ├── routes.tsx            # React Router (hash mode for static hosting)
│   ├── pages/
│   │   ├── Dashboard.tsx     # Main view: charts + metrics
│   │   └── Settings.tsx      # Cutoff config, date range
│   ├── components/
│   │   ├── charts/           # Recharts wrappers (TimeSeries, ErrorDist, Scatter)
│   │   ├── tables/           # Metric tables, coverage report
│   │   └── ui/               # Buttons, inputs, layout
│   ├── services/
│   │   └── api.ts            # Typed fetch client (generated from OpenAPI)
│   ├── hooks/
│   │   └── useForecastData.ts # React Query / SWR for data fetching
│   └── styles/
│       └── globals.css       # Tailwind imports
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

#### `apps/api` — FastAPI Service
```
apps/api/
├── src/
│   ├── main.py               # FastAPI app factory
│   ├── config.py             # Pydantic Settings (env vars)
│   ├── routers/
│   │   ├── forecast.py       # GET /forecast?date=2026-01-15
│   │   ├── analytics.py      # GET /analytics?start=2026-01-01&end=2026-01-31
│   │   └── health.py         # GET /health
│   ├── services/
│   │   ├── elexon.py         # ElexonDataPortal wrapper
│   │   ├── forecast_selector.py # Day-ahead selection logic
│   │   └── analytics.py      # MAE, RMSE, bias, MAPE, distributions
│   ├── models/
│   │   ├── forecast.py       # Pydantic models (request/response)
│   │   ├── analytics.py      # Metric response models
│   │   └── domain.py         # Internal domain models
│   └── utils/
│       └── timezone.py       # Europe/London helpers
├── pyproject.toml
├── requirements.txt
├── Dockerfile
└── pytest.ini
```

### 3.2 Libraries (Shared Code)

| Library | Language | Purpose | Consumers |
|---------|----------|---------|-----------|
| `shared-types` | TypeScript + Python (via JSON Schema) | API contracts, domain types | web, api |
| `elexon-client` | Python | Thin wrapper around ElexonDataPortal | api |
| `forecast-selector` | Python | Pure selection logic (testable in isolation) | api |
| `analytics` | Python | Pure metric functions (testable in isolation) | api |
| `ui-components` | TypeScript | Recharts wrappers, shared UI primitives | web |

**Shared Types Strategy:**
- Define canonical schemas in `libs/shared-types/src/schemas/` as JSON Schema
- Generate TypeScript types: `json-schema-to-typescript`
- Generate Pydantic models: `pydantic-jsonschema` or `datamodel-code-generator`
- Single source of truth for API request/response shapes

---

## 4. API Contracts (OpenAPI)

### 4.1 Forecast Endpoint
```
GET /api/v1/forecast
Query: delivery_date=2026-01-15 (required), cutoff_hour=12 (optional)
Response: ForecastResponse
  delivery_date: date
  settlement_period: int (1-48)
  forecast_mw: float
  publish_time_utc: datetime
  actual_mw: float | null
  error_mw: float | null
  status: "matched" | "missing_forecast" | "missing_actual"
```
*Forecast source: WINDFOR; Actual source: FUELHH (fuelType=WIND)*

### 4.2 Analytics Endpoint
```
GET /api/v1/analytics
Query: start_date=2026-01-01, end_date=2026-01-31, cutoff_hour=12
Response: AnalyticsResponse
  period: {start, end}
  cutoff_hour: int
  coverage: {total, with_forecast, with_actual, matched}
  metrics:
    mae_mw: float
    rmse_mw: float
    me_mw: float
    mape_pct: float | null
    overest_freq_pct: float
    underest_freq_pct: float
    overest_volume_mw: float
    underest_volume_mw: float
  daily: DailyMetrics[]
  distribution: HistogramBin[]
```

### 4.3 Health Endpoint
```
GET /api/v1/health
Response: {status: "ok", version: "0.1.0", timestamp: datetime}
```

---

## 5. Data Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Elexon     │────▶│  api/        │────▶│  forecast-      │
│  BMRS API   │     │  elexon      │     │  selector       │
└─────────────┘     │  client      │     └────────┬────────┘
                    └──────────────┘              │
                          ┌──────────────┐         │
                          │  FUELHH      │─────────┤
                          │  (actuals)   │         ▼
                          └──────────────┘  ┌──────────────┐
                                            │  analytics   │
                                            └──────┬───────┘
                                                   │
                            ┌──────────────────────┼──────────────────────┐
                            ▼                      ▼                      ▼
                     ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
                     │  web:       │        │  web:       │        │  web:       │
                     │  Dashboard  │        │  Daily      │        │  Settings   │
                     │  (charts)   │        │  Table      │        │  (cutoff)   │
                     └─────────────┘        └─────────────┘        └─────────────┘
```

---

## 6. Docker Configuration

### 6.1 Multi-Stage Builds

**`docker/Dockerfile.api`**
```dockerfile
# Build stage
FROM python:3.11-slim AS builder
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Runtime stage
FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /install /usr/local
COPY apps/api/src ./src
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**`docker/Dockerfile.web`**
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web

# Runtime stage (nginx for static hosting)
FROM nginx:alpine
COPY --from=builder /app/dist/apps/web /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 6.2 Docker Compose
```yaml
# docker/docker-compose.yml
version: '3.8'
services:
  api:
    build:
      context: ..
      dockerfile: docker/Dockerfile.api
    ports: ["8000:8000"]
    env_file: .env.api
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  web:
    build:
      context: ..
      dockerfile: docker/Dockerfile.web
    ports: ["80:80"]
    depends_on: [api]
```

---

## 7. Testing Strategy

| Layer | Tool | Scope |
|-------|------|-------|
| **Unit (Python)** | pytest + pytest-mock | `forecast-selector`, `analytics`, `elexon-client` (mocked) |
| **Integration (Python)** | pytest + testcontainers | FastAPI endpoints with real ElexonDataPortal (requires API key) |
| **Unit (TypeScript)** | Vitest + React Testing Library | Components, hooks, utils |
| **E2E** | Playwright | Critical user flows (load dashboard, change date, export) |
| **Contract** | schemathesis / pact | API schema compliance |

**Test Data:** Fixtures from real API responses (committed, no secrets).

---

## 8. Deployment Evaluation: Vercel + Heroku

### 8.1 Vercel Constraints for This Architecture

| Factor | Vercel Capability | Impact |
|--------|-------------------|--------|
| **Static React/Vite** | ✅ Native (zero‑config) | Frontend deploys in seconds |
| **Python FastAPI** | ❌ Not a native runtime | Cannot run long‑living FastAPI process |
| **Docker Image as Vercel Function** | ✅ Supported (OCI image) | Limited to 50 MB, 10 s max execution, no persistent connections |
| **Background / Scheduled Jobs** | ❌ No cron | Not suitable for periodic data refresh |
| **Free Tier** | ✅ Generous for static sites | Good for frontend |

**Conclusion:** Vercel is ideal for the React SPA but unsuitable for the FastAPI service.

### 8.2 Heroku Fit

| Factor | Heroku Capability |
|--------|-------------------|
| **Docker Deploy** | ✅ `heroku container:push` / `container:release` |
| **Python Runtime** | ✅ Native buildpack *or* Docker |
| **Free Tier** | ❌ Discontinued (Nov 2022) – cheapest paid dyno $5/mo |
| **Background Worker** | ✅ Separate process type |
| **Postgres / Redis** | ✅ Add‑ons (not required here) |

**Recommendation:** Deploy **frontend to Vercel** (static export) and **backend to Heroku** using the Dockerfile. This satisfies the “Vercel or Heroku” requirement while keeping each service on its strongest platform.

### 8.3 Alternative: Single‑Platform Heroku

If a single provider is preferred, host both services on Heroku (React built into a static‑file server or served via a lightweight Node/Express). This avoids cross‑origin complexity and stays within the client’s allowed platforms.

### 8.4 Local Docker Compose Compatibility

The `docker-compose.yml` remains the canonical local‑dev environment. Both Vercel (via `vercel dev`) and Heroku (`heroku local`) can consume the same images, ensuring parity.

---

## 9. Configuration Management

| Config | Location | Example |
|--------|----------|---------|
| Elexon API Key | `API_ELEXON_KEY` (env, secret) | `abc123...` |
| Procurement Cutoff Hour | `API_CUTOFF_HOUR` (env, default 12) | `12` |
| Cutoff Timezone | `API_CUTOFF_TZ` (env, default Europe/London) | `Europe/London` |
| API Base URL (frontend) | `VITE_API_URL` (build-time) | `https://api.example.com` |
| CORS Origins | `API_CORS_ORIGINS` (env) | `https://app.example.com` |

**No secrets in code.** `.env.example` committed; `.env` gitignored.

---

## 10. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| API Response Time (cached) | < 500ms p95 |
| API Response Time (cold) | < 5s (Elexon API bound) |
| Frontend Load (TTI) | < 2s on 3G |
| Test Coverage | ≥ 80% unit, 100% critical paths |
| Accessibility | WCAG 2.1 AA (semantic HTML, contrast) |
| Browser Support | Last 2 Chrome/Firefox/Safari/Edge |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Elexon API rate limits | Medium | High | Cache responses (Redis/memory); respect backoff |
| January 2026 data unavailable | Certain | Medium | Develop against Jan 2024; parameterize dates |
| Clock-change bugs | Low | Medium | Use ElexonDataPortal orchestrator; test 2025-03-30 |
| Vercel incompatibility | N/A | N/A | Use Railway/Fly.io (decided) |
| Scope creep | High | High | Freeze scope after Task 01 approval |

---

## 12. Deliverables Mapping

| Deliverable | Location |
|-------------|----------|
| Public GitHub Repo | Root (push after approval) |
| README with AI Disclosure | `README.md` |
| Deployed Application | Railway/Fly.io URL |
| Demo Video (≤10 min) | YouTube (unlisted) |
| Documentation | `docs/*.md` (this folder) |