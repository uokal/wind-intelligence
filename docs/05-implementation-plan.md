# Implementation Plan

## 1. Milestones & Time Budget (16 Hours Total)

| # | Milestone | Tasks | Est. Hours | Cumulative |
|---|-----------|-------|------------|------------|
| **0** | **Task 01 Complete** | Audit, research, methodology, architecture, plan (this doc) | **3.0** | 3.0 |
| **1** | **Nx Workspace Restructure** | Remove Next.js/Express; add Vite React app + FastAPI app; configure `@nx/python` | 1.5 | 4.5 |
| **2** | **Shared Types & Contracts** | JSON Schema definitions; TypeScript + Pydantic codegen; OpenAPI spec | 1.0 | 5.5 |
| **3** | **Elexon API Integration** | Thin wrapper around `requests` for `FUELHH` and `WINDFOR`; retry/backoff; in‑memory cache (5 min) | 2.0 | 7.5 |
| **4** | **Forecast Selection Service** | Day‑ahead cutoff logic; publishTime filtering; latest‑before‑cutoff selection (WINDFOR) | 1.5 | 9.0 |
| **5** | **Analytics Service** | MAE, RMSE, ME, MAPE, over/under, distributions; unit tests | 1.5 | 10.5 |
| **6** | **FastAPI Endpoints** | `/forecast`, `/analytics`, `/health`; request validation; response models | 1.0 | 11.5 |
| **7** | **React Dashboard** | Vite + Tailwind + Recharts; Dashboard page (time‑series, error dist, scatter, daily table); Settings (cutoff, date range) | 2.5 | 14.0 |
| **8** | **Docker & Compose** | Multi‑stage Dockerfiles; docker-compose.yml; nginx for web; healthchecks | 1.0 | 15.0 |
| **9** | **Testing & CI** | Unit tests (pytest, vitest); GitHub Actions workflow (lint, test, build) | 0.5 | 15.5 |
| **10** | **Deployment & Demo** | Frontend → Vercel (static); Backend → Heroku (Docker); record 10‑min video; finalize README with AI disclosure | 0.5 | **16.0** |

**Buffer:** 0.5h (absorbed in task estimates above)

---

## 2. Acceptance Criteria per Milestone

### Milestone 1 — Nx Restructure
- [ ] `nx g @nx/react:app web --bundler=vite --style=tailwind` succeeds
- [ ] `nx g @nx/python:app api` succeeds (after adding `@nx/python`)
- [ ] `nx run web:dev` starts Vite dev server on :4200
- [ ] `nx run api:serve` starts FastAPI on :8000 with `/health`
- [ ] Old `apps/web` (Next.js) and `apps/api` (Express) removed or archived

### Milestone 2 — Shared Types
- [ ] `libs/shared-types/src/schemas/forecast.json` defines ForecastRequest/ForecastResponse
- [ ] `nx run shared-types:build` generates `libs/shared-types/generated/*.ts` and Python models
- [ ] Both `web` and `api` import types from `@org/shared-types`

### Milestone 3 — Elexon Client
- [ ] `elexon-client` exposes `get_fuelhh(date_range)` → DataFrame filtered to `fuelType == "WIND"`
- [ ] `elexon-client` exposes `get_windfor(date_range)` → DataFrame with `publishTime`, `forecastMW`
- [ ] Handles clock‑change days (46/50 SPs) via direct request orchestration
- [ ] Retry with exponential backoff (3 retries, 1/2/4s)
- [ ] In‑memory cache (TTL 5 min) for repeated date ranges

### Milestone 4 — Forecast Selector
- [ ] `select_day_ahead_forecast(delivery_date, sp, forecasts_df, cutoff_hour=12)` returns latest eligible forecast
- [ ] Correctly converts UTC `publishTime` → Europe/London for cutoff comparison
- [ ] Returns `None` if no forecast before cutoff (logged)
- [ ] Unit tests: cutoff boundary, multiple forecasts, missing data, clock-change date

### Milestone 5 — Analytics
- [ ] `compute_metrics(forecast_mw[], actual_mw[])` returns dict with MAE, RMSE, ME, MAPE(ε=1), frequencies, volumes
- [ ] `compute_daily_rollup(period_metrics[])` → daily aggregates
- [ ] `compute_distribution(errors[])` → histogram bins, percentiles
- [ ] Zero-actual handling documented and tested
- [ ] Sign convention: Error = Forecast − Actual (positive = overestimation)

### Milestone 6 — FastAPI Endpoints
- [ ] `GET /api/v1/forecast?delivery_date=2026-01-15` returns 48 periods with status
- [ ] `GET /api/v1/analytics?start=2026-01-01&end=2026-01-31` returns full response
- [ ] Pydantic validation on query params (date format, cutoff_hour 0-23)
- [ ] CORS configured for frontend origin
- [ ] OpenAPI docs at `/docs`

