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

Each run stages and checksum-verifies a full copy into a Docker-managed Linux volume before timing begins. The read-only source can be a Windows directory, but checksum, decompression, parsing and file moves during the benchmark run use the volume. Plan for copies across all runs, transient decompressed files, PostgreSQL tables/indexes/WAL, and Docker image storage. Measure a single run before attempting a large matrix. Stop if the VPS begins swapping heavily or runs low on disk.

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

* `batch_seconds` (timing version 2): container-side monotonic time from simultaneous submission until all production workers finish their jobs, including discovery, queueing, checksum, decompression, parsing, commits and file cleanup. Excludes startup, input staging, image build, migration, host polling lag and result export. Pre-staged complete files skip stability checks. Worker process-pool startup remains included.
* `startup_seconds`: host-observed container launch to readiness; includes readiness observation overhead. This is separate from throughput.
* `host_observation_seconds`: time until the host notices completion; slower monitoring never inflates `batch_seconds`.
* `timing.json` per-file `queue_seconds`, `service_seconds`, `completion_seconds`: queue delay, worker occupancy and latency since simultaneous batch submission. A failed job also has a completion timestamp: use database status to distinguish success.
* `demos_per_minute`: completed demos divided by batch wall time. Invalid runs must not be used for capacity decisions.
* `processor.parse`: includes executor scheduling and returning parsed data from subprocesses, not just parser CPU time.
* `processor.persist`: includes the database transaction commit. `persist.total` is a nested internal breakdown and excludes the outer commit; do not sum nested timings.
* `processor.total`: processing service time; excludes pre-processing queue/stability wait. It is not the user's full wait.
* `database_bytes`: PostgreSQL's reported database size; it is not the volume's total disk usage or total WAL footprint.
* `sampled_combined_peak_memory_bytes`: maximum sampled sum of processor and PostgreSQL memory at the same observation. Docker's Linux memory accounting can exclude reclaimable cache; this is not the full host memory requirement.
* `sampled_combined_peak_cpu_percent`: maximum sampled sum across both containers; 100% is approximately one logical CPU, so values above 100% are normal.
* `processor_cgroup_peak_memory_bytes`: Linux cgroup lifetime memory high-water mark for this processor container, including native subprocesses and charged cache; differs from Docker's cache-adjusted memory display. Zero means unavailable. It is not combined PostgreSQL plus processor memory.

`resources.jsonl` stores Docker stats as JSON lines inside each sample's `containers` string, including CPU%, memory usage/limit, PIDs and cumulative block I/O. Inspect processor **and** PostgreSQL together; the processor container includes parsing subprocesses. These are sampled measurements and can miss short memory spikes. Additionally `processor-resources.jsonl` samples cgroup counters every 100 ms on a separate thread: CPU usage is a cumulative microsecond counter, so divide consecutive deltas by elapsed microseconds to derive occupied cores. This works inside Docker Desktop too, without depending on Windows `/proc`. It is not an exact peak-RSS profiler. Linux-host `host` snapshots include raw `/proc/stat` (including steal/iowait), `/proc/meminfo`, `/proc/diskstats` and load averages for examining contention. Disk latency requires deriving deltas or an external monitor such as `iostat`; cumulative byte counts alone do not measure latency.

For a quick view while running, use `docker stats` in another terminal. An external VPS monitor can provide historical CPU steal, memory pressure, swapping, and disk latency. Do not infer absent contention from CPU usage alone.

Stage summaries report median and maximum, not p95: 10–20 demos are too few to make a strong tail-latency claim. Repeat the matrix at another time of day for shared VPS variability. Copies and checksums warm filesystem caches, so these are **not cold-disk tests**. The first run may still differ due to process/image initialization. Do not clear system-wide caches on a shared VPS just to force a cold run.

## 5. Decide whether the VPS is sufficient

Write down your target before comparing: e.g. three friends each request ten uncached demos and all results should be ready within five minutes. That illustrative target needs at least six completed demos/minute during the burst, plus headroom. Evaluate the actual burst directly using the 30 distinct demos; do not extrapolate only from one tiny demo. Reused/cached demos reduce work but should be evaluated separately from fresh-import capacity.

Reject configurations with failed imports, memory exhaustion, sustained swap, or growing queues under the intended arrival rate. Reserve RAM/CPU for the future web service and other software on the VPS; this baseline does not simulate their resource use.

This harness measures simultaneous submission of a preloaded burst into a fresh database through production workers. It does **not** yet automate populated-database growth tests, realistic timed user arrivals, dashboard HTTP latency, signed-link/download performance, or grouping jobs into per-user analyses. After this baseline passes, those are the next deployment acceptance tests. For database-growth testing, use a separate retained test deployment, ingest a disjoint preload set, then measure only new demos without resetting the database. Never disable production duplicate checks to inflate a benchmark.

The implementation fixes a processor startup deadlock: preloaded files could fill the bounded queue before workers started. Discovery now runs concurrently with workers, as necessary for a realistic large burst.

## 6. Cleanup explicitly

Containers are normally removed automatically; database and work volumes remain. Read the exact project name in the run's `run.json` first. To inspect that project's retained volumes:

```bash
docker volume ls --filter label=com.docker.compose.project=EXACT_PROJECT_FROM_RUN_JSON
```

After exporting everything you want to keep, remove **only the verified benchmark database and work volumes** by exact name using `docker volume rm EXACT_VERIFIED_VOLUME_NAME`. Delete the corresponding benchmark result directory separately when no longer needed. Never use a global prune as benchmark cleanup. Original input demos remain in your source directory.

## PC deployment changes

The normal application Compose file now places decompressed scratch files in `decompressed_data`, while retaining the Downloads junction for compressed incoming files. It also defaults to `INCOMING_FILES_ARE_COMPLETE=true` to remove readiness sleeps on your PC. Browser downloads must expose the final filename only after completion; temporary `.crdownload` and `.part` files remain ignored. For manual input, copy to `name.dem.zst.part`, then rename after copying. Set the variable to `false` for producers that write to final filenames directly.

Apply these changes to the normal local stack with `docker compose up -d --build processor`. Do not run this simultaneously with a capacity benchmark: it would compete for resources. This recreates the processor; let existing imports finish first. Host `data/decompressed` will no longer show active Docker scratch files.

For a project left running after an abrupt interruption, list its containers with `docker ps -a --filter label=com.docker.compose.project=EXACT_PROJECT_FROM_RUN_JSON` and stop/remove only those verified benchmark containers before removing its volume.
