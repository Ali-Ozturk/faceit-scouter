# VPS ingestion benchmark

Runs the **production processor**, PostgreSQL 17 and the application's Drizzle schema setup in isolated Docker Compose projects. No FACEIT session, extension, web deployment or Downloads API is required. Only local `.dem` / `.dem.zst` files are used.

Requirements: Linux VPS, Python 3.10+, Git, Docker Engine with Compose v2 (`up --wait` support), and permission to run Docker. Install these using your OS/vendor instructions before starting. Docker must be running. Python needs no extra host packages.

From the `faceit-scout` directory on branch `codex/vps-benchmark`:

```bash
python3 benchmark/run.py --demos /absolute/path/to/demos --concurrency 1 --repeats 1
```

Then run the comparison:

```bash
python3 benchmark/run.py --demos /absolute/path/to/demos --concurrency 1 2 3 --repeats 3 --timeout 3600
```

Start small to establish RAM and disk requirements. Every run retains a separate database volume and a copy of every demo; nine runs can require substantial storage. The runner stops containers between runs but never automatically deletes results or database volumes.

See [the VPS guide](../docs/vps-benchmark.md) for copying demos, metrics, interpretation, limitations and cleanup.

Outputs live in ignored `benchmark/results/<timestamp>-<id>/`:

| File | Contents |
|---|---|
| `manifest.json` | Input checksums/sizes, revision, dirty status, host and Docker details, arguments |
| `summary.csv`, `summary.json` | Batch duration, throughput, completion validity and database size by configuration; JSON also includes stage median/max |
| `<run>/database.json` | Per-import records, stage durations, match metadata and exact public-table row counts |
| `<run>/resources.jsonl` | Sampled Docker memory/CPU/block I/O, container state, Linux `/proc` counters |
| `<run>/containers.log` | Timestamped processor/PostgreSQL logs |
| `<run>/migration.log`, `images.json`, `run.json` | Schema setup output, image IDs and isolated Compose project name |
| `<run>/error.txt` | Fatal runner error/timeout, when present |
| `<run>/work/` | Completed, failed and temporary demo files |

Input checksums reject identical files under different names. A run only passes when every expected input becomes `COMPLETED`; duplicates and failures invalidate it. This verifies completion, not full semantic equivalence: compare exported row counts and match details across repetitions as well.

The runner randomizes configuration order with a recorded seed. `--skip-build` reuses already built benchmark images; only use it when the source and images match. Default runs rebuild once before the matrix. Dependencies are not all pinned in the existing processor project: preserve image IDs/images for repeatable cross-machine comparisons.

Developer checks:

```bash
python3 -m unittest discover -s benchmark -p 'test_*.py'
cd apps/processor
python3 -m pytest tests/unit/test_startup_queue.py tests/unit/test_ingestion.py
```