### Milestone 7 — React Dashboard
- [ ] **Time-Series Chart**: Forecast vs Actual lines, hover shows period values
- [ ] **Error Distribution**: Histogram + vertical lines for ME, MAE, P90
- [ ] **Scatter Plot**: Forecast (x) vs Actual (y) with 1:1 line, R²
- [ ] **Daily Metrics Table**: Date | MAE | ME | Over% | Under% | OverVol | UnderVol
- [ ] **Settings Panel**: Cutoff hour (0-23), Date range picker, "Refresh" button
- [ ] Responsive: works at 375px (mobile) and 1440px (desktop)
- [ ] Loading states, error toasts, empty-state messaging

### Milestone 8 — Docker
- [ ] `docker compose -f docker/docker-compose.yml up --build` starts both services
- [ ] Web accessible at `localhost:80`, API at `localhost:8000`
- [ ] Multi-stage builds < 200MB each
- [ ] Healthchecks pass
- [ ] `.dockerignore` excludes node_modules, __pycache__, .git

### Milestone 9 — Testing & CI
- [ ] `nx run-many -t test` passes (target: ≥80% Python, ≥70% TS)
- [ ] `nx run-many -t lint` passes (ESLint + Ruff/Black)
- [ ] GitHub Actions: `lint` → `test` → `build` on push/PR
- [ ] Playwright smoke test: load dashboard, verify chart renders

### Milestone 10 — Deployment & Demo
- [ ] Frontend deployed to Vercel (static export `vite build` → `vercel --prod`)
- [ ] Backend deployed to Heroku via `heroku container:push web` / `release`
- [ ] Both URLs reachable publicly; CORS configured
- [ ] README.md: project description, architecture diagram, API key setup, AI disclosure
- [ ] YouTube unlisted video ≤10 min: 30s pitch, 5min technical walkthrough, 30s results
- [ ] No secrets in repo; `.env.example` present

---

## 3. Risk Register & Mitigations

| ID | Risk | Probability | Impact | Mitigation | Contingency |
|----|------|-------------|--------|------------|-------------|
| R1 | Elexon API key not available / rate limited | High | High | Use cached fixtures for dev; implement retry+backoff; cache 5min | Mock client for CI; document live key needed for demo |
| R2 | January 2026 data not available | Low* | Medium | Verified via test request (see §2); fallback to fixture if needed | Parameterize dates; demo with live data |
| R3 | Clock-change bugs in forecast selection | Low | Medium | Direct request orchestration handles 46/50 SPs; add test for 2025-03-30 | Manual verification; log warnings |
| R4 | Vercel/Heroku deployment incompatibility | Low | High | Verify static export works on Vercel; test Docker image on Heroku (paid hobby) | Fallback: both services on Heroku |
| R5 | Recharts bundle size / performance | Low | Low | Lazy-load chart components; limit data points displayed | Simplify charts if needed |
| R6 | Scope creep (auth, DB, multi-user) | High | High | **Freeze scope after Task 01A approval**; no auth, no DB, no users | Push non-MVP to backlog |
| R7 | Time overrun on React dashboard | Medium | High | Time-box: 2.5h max; use pre-built Recharts examples | Drop scatter plot if needed; keep time-series + table |
| R8 | Docker build failures on deploy platform | Low | High | Test `docker compose build` locally first; use same base images | Fallback: deploy API + web separately |

---

## 4. Detailed Task Breakdown (for Tracking)

### Task 01 — Complete ✓
- [x] Repository audit → `docs/01-repository-audit.md`
- [x] Elexon API research → `docs/02-elexon-api-research.md`
- [x] Forecast methodology → `docs/03-forecast-methodology.md`
- [x] Analytics methodology → `docs/04-analytics-methodology.md`
- [x] Architecture proposal → `docs/04-architecture-proposal.md`
- [x] Implementation plan → `docs/05-implementation-plan.md`

### Task 02 — Foundation (1.5h)
- [ ] Add `@nx/python` plugin
- [ ] Generate Vite React app (`web`)
- [ ] Generate FastAPI app (`api`)
- [ ] Remove Next.js/Express apps
- [ ] Configure Tailwind v4 for Vite
- [ ] Configure ESLint + Prettier for both apps

### Task 03 — Contracts (1.0h)
- [ ] Define JSON Schemas in `libs/shared-types/src/schemas/`
- [ ] Add codegen script (json-schema-to-typescript, datamodel-code-generator)
- [ ] Wire into Nx build pipeline

