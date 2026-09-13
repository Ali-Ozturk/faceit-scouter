# Testing FACEIT Scout on a VPS

## 1. Prepare a separate checkout

First push the benchmark branch from your development machine when ready. This tooling does not push the branch or connect to your VPS automatically.

```bash
git clone --branch codex/vps-benchmark YOUR_REPOSITORY_URL scout-benchmark
cd scout-benchmark/faceit-scout
docker info
docker compose version
python3 --version
df -h .
free -h
```

The Git repository root contains the `faceit-scout` application subdirectory. If your checkout layout differs, enter the directory containing `benchmark/` and `apps/`.

No application `.env` is needed. The runner supplies an empty Compose env file, uses a benchmark-only database credential and publishes **no ports**. FACEIT metadata network lookups are disabled explicitly. Each run gets a new `scoutbench-…` project and database volume. Use one benchmark runner per VPS at a time; benchmark image names are shared locally.

## 2. Copy representative inputs

Create a dedicated input folder, then copy 10–20 distinct recent demos into it using SCP/SFTP. For example, from your own machine, substituting the host and paths:

```bash
scp /local/demos/*.dem.zst USER@VPS:/home/USER/benchmark-demos/
```

Include several maps, short games, full games and overtime. Keep the original FACEIT filenames so match IDs are recognized. Both compressed and uncompressed inputs are supported, but compare equivalent input sets: uncompressed files skip decompression. The runner records checksums and never moves or modifies originals. Do not modify the source folder during a benchmark.

Each run stages a full copy before timing begins. Plan for copies across all runs, transient decompressed files, PostgreSQL tables/indexes/WAL, and Docker image storage. Measure a single run before attempting a large matrix. Stop if the VPS begins swapping heavily or runs low on disk.

## 3. Smoke test, then compare concurrency

From `faceit-scout`:

```bash
python3 benchmark/run.py --demos /home/USER/benchmark-demos --concurrency 1 --repeats 1
python3 benchmark/run.py --demos /home/USER/benchmark-demos --concurrency 1 2 3 --repeats 3 --timeout 3600
```

Use `tmux` or a similar persistent terminal for long runs. The timeout applies to each processing run; build and migration have separate command timeouts. Failed commands and timeouts stop the matrix, preserve logs and stop the project. An abrupt machine failure or SIGKILL may leave containers running; identify the project from `run.json`.

Every configuration starts with an empty database using the real Drizzle schema, including indexes. Existing duplicate detection stays enabled. A checksum duplicate, failed import, missing import or timeout is not a successful performance result. Compare table counts and per-match metadata between repeats; counts should match for the same inputs and settings.

## 4. Read the results

Open the top-level `summary.csv` in a spreadsheet or read `summary.json` and each run's `summary.json`. Prefer the lowest concurrency that meets your throughput target with memory headroom.

* `batch_seconds`: elapsed from before processor container startup until all expected imports reach a terminal state. Includes startup, discovery, stability checks and queueing; excludes image build, migrations, staging input copies and subsequent result export. Completion is polled, so this is an upper-bound measurement with monitoring/poll overhead, not a subsecond latency measurement.
* `demos_per_minute`: completed demos divided by batch wall time. Invalid runs must not be used for capacity decisions.
* `processor.parse`: includes executor scheduling and returning parsed data from subprocesses, not just parser CPU time.
* `processor.persist`: includes the database transaction commit. `persist.total` is a nested internal breakdown and excludes the outer commit; do not sum nested timings.
* `processor.total`: processing service time; excludes pre-processing queue/stability wait. It is not the user's full wait.
* `database_bytes`: PostgreSQL's reported database size; it is not the volume's total disk usage or total WAL footprint.
* `sampled_combined_peak_memory_bytes`: maximum sampled sum of processor and PostgreSQL memory at the same observation. Docker's Linux memory accounting can exclude reclaimable cache; this is not the full host memory requirement.
* `sampled_combined_peak_cpu_percent`: maximum sampled sum across both containers; 100% is approximately one logical CPU, so values above 100% are normal.
* `sampled_peak_work_bytes`: maximum observed total demo/work file sizes; excludes PostgreSQL and images. Moves during sampling and short-lived files can make it approximate.

`resources.jsonl` stores Docker stats as JSON lines inside each sample's `containers` string, including CPU%, memory usage/limit, PIDs and cumulative block I/O. Inspect processor **and** PostgreSQL together; the processor container includes parsing subprocesses. These are sampled measurements and can miss short memory spikes. They are not an exact peak-RSS profiler. Linux `host` snapshots include raw `/proc/stat` (including steal/iowait), `/proc/meminfo`, `/proc/diskstats` and load averages for examining host contention. Disk latency requires deriving deltas or an external monitor such as `iostat`; cumulative byte counts alone do not measure latency.

For a quick view while running, use `docker stats` in another terminal. An external VPS monitor can provide historical CPU steal, memory pressure, swapping, and disk latency. Do not infer absent contention from CPU usage alone.

Stage summaries report median and maximum, not p95: 10–20 demos are too few to make a strong tail-latency claim. Repeat the matrix at another time of day for shared VPS variability. Copies and checksums warm filesystem caches, so these are **not cold-disk tests**. The first run may still differ due to process/image initialization. Do not clear system-wide caches on a shared VPS just to force a cold run.

## 5. Decide whether the VPS is sufficient

Write down your target before comparing: e.g. three friends each request ten uncached demos and all results should be ready within five minutes. That illustrative target needs at least six completed demos/minute during the burst, plus headroom. Evaluate the actual burst directly using the 30 distinct demos; do not extrapolate only from one tiny demo. Reused/cached demos reduce work but should be evaluated separately from fresh-import capacity.

Reject configurations with failed imports, memory exhaustion, sustained swap, or growing queues under the intended arrival rate. Reserve RAM/CPU for the future web service and other software on the VPS; this baseline does not simulate their resource use.

This initial harness measures a preloaded burst into a fresh database. It does **not** yet automate populated-database growth tests, realistic timed user arrivals, dashboard HTTP latency, signed-link/download performance, or per-analysis completion tracking. After this baseline passes, those are the next deployment acceptance tests. For database-growth testing, use a separate retained test deployment, ingest a disjoint preload set, then measure only new demos without resetting the database. Never disable production duplicate checks to inflate a benchmark.

The implementation fixes a processor startup deadlock: preloaded files could fill the bounded queue before workers started. Discovery now runs concurrently with workers, as necessary for a realistic large burst.

## 6. Cleanup explicitly

Containers are normally removed automatically; database volumes and work files remain. Read the exact project name in the run's `run.json` first. To inspect that project's retained volume:

```bash
docker volume ls --filter label=com.docker.compose.project=EXACT_PROJECT_FROM_RUN_JSON
```

After exporting everything you want to keep, remove **only the verified benchmark database volume** by its exact name using `docker volume rm EXACT_VERIFIED_VOLUME_NAME`. Delete the corresponding benchmark result directory separately when no longer needed. Never use a global prune as benchmark cleanup. Original input demos remain in your source directory.

For a project left running after an abrupt interruption, list its containers with `docker ps -a --filter label=com.docker.compose.project=EXACT_PROJECT_FROM_RUN_JSON` and stop/remove only those verified benchmark containers before removing its volume.
