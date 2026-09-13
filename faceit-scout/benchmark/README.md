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

Start small to establish RAM and disk requirements. Every run retains separate database and working-data Docker volumes; nine runs can require substantial storage. Inputs are copied and verified into Linux-volume storage before timing. The runner stops containers between runs but never automatically deletes results or volumes.

Timing version 2 measures the batch inside the processor container with a monotonic clock, from simultaneous submission through committed results and file cleanup. Container startup and host polling delays are reported separately. Do not compare its throughput directly to version 1's startup-and-poll-inclusive throughput; compare stage timings or rerun both implementations with the same harness.

Final filenames in benchmark inputs are explicitly treated as complete, so no three-second stability wait is applied. A finite adapter runs the real production workers, parser, and persistence; it does not use a simplified parser. Long-lived server warm-up is not simulated: the process pool starts at submission.

See [the VPS guide](../docs/vps-benchmark.md) for copying demos, metrics, interpretation, limitations and cleanup.

See [measured optimization results](../docs/performance-results.md) for parser equality checks, decompression experiments and local before/after numbers.

Outputs live in ignored `benchmark/results/<timestamp>-<id>/`:

| File | Contents |
|---|---|
| `manifest.json` | Input checksums/sizes, revision, dirty status, host and Docker details, arguments |
| `summary.csv`, `summary.json` | Exact batch duration, throughput, startup, per-file latency summary, sampled resource peaks, completion validity and database size; JSON also includes stage median/max |
| `<run>/timing.json` | Monotonic queue/service/completion times for each file and exact batch completion |
| `<run>/processor-resources.jsonl` | Processor cgroup CPU/memory counters sampled every 100 ms independently of the async worker loop |
| `<run>/database.json` | Per-import records, stage durations, match metadata and exact public-table row counts |
| `<run>/resources.jsonl` | Sampled Docker memory/CPU/block I/O, container state, Linux `/proc` counters |
| `<run>/containers.log` | Timestamped processor/PostgreSQL logs |
| `<run>/migration.log`, `staging.log`, `images.json`, `run.json`, `compose.json` | Setup output, image IDs, project name and resolved Compose configuration |
| `<run>/error.txt` | Fatal runner error/timeout, when present |
| Docker volume `<project>_work` | Completed, failed and temporary demo files; no longer in the Windows results directory |

Input checksums reject identical files under different names. A run only passes when every expected input becomes `COMPLETED`; duplicates and failures invalidate it. This verifies completion, not full semantic equivalence: compare exported row counts and match details across repetitions as well.

The runner randomizes configuration order with a recorded seed. `--skip-build` reuses already built benchmark images; only use it when the source and images match. Default runs rebuild once before the matrix. Dependencies are not all pinned in the existing processor project: preserve image IDs/images for repeatable cross-machine comparisons.

For CPU-heavy VPS tests, compare concurrency 1, 2, 3 before raising it further. Neither a worker count nor this harness automatically constrains native-library thread pools; use the same VPS/container CPU allocation for comparable runs. Defaults preserve analysis output: full scoreboard remains disabled and extended opening previews remain disabled, as before.

Use `--full-scoreboard` and/or `--opening-previews` to benchmark those optional features. Flags are recorded in the run summary and resolved configuration. Compare identical feature settings when judging an optimization.

Developer checks:

```bash
python3 -m unittest discover -s benchmark -p 'test_*.py'
cd apps/processor
python3 -m pytest tests/unit/test_startup_queue.py tests/unit/test_ingestion.py
```