### Task 04 — Elexon Client (2.0h)
- [ ] Implement thin wrapper using `requests` for `FUELHH` and `WINDFOR`
- [ ] Add retry logic (tenacity or custom) + exponential backoff
- [ ] In‑memory cache (TTL 5 min) for repeated ranges
- [ ] Unit tests with mocked HTTP responses

### Task 05 — Forecast Selector (1.5h)
- [ ] Implement pure selection function
- [ ] Timezone conversion (UTC → Europe/London)
- [ ] Edge case handling (missing, duplicates)
- [ ] Comprehensive unit tests

### Task 06 — Analytics (1.5h)
- [ ] Implement metric functions (pure, no I/O)
- [ ] Zero-actual safeguard for MAPE
- [ ] Distribution helpers (histogram, percentiles)
- [ ] Unit tests with known datasets

### Task 07 — FastAPI (1.0h)
- [ ] Wire routers, dependency injection
- [ ] Request/response Pydantic models from shared types
- [ ] Error handling middleware
- [ ] Integration test with real API (optional, marked)

### Task 08 — React Dashboard (2.5h)
- [ ] Scaffold pages, routing, layout
- [ ] Build chart components (TimeSeries, ErrorDist, Scatter)
- [ ] Build daily metrics table
- [ ] Settings panel with React Hook Form
- [ ] React Query for data fetching + caching
- [ ] Responsive CSS, loading/error states

### Task 09 — Docker (1.0h)
- [ ] Write multi-stage Dockerfiles
- [ ] Write docker-compose.yml
- [ ] nginx config for SPA routing
- [ ] Test locally

### Task 10 — CI/CD (0.5h)
- [ ] GitHub Actions workflow
- [ ] Ruff + Black for Python; ESLint + Prettier for TS
- [ ] Vitest + Pytest in CI
- [ ] Build verification

### Task 11 — Deploy & Demo (0.5h)
- [ ] Frontend → Vercel (`vite build && vercel --prod`)
- [ ] Backend → Heroku (`heroku container:push web && heroku container:release web`)
- [ ] Verify both public URLs, CORS, health endpoint
- [ ] Record demo video
- [ ] Finalize README with AI disclosure

---

## 5. Definition of Done (Project Level)

The assignment is complete when:

1. ✅ All 5 documentation files exist in `docs/`
2. ✅ Public GitHub repository with clean history
3. ✅ `README.md` includes:
   - Project overview
   - Architecture diagram (Mermaid)
   - Setup instructions (local + Docker)
   - API key configuration
   - **AI Disclosure**: "This project was developed with AI assistance (Claude/Opencode) for a technical evaluation. All architectural decisions, code review, and validation performed by human."
4. ✅ Deployed application accessible via HTTPS
5. ✅ Unlisted YouTube video (≤10 min) covering:
   - 30s: Customer pitch (business value)
   - 5min: Technical walkthrough (architecture, methodology, key code)
   - 30s: Live demo of dashboard
   - 30s: Analytics results summary
6. ✅ No secrets in repo (verified with `git-secrets` or manual check)
7. ✅ All acceptance criteria in §2 met

---

## 6. Daily Schedule (Suggested)

| Day | Hours | Focus |
|-----|-------|-------|
| **Day 1** | 4h | Task 01 complete; Nx restructure; shared types |
| **Day 2** | 4h | Elexon client; forecast selector; analytics |
| **Day 3** | 4h | FastAPI endpoints; React dashboard |
| **Day 4** | 4h | Docker; CI; deploy; demo video; README |

---

## 7. Go/No-Go for Task 02

**Ready to proceed when:**
- [ ] All 5 docs reviewed and approved
- [ ] No contradictions between methodology, architecture, and plan
- [ ] Elexon API key available (or mock strategy confirmed)
- [ ] Deployment platform chosen (Vercel + Heroku)
- [ ] Scope frozen (no auth, DB, users, multi-tenancy)

---

## 8. Appendix: Command Reference

```bash
# Install Nx Python plugin
pnpm add -D @nx/python

# Generate apps
nx g @nx/react:app web --bundler=vite --style=tailwind --directory=apps/web
nx g @nx/python:app api --directory=apps/api

# Generate libs
nx g @nx/js:lib shared-types --directory=libs/shared-types
nx g @nx/python:lib elexon-client --directory=libs/elexon-client
nx g @nx/python:lib forecast-selector --directory=libs/forecast-selector
nx g @nx/python:lib analytics --directory=libs/analytics
nx g @nx/react:lib ui-components --directory=libs/ui-components

# Dev
nx run web:dev
nx run api:serve

# Build
nx run-many -t build

# Test
nx run-many -t test

# Lint
nx run-many -t lint

# Docker
docker compose -f docker/docker-compose.yml up --build
```