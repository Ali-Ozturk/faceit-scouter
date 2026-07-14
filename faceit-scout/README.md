# FACEIT Scout

Local FACEIT CS2 demo ingestion and scouting dashboard.

This repository contains:

- `apps/web`: Next.js App Router frontend and read-only API routes.
- `apps/processor`: Python worker that watches demo folders, decompresses `.dem.zst`, parses demos through a demoparser2 adapter, and persists results.
- `apps/extension`: Manifest V3 Chrome extension for discovering and downloading FACEIT demos through the logged-in browser session.
- `data`: local lifecycle folders for incoming, processing, completed, failed, decompressed, and temporary files.

## Current MVP Status

Implemented:

- PostgreSQL schema owned by Drizzle.
- Docker Compose services for Postgres, Next.js, and the Python processor.
- File filtering, startup scan, watchfiles watcher, stability checks, atomic claiming, checksum creation, duplicate detection, decompression, success/failure movement.
- SQLAlchemy persistence models mirroring the Drizzle schema.
- Parser adapter boundary around `demoparser2`.
- Configurable parallel processor workers with `PROCESSOR_CONCURRENCY`.
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

Set `FACEIT_API_TOKEN` in `.env` to enable server-side FACEIT Data API match discovery.

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

Set `PROCESSOR_CONCURRENCY=3` or higher to parse several demos in parallel. Higher values are faster for batches, but each parser worker can use substantial CPU and memory.

## Tests

```powershell
cd apps/web
npm test
npm run build
```

```powershell
cd apps/extension
npm test
npm run lint
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

## FACEIT Match Discovery

Open `/analyses` in the web app to enter a current FACEIT lobby or match ID, your FACEIT player ID, and optionally a selected map. The backend finds historical matchrooms where at least four current opponents played together and stores the analysis for later retrieval.

Demo downloading remains manual: open the returned FACEIT matchroom links, download the demo, and place the `.dem` or `.dem.zst` file in `data/incoming`.

## Chrome Extension

The Chrome extension uses the local backend for opponent analysis and the user's existing logged-in FACEIT browser session for demo downloads. It does not store or send FACEIT cookies, session tokens, or the backend FACEIT API token.

Build and load it locally:

```powershell
cd apps/extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select:

```text
apps/extension/dist
```

In the extension popup, configure:

```text
Backend URL: http://localhost:3000
FACEIT player ID: your FACEIT player ID
Download subdirectory: FaceitScout/incoming
```

Chrome downloads are saved relative to the browser's configured download folder. With the default subdirectory on Windows, configure the processor to watch:

```text
C:\Users\<user>\Downloads\FaceitScout\incoming
```

Open a current FACEIT CS2 matchroom, open the extension, detect or enter the current match ID, optionally enter the map, and run analysis. The extension skips already processed matches by default, opens official FACEIT matchrooms for demo retrieval, downloads available demos as `{faceit-match-id}.dem.zst`, and leaves the matchroom open with an actionable fallback when automatic retrieval is unavailable.

Create a zip package after building:

```powershell
cd apps/extension
npm run package
```

Downloaded demos should be named:

```text
{faceit-match-id}.dem.zst
```

The current manual workflow is intentionally identical after the file lands in `data/incoming`.
