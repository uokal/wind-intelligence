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

Copy `.env.example` to `.env` and adjust.

## API Documentation
When the backend runs, interactive OpenAPI docs are at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## Current Implementation Status (Task 02)
- ✅ Nx workspace with two apps (`wind-web`, `wind-api`)
- ✅ React + Vite + Tailwind dashboard with sidebar, top‑nav, dashboard page
- ✅ FastAPI health endpoint (`GET /api/v1/health`) with CORS & structured logging
- ✅ Dockerfiles (multi‑stage) and `docker-compose.yml`
- ✅ Basic Vitest component tests & Pytest health tests
- ✅ Frontend ↔ Backend health‑check integration (shows connected/unavailable)

## AI Disclosure
This project was developed with AI assistance (Claude/Opencode) for a technical evaluation. All architectural decisions, code review, and validation performed by human.

## License
MIT