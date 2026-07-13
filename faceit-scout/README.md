# FACEIT Scout

Local FACEIT CS2 demo ingestion and scouting dashboard.

This repository contains:

- `apps/web`: Next.js App Router frontend and read-only API routes.
- `apps/processor`: Python worker that watches demo folders, decompresses `.dem.zst`, parses demos through a demoparser2 adapter, and persists results.
- `data`: local lifecycle folders for incoming, processing, completed, failed, decompressed, and temporary files.

## Current MVP Status

Implemented:

- PostgreSQL schema owned by Drizzle.
- Docker Compose services for Postgres, Next.js, and the Python processor.
- File filtering, startup scan, watchfiles watcher, stability checks, atomic claiming, checksum creation, duplicate detection, decompression, success/failure movement.
- SQLAlchemy persistence models mirroring the Drizzle schema.
- Parser adapter boundary around `demoparser2`.
- Exact lineup fingerprinting and lineup match grouping.
- Dashboard, imports, lineups, team-map, match-detail pages, and JSON API routes.
- Unit tests for ingestion helpers and decompression.

Known parser limitation:

- The adapter currently extracts header metadata and players. Round, kill, bomb, and grenade extraction models and persistence are in place, but event extraction needs validation against a real CS2 demo and the installed demoparser2 API before treating those fields as complete.

## Environment

Copy `.env.example` to `.env` for local development if you want to override defaults.

```powershell
Copy-Item .env.example .env
```

## Mode A: Everything In Docker

From `faceit-scout`:

```powershell
docker compose up --build
```

The web container runs `drizzle-kit push` before starting Next.js. Place demos in:

```text
data/incoming
```

Then open:

```text
http://localhost:3000
```

## Mode B: Postgres In Docker, Apps On Host

Start Postgres:

```powershell
docker compose up postgres
```

Install and migrate the web app:

```powershell
cd apps/web
npm install
npm run db:migrate
npm run dev
```

Install and run the processor:

```powershell
cd apps/processor
pip install -e .[dev]
python -m scout_processor.main
```

## Tests

```powershell
cd apps/web
npm test
npm run build
```

```powershell
cd apps/processor
python -m pytest
```

## Makefile Shortcuts

```text
make up
make down
make logs
make migrate
make web
make processor
make test
make lint
make format
make reset
```

On Windows, PowerShell commands above are the most reliable path.

## Demo Lifecycle

```text
data/incoming      new files only
data/processing    atomically claimed files
data/completed     successfully handled originals, including duplicates
data/failed        permanently failed originals
data/decompressed  temporary .dem output from .dem.zst
data/temporary     local scratch space
```

The processor ignores hidden files, `.crdownload`, `.tmp`, `.part`, and unsupported extensions.

## Future Chrome Extension Integration

The future extension should download legitimate FACEIT demos into the configured incoming folder, preferably named:

```text
{faceit-match-id}.dem.zst
```

The current manual workflow is intentionally identical after the file lands in `data/incoming`.
