# AI Distribution Engine MVP — Demo Walkthrough

Status: structure + core flow working end-to-end. No AI, no auth, no crawling beyond the homepage.

## Running services

| Service | URL | Start command |
|---|---|---|
| Frontend (Next.js 16 + TS) | http://localhost:3000 | `cd frontend && npm run dev` |
| Backend (FastAPI) | http://127.0.0.1:8000 | `cd backend && .venv/bin/uvicorn main:app --port 8000` |
| PostgreSQL 16 (Docker, named volume `gtm-postgres-data`, host port 5433) | 127.0.0.1:5433 | `docker start gtm-postgres` |

The frontend proxies `/api/*` to the backend via rewrites in `frontend/next.config.ts` (no CORS).

## Files created

### Backend (`backend/`)
| File | Purpose |
|---|---|
| `main.py` | FastAPI app: health, projects CRUD-lite, analysis start/status, background run handler |
| `database.py` | SQLAlchemy engine/session (`DATABASE_URL`, defaults to the Docker DB) |
| `models.py` | ORM models: `User`, `Project`, `AnalysisRun`, `Source` |
| `fetcher.py` | Website fetcher + URL safety (schemes, localhost/private IPs, DNS checks, redirect validation, timeout) |
| `alembic.ini`, `migrations/` | Alembic config + 4 migrations |

Migrations:
1. `e3150f45ee9b` — create `users`, `projects`
2. `69d4ce3eb435` — add `website_url`, `description`; make `user_id` nullable
3. `21c9c65a5603` — create `analysis_runs` (status check constraint)
4. `86cdc5b25862` — create `sources`

### Frontend (`frontend/`)
| File | Purpose |
|---|---|
| `next.config.ts` | Proxy rewrites → backend (`/api/health`, `/api/projects`, `/api/v1/projects/:path*`) |
| `app/layout.tsx` | Shell + health indicator |
| `app/page.tsx` | Dashboard: create form + project list |
| `app/HealthIndicator.tsx` | 🟢/🔴/🟠 API status badge (polls every 15s) |
| `app/CreateProjectForm.tsx` | name / website URL / optional description → POST |
| `app/ProjectsList.tsx` | Dashboard list, links to detail pages, auto-refresh after create |
| `app/projects/[id]/page.tsx` | Detail page: name, website, description, created date, Analyze button |
| `app/AnalyzeButton.tsx` | Starts analysis, polls, shows Queued/Running/Completed/Failed badges |

### Docs & tests
- `docs/` — this file
- `tests/` — empty (no test suite written; verification was done via live API/DB checks)

## API endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{"status":"ok"}` |
| POST | `/projects` | full project object (used by the form via `/api/projects`) |
| POST | `/api/v1/projects` | `{"id"}` — validates name required + HTTP/HTTPS URL |
| GET | `/api/v1/projects` | list of projects, newest first |
| GET | `/api/v1/projects/{id}` | one project or 404 |
| POST | `/api/v1/projects/{id}/analysis` | `{"id"}` — creates run with status `queued` |
| GET | `/api/v1/projects/{id}/analysis/{run_id}` | run status or 404 |

## Database tables

- **users** — id, email (unique), created_at *(no auth yet; projects.user_id is nullable)*
- **projects** — id, name, website_url, description, user_id → users, created_at
- **analysis_runs** — id, project_id → projects, status (`queued|running|completed|failed` via CHECK), started_at, completed_at, error
- **sources** — id, analysis_id → analysis_runs (cascade), source_type, url, title, retrieved_at

## What is REAL vs HARD-CODED / SIMULATED

Be upfront about this in the demo:

### Real
- PostgreSQL persistence (named volume, survives container restarts)
- Alembic migrations (all 4 verified against the live DB)
- Input validation (name required, HTTP/HTTPS-only URL, 422s)
- Website fetching — real HTTP GET, real HTML parsing (title + clean text)
- URL safety / SSRF guards — blocks non-http(s), `file://`, `localhost`, private & reserved IPs (incl. metadata 169.254.169.254), DNS-resolved internal hosts, and validates every redirect hop; 5s connect / 15s total timeout
- Homepage source is really saved to `sources` after a fetch
- Frontend ↔ backend proxy and all API calls

### Hard-coded / simulated
- **Analysis progression is fake**: `queued → running → completed` is driven by `asyncio.sleep(1.5)` timers in `main.py` — no real analysis engine
- **Only the homepage is fetched** — no link crawling, no depth, no robots.txt
- **"Analyze" produces no insights** — it fetches the homepage and stops
- Statuses `failed` only occurs when the fetch itself errors (e.g. blocked/timeout/DNS)
- Health-check polling interval (15s), run status polling (700ms)

### Not built (by request)
- Authentication (user_id columns exist but unused)
- AI / LLM calls anywhere
- Edit/delete endpoints
- Real test suite (`tests/` empty)

## Suggested 5-minute demo script

1. **Dashboard** (http://localhost:3000) — health badge 🟢, create a project (show 422 on empty name / bad URL)
2. **Project list** appears, click through to **detail page** (name, website, description, created date)
3. **Click Analyze** — watch Queued → Running → Completed badges live
4. **Show the DB**: `sources` row with the real fetched title (`Example Domain`)
5. **Show the safety**: create a project with `http://localhost:3000`, run it → `failed: Blocked host: localhost`
6. **Show migrations**: `alembic current` → 4 revisions at head
