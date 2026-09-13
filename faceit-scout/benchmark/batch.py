"""Finite batch using production workers; monotonic timing inside the container."""
import asyncio
from concurrent.futures import ProcessPoolExecutor
import json
import os
from pathlib import Path
import threading
import time

from scout_processor.config import Settings
from scout_processor.database.engine import make_session_factory
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.logging import configure_logging
from scout_processor.main import worker
from scout_processor.watcher.file_stability import is_supported_demo


def write_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2))
    temporary.replace(path)


def cgroup_snapshot():
    result = {}
    for name in ('memory.current', 'memory.peak', 'cpu.stat', 'memory.events'):
        path = Path('/sys/fs/cgroup') / name
        if path.exists():
            result[name] = path.read_text()
    return result


class TimedQueue(asyncio.Queue):
    def __init__(self, timings, started):
        super().__init__()
        self.timings = timings
        self.started = started
        self.active = {}

    async def get(self):
        path = await super().get()
        self.active[asyncio.current_task()] = path
        self.timings[path.name] = {'queue_seconds': time.perf_counter() - self.started}
        return path

    def task_done(self):
        path = self.active.pop(asyncio.current_task())
        row = self.timings[path.name]
        row['completion_seconds'] = time.perf_counter() - self.started
        row['service_seconds'] = row['completion_seconds'] - row['queue_seconds']
        super().task_done()


async def main():
    settings = Settings()
    settings.ensure_directories()
    configure_logging(settings.log_level)
    sessions = make_session_factory(settings)
    imports = ImportRepository(sessions)
    files = sorted(p for p in settings.incoming_directory.iterdir() if p.is_file() and is_supported_demo(p))
    report = Path('/report')
    write_json(report / 'ready.json', {'files': len(files), 'pid': os.getpid()})
    while not (report / 'start').exists():
        await asyncio.sleep(0.05)
    timings = {}
    started = time.perf_counter()
    stop = threading.Event()

    def monitor():
        with (report / 'processor-resources.jsonl').open('w') as stream:
            while not stop.is_set():
                stream.write(json.dumps({'seconds': time.perf_counter()-started, **cgroup_snapshot()})+'\n')
                stream.flush()
                stop.wait(0.1)

    monitoring = threading.Thread(target=monitor, daemon=True)
    monitoring.start()
    queue = TimedQueue(timings, started)
    queued = set()
    executor = ProcessPoolExecutor(max_workers=settings.processor_concurrency)
    tasks = [asyncio.create_task(worker(f'worker-{i+1}', queue, queued, settings, imports, sessions, executor))
             for i in range(settings.processor_concurrency)]
    try:
        # Timestamp represents simultaneous submission; discovery DB writes are included.
        for path in files:
            await imports.create_discovered(path)
            queued.add(path.resolve())
            queue.put_nowait(path)
        joined = asyncio.create_task(queue.join())
        done, _ = await asyncio.wait([joined, *tasks], return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()  # Surface worker exceptions rather than hanging indefinitely.
        if not joined.done():
            raise RuntimeError('Worker terminated before the batch drained')
        elapsed = time.perf_counter() - started
        write_json(report / 'timing.json', {'batch_seconds': elapsed, 'files': timings,
                   'cgroup_final': cgroup_snapshot(), 'measurement': 'submission_to_worker_completion_monotonic'})
    finally:
        stop.set()
        monitoring.join()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        executor.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
