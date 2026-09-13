# FACEIT Scout

For isolated VPS performance testing of the production parser and PostgreSQL persistence, see the [benchmark README](benchmark/README.md) and [VPS benchmark guide](docs/vps-benchmark.md).

Local FACEIT CS2 demo ingestion and scouting dashboard.

FACEIT Scout runs three services:

- `postgres`: local PostgreSQL database.
- `web`: Next.js dashboard and API.
- `processor`: Python worker that watches demo folders, decompresses `.dem.zst`, parses demos, and saves results.

Browser extensions are available for demo discovery/download:

- `apps/extension`: Chrome / Chromium extension.
- `apps/extension-firefox`: Firefox extension.

## Requirements

For the normal Docker setup you only need:

- Git
- Docker Desktop, with Docker Compose v2
- A FACEIT Data API token for match discovery and extension analysis

Optional, only if you build extensions locally:

- Node.js 20+
- npm
- Chrome, Edge, or Firefox 121+

Optional, only if you run apps outside Docker:

- Python 3.12+

## Quick Start

From a fresh clone:

```powershell
cd faceit-scout
.\scripts\setup.ps1
notepad .env
docker compose up -d --build
```

On macOS/Linux:

```sh
cd faceit-scout
sh scripts/setup.sh
nano .env
docker compose up -d --build
```

In `.env`, set:

```env
FACEIT_API_TOKEN=your_faceit_data_api_token
```

Then open:

```text
http://localhost:3101
```

The web container runs database migrations automatically before starting Next.js.

## Daily Commands

```powershell
docker compose up -d --build
docker compose logs -f
docker compose down
```

If you have `make` installed:

```sh
make setup
make up
make logs
make down
```

`make up` also runs setup and builds the Docker images.

## Ports

Defaults are chosen to avoid common local conflicts:

```env
WEB_HOST_PORT=3101
POSTGRES_HOST_PORT=5434
```

This means:

- Browser URL: `http://localhost:3101`
- Web container internal port: `3000`
- Host PostgreSQL port: `5434`
- PostgreSQL container internal port: `5432`

If you want the old web URL back and port `3000` is free, set this in `.env`:

```env
WEB_HOST_PORT=3000
```

Then recreate the stack:

```powershell
docker compose up -d --build --force-recreate
```

## Environment Variables

`scripts/setup.ps1` / `scripts/setup.sh` creates `.env` from `.env.example`.

Important values:

```env
FACEIT_API_TOKEN=
WEB_HOST_PORT=3101
POSTGRES_HOST_PORT=5434
PROCESSOR_CONCURRENCY=3
OPENING_TENDENCY_PREVIEWS_ENABLED=false
```

Use `FACEIT_API_TOKEN` for FACEIT match discovery. Without it, the dashboard can run, but analysis calls that need FACEIT data will fail.

Most people should leave these folders as-is:

```env
INCOMING_DIRECTORY=./data/incoming
PROCESSING_DIRECTORY=./data/processing
COMPLETED_DIRECTORY=./data/completed
FAILED_DIRECTORY=./data/failed
DECOMPRESSED_DIRECTORY=./data/decompressed
TEMPORARY_DIRECTORY=./data/temporary
```

Docker maps `./data` into the processor as `/data`, so the compose file already uses the correct in-container paths.

## Demo Files

Put new demos here:

```text
data/incoming
```

Supported inputs:

```text
.dem
.dem.zst
```

Lifecycle folders:

```text
data/incoming      new files only
data/processing    claimed files being processed
data/completed     successfully handled originals, including duplicates
data/failed        permanently failed originals
data/decompressed  temporary .dem output from .dem.zst
data/temporary     scratch space
```

The processor ignores hidden files, `.crdownload`, `.tmp`, `.part`, and unsupported extensions.

## Browser Extension

The extension uses:

- Local backend: `http://localhost:3101`
- Your logged-in FACEIT browser session for demo downloads
- The backend `FACEIT_API_TOKEN` from `.env` for match discovery

It does not store or send FACEIT cookies/session tokens to the backend.

### Chrome / Edge

```powershell
cd apps/extension
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select:

```text
apps/extension/dist
```

Popup settings:

```text
Backend URL: http://localhost:3101
FACEIT player ID or nickname: your FACEIT player ID or nickname
Download subdirectory: FaceitScout/incoming
```

### Firefox

Firefox 121 or newer is required.

```powershell
cd apps/extension-firefox
npm install
npm run build
```

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select:

```text
apps/extension-firefox/dist/manifest.json
```

Use the same popup settings:

```text
Backend URL: http://localhost:3101
FACEIT player ID or nickname: your FACEIT player ID or nickname
Download subdirectory: FaceitScout/incoming
```

### Getting Downloads Into `data/incoming`

Chrome and Firefox save extension downloads relative to the browser's configured Downloads folder. With the default extension setting, demos land in:

```text
<Downloads>/FaceitScout/incoming
```

Then either:

- Move downloaded `.dem.zst` files into `data/incoming` manually, or
- On Windows, create a junction so `<Downloads>\FaceitScout\incoming` points to this repo's `data\incoming`.

For the junction setup, see [Windows Download Junction](docs/windows-download-junction.md).

## Local Development Without Full Docker

Most users should use Docker. For app development, you can run Postgres in Docker and apps on the host.

Start Postgres:

```powershell
docker compose up -d postgres
```

Run web:

```powershell
cd apps/web
npm install
npm run db:migrate
npm run dev
```

Run processor:

```powershell
cd apps/processor
pip install -e .[dev]
python -m scout_processor.main
```

For host-run web/processor, use the host database URL from `.env`:

```env
DATABASE_URL=postgresql://faceit_scout:faceit_scout@localhost:5434/faceit_scout
```

## Tests

```powershell
cd apps/web
npm test
npm run build
```

```powershell
cd apps/extension
npm test
npm run build
```

```powershell
cd apps/extension-firefox
npm test
npm run build
```

```powershell
cd apps/processor
python -m pytest
```

## Troubleshooting

Check service health:

```powershell
docker compose ps
docker compose logs -f web
docker compose logs -f processor
```

Check the web API:

```powershell
Invoke-WebRequest http://localhost:3101/api/health
```

Common issues:

- `localhost:3000` does not open: use `http://localhost:3101`, or set `WEB_HOST_PORT=3000`.
- Extension says `Failed to fetch`: confirm backend URL is `http://localhost:3101`, rebuild/reload the extension, and check `http://localhost:3101/api/health`.
- Analysis fails: make sure `FACEIT_API_TOKEN` is set in `.env`, then recreate the web container.
- No demos are processed: make sure files are in `data/incoming` and check processor logs.
- Port conflict: change `WEB_HOST_PORT` or `POSTGRES_HOST_PORT` in `.env`, then recreate the stack.

## Reset Local Data

This removes containers and the database volume:

```powershell
docker compose down -v
```

It does not delete demo files in `data`.
