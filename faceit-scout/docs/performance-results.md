# Ingestion optimization measurements — 13 September 2026

These are local Windows/Docker Desktop measurements, not VPS guarantees. The host reports 20 logical CPUs. Workloads use the same 15 compressed demos from the user's test folder. Analysis settings are unchanged (default scoreboard and preview settings), except for a separate optional-feature equality test.

## Controlled parser comparison

Both parser versions ran alternately inside the same processor image against the same decompressed Linux-volume files. First pairs were warm-ups. Complete serialized `ParsedDemo` outputs were hashed and compared, not just row counts.

| Experiment | Baseline median | Optimized median | Result |
|---|---:|---:|---|
| Batch event queries; three timed repeats per demo | 2.181 s | 1.160 s | About 47% less parser time; identical outputs on 15 demos |
| Also avoid rescanning events absent from a successful batch; one timed repeat per demo | 2.235 s | 0.798 s | About 64% less parser time; identical outputs on 15 demos |

Medians pool equally repeated observations across demos. Final optimization has fewer repetitions, so repeat the experiment before interpreting small differences. This comparison excludes decompression, DB writes and multiprocessing transfer. It proves a parser improvement independently of changing filesystem storage.

The original parser source is preserved locally in ignored `benchmark/results/parser-comparison/baseline_parser.py`. It can be recovered from commit `f692fee`.

An additional comparison with both full-scoreboard parsing and extended opening previews enabled also produced identical old/new outputs on three demos. The processor unit suite passed 31 tests; the benchmark suite passed six tests.

## Production-worker integration

| Median per-demo stage | Old: one worker, Windows bind mount | New: one worker, Linux volume | New: three workers, Linux volume |
|---|---:|---:|---:|
| Checksum | 0.635 s | 0.106 s | 0.382 s |
| Decompression | 3.147 s | 0.291 s | 0.356 s |
| Parse (including subprocess scheduling/transfer) | 3.425 s | 0.862 s | 1.724 s |
| Persist including commit | 0.304 s | 0.280 s | 0.348 s |
| Processing total, excluding readiness/queue | 8.189 s | 1.597 s | 2.963 s |

All 15 imports completed in each run. Every exported public-table row count matched between the old baseline and both optimized runs. The baseline's result-export step initially failed during development when its Compose file changed; its completed DB results were subsequently exported read-only before stopping the isolated project. Only its recovered stage measurements, not a reconstructed batch time, are used here.

With precise version-2 timing, the optimized batch completed in **25.024 s / 35.965 demos per minute** at one worker and **15.232 s / 59.087 demos per minute** at three workers. These measure submission through worker completion; container startup, staging, migrations and polling delay are excluded. Do not directly compare these throughputs with version-1's startup/poll-inclusive batch number.

Processor cgroup memory high-water marks were about **869 MiB** at one worker and **2.12 GiB** at three workers. These include charged cache and differ from Docker's cache-adjusted sampled RAM display. PostgreSQL and host overhead require additional capacity. The results do not establish that three workers will fit or run efficiently on a small VPS.

## Decompression experiment

On three demos staged to Linux-volume storage, native Zstandard streaming with default buffers had a pooled median of **0.246 s**; 1 MiB buffers measured **0.255 s**, and 4 MiB measured **0.260 s**. Output hashes matched. Each variant had a warm-up and three timed repetitions, rotating order.

Larger buffers did not demonstrate a benefit and were not adopted. The large end-to-end decompression improvement comes from working-file placement; the decompressor itself remains unchanged. Streaming retains bounded memory use rather than materializing whole decompressed files in RAM.

## Reproducing parser and decompression experiments

The main runner is documented in [the benchmark README](../benchmark/README.md). Build once using a normal benchmark run before using the local image below. On a Linux host, from `faceit-scout`:

```bash
mkdir -p benchmark/results/parser-comparison
git show f692fee:faceit-scout/apps/processor/scout_processor/parsing/demo_parser.py > benchmark/results/parser-comparison/baseline_parser.py
docker run --rm -e PYTHONPATH=/app \
  --mount type=bind,source="$PWD/apps/processor/scout_processor",target=/app/scout_processor,readonly \
  --mount type=bind,source="$PWD/benchmark",target=/benchmark,readonly \
  --mount type=bind,source="$PWD/benchmark/results/parser-comparison",target=/comparison \
  --mount type=bind,source=/absolute/path/to/demos,target=/inputs,readonly \
  --mount type=volume,source=scoutbench-parser-profile,target=/data \
  faceit-scout-benchmark-processor:local python /benchmark/profile_parser.py --repeats 3
```

Run the same command with `/benchmark/profile_decompression.py` instead of the parser script (omit `--repeats`) for the buffer comparison. That script currently selects the first three sorted compressed demos. To verify the full analysis configuration, add `-e PARSE_FULL_SCOREBOARD=true -e OPENING_TENDENCY_PREVIEWS_ENABLED=true` to `docker run`, then use parser options `--limit 3 --report full-features.json`.

Results include per-demo timings/digests and a separate cProfile report. The profiler run is excluded from timing comparisons. Do not run these experiments simultaneously with another benchmark. The scratch volume is retained; remove only that verified experiment volume after saving results if desired.
