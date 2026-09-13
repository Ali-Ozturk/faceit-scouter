#!/usr/bin/env python3
"""Isolated production-ingestion benchmark. Host dependency: Python 3.10+, Docker Compose."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import re
import shutil
import statistics
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def command(args, env=None, timeout=1800):
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"Command failed: {' '.join(args)}\n{result.stderr}\n{result.stdout}")
    return result.stdout


def manifest(folder):
    rows = []
    checksums = set()
    for path in sorted(folder.iterdir()):
        if not path.is_file() or not path.name.endswith((".dem", ".dem.zst")):
            continue
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        checksum = digest.hexdigest()
        if checksum in checksums:
            raise ValueError(f"Duplicate demo contents: {path.name}; use distinct demos")
        checksums.add(checksum)
        rows.append({"name": path.name, "bytes": path.stat().st_size, "sha256": checksum})
    if not rows:
        raise ValueError("No .dem or .dem.zst inputs found")
    return rows


def summarize(data, elapsed, expected):
    imports = data["imports"]
    completed = sum(row["status"] == "COMPLETED" for row in imports)
    stages = {}
    for row in data["stages"]:
        stages.setdefault(f'{row["source"]}.{row["stage"]}', []).append(row["duration_ms"])
    return {
        "valid": len(imports) == expected and completed == expected,
        "expected": expected, "completed": completed,
        "failed": sum(row["status"] == "FAILED" for row in imports),
        "duplicates": sum(row["status"] == "DUPLICATE" for row in imports),
        "batch_seconds": round(elapsed, 3),
        "demos_per_minute": round(completed * 60 / elapsed, 3) if elapsed else 0,
        "database_bytes": data["database_bytes"],
        "stage_ms": {name: {"count": len(values), "median": statistics.median(values), "max": max(values)}
                     for name, values in stages.items()},
    }


def proc_snapshot():
    return {name: Path('/proc', name).read_text() for name in ('stat', 'meminfo', 'diskstats', 'loadavg')
            if Path('/proc', name).exists()}


def memory_bytes(value):
    match = re.fullmatch(r'\s*([0-9.]+)\s*([A-Za-z]+)\s*', value)
    if not match:
        raise ValueError(f'Unknown Docker memory value: {value}')
    units = {'B': 1, 'kB': 1000, 'KB': 1000, 'MB': 1000**2, 'GB': 1000**3,
             'TB': 1000**4, 'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'TiB': 1024**4}
    return round(float(match[1]) * units[match[2]])


def resource_summary(path):
    peak_ram = 0
    peak_cpu = 0.0
    peak_work = 0
    samples = 0
    with path.open() as stream:
        for line in stream:
            sample = json.loads(line)
            containers = [json.loads(row) for row in sample['containers'].splitlines() if row.strip()]
            peak_ram = max(peak_ram, sum(memory_bytes(row['MemUsage'].split('/')[0]) for row in containers))
            peak_cpu = max(peak_cpu, sum(float(row['CPUPerc'].rstrip('%')) for row in containers))
            peak_work = max(peak_work, sample.get('work_bytes', 0))
            samples += 1
    return {'sampled_combined_peak_memory_bytes': peak_ram,
            'sampled_combined_peak_cpu_percent': peak_cpu,
            'sampled_peak_work_bytes': peak_work, 'resource_samples': samples}


def work_bytes(folder):
    total = 0
    for path in folder.rglob('*'):
        try:
            if path.is_file():
                total += path.stat().st_size
        except FileNotFoundError:
            pass  # Production ingestion moves/deletes files while monitoring.
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demos', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'benchmark/results')
    parser.add_argument('--concurrency', type=int, nargs='+', default=[1, 2, 3])
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--timeout', type=int, default=3600, help='Maximum processing seconds per run')
    parser.add_argument('--interval', type=float, default=5, help='Monitoring/poll interval in seconds')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--skip-build', action='store_true')
    args = parser.parse_args()
    if min(args.concurrency) < 1 or args.repeats < 1 or args.timeout < 1 or args.interval < 1:
        parser.error('Concurrency, repeats, timeout and interval must be positive (interval >= 1)')
    inputs = manifest(args.demos.resolve())
    output = args.output.resolve() / time.strftime('%Y%m%dT%H%M%S')
    output = output.with_name(output.name + '-' + uuid.uuid4().hex[:6])
    output.mkdir(parents=True)
    metadata = {
        'manifest': inputs, 'arguments': vars(args), 'platform': platform.platform(),
        'cpu_count': os.cpu_count(), 'revision': command(['git', 'rev-parse', 'HEAD']).strip(),
        'git_status': command(['git', 'status', '--short']),
        'docker': command(['docker', 'version']), 'compose': command(['docker', 'compose', 'version']),
        'host_initial': proc_snapshot(),
    }
    (output / 'manifest.json').write_text(json.dumps(metadata, default=str, indent=2))
    schedule = [(c, r) for r in range(1, args.repeats + 1) for c in args.concurrency]
    random.Random(args.seed).shuffle(schedule)
    summaries = []
    for index, (concurrency, repeat) in enumerate(schedule, 1):
        project = 'scoutbench-' + uuid.uuid4().hex[:12]
        run_dir = output / f'{index:02d}-c{concurrency}-r{repeat}'
        work = run_dir / 'work'
        for name in ('incoming', 'processing', 'completed', 'failed', 'decompressed', 'temporary'):
            (work / name).mkdir(parents=True)
        for item in inputs:
            shutil.copyfile(args.demos.resolve() / item['name'], work / 'incoming' / item['name'])
        env = dict(os.environ, BENCH_WORK=str(work), BENCH_CONCURRENCY=str(concurrency))
        base = ['docker', 'compose', '--env-file', str(ROOT / 'benchmark/empty.env'),
                '-f', str(ROOT / 'benchmark/compose.yml'), '-p', project]
        # Explicit image names allow one build to be reused across isolated projects.
        def compose(*parts, timeout=1800):
            return command(base + list(parts), env, timeout)
        info = {'project': project, 'concurrency': concurrency, 'repeat': repeat, 'order': index}
        (run_dir / 'run.json').write_text(json.dumps(info, indent=2))
        print(f'[{index}/{len(schedule)}] {project}: concurrency={concurrency}, repeat={repeat}', flush=True)
        try:
            if index == 1 and not args.skip_build:
                (output / 'build.log').write_text(compose('build'))
            compose('up', '-d', '--wait', 'postgres')
            (run_dir / 'migration.log').write_text(compose('run', '--rm', 'migrate'))
            (run_dir / 'images.json').write_text(compose('images', '--format', 'json'))
            # Start timer before container startup: includes startup, discovery, queue and stability.
            started = time.monotonic()
            compose('up', '-d', 'processor')
            terminal = 0
            with (run_dir / 'resources.jsonl').open('w') as samples:
                while terminal < len(inputs):
                    elapsed = time.monotonic() - started
                    if elapsed > args.timeout:
                        raise TimeoutError(f'Processing exceeded {args.timeout} seconds')
                    processor_ids = compose('ps', '--status', 'running', '-q', 'processor').split()
                    if not processor_ids:
                        raise RuntimeError('Processor exited before completing the batch; inspect containers.log')
                    container_ids = processor_ids + compose('ps', '-q', 'postgres').split()
                    stats = command(['docker', 'stats', '--no-stream', '--format', '{{json .}}',
                                     *container_ids], timeout=30)
                    state = compose('ps', '--all', '--format', 'json', timeout=30)
                    samples.write(json.dumps({'elapsed_seconds': elapsed, 'containers': stats,
                                              'state': state, 'host': proc_snapshot(),
                                              'work_bytes': work_bytes(work)}) + '\n')
                    samples.flush()
                    terminal = int(compose('exec', '-T', 'postgres', 'psql', '-U', 'benchmark', '-d', 'benchmark', '-Atc',
                        "SELECT count(*) FROM imported_demo WHERE status IN ('COMPLETED','FAILED','DUPLICATE')", timeout=30).strip())
                    if terminal < len(inputs):
                        time.sleep(args.interval)
            elapsed = time.monotonic() - started
            compose('stop', 'processor')
            data = json.loads(compose('run', '--rm', '--no-deps', 'processor', 'python', '/benchmark/collect.py'))
            (run_dir / 'database.json').write_text(json.dumps(data, indent=2))
            summary = dict(info, **summarize(data, elapsed, len(inputs)),
                           **resource_summary(run_dir / 'resources.jsonl'))
            summaries.append(summary)
            (run_dir / 'summary.json').write_text(json.dumps(summary, indent=2))
            print(json.dumps({k: v for k, v in summary.items() if k != 'stage_ms'}), flush=True)
        except (Exception, KeyboardInterrupt) as error:
            (run_dir / 'error.txt').write_text(str(error))
            raise
        finally:
            try:
                (run_dir / 'containers.log').write_text(compose('logs', '--no-color', '--timestamps', timeout=60))
            finally:
                # Retain data for diagnosis. Never remove volumes automatically.
                compose('down', timeout=120)
        (output / 'summary.json').write_text(json.dumps(summaries, indent=2))
        with (output / 'summary.csv').open('w', newline='') as stream:
            fields = [key for key in summaries[0] if key != 'stage_ms']
            writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(summaries)
    print(f'Results: {output}', flush=True)
    if not all(row['valid'] for row in summaries):
        raise SystemExit('Invalid benchmark: some demos failed, were skipped or duplicated; inspect results.')


if __name__ == '__main__':
    main()
