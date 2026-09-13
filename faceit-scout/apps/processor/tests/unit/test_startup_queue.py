import asyncio
from contextlib import suppress
from types import SimpleNamespace

import pytest
from scout_processor import main


@pytest.mark.asyncio
async def test_startup_drains_more_files_than_queue_capacity(monkeypatch):
    settings = SimpleNamespace(processor_concurrency=1, log_level='INFO', keep_completed_demos=True, url_imports_enabled=False,
                               incoming_directory='/unused', ensure_directories=lambda: None)
    drained = asyncio.Event()

    async def enqueue(settings, queue, imports, queued):
        for index in range(20):
            await queue.put(index)

    async def worker(name, queue, *args):
        for _ in range(20):
            await queue.get()
            queue.task_done()
        drained.set()

    async def watch(*args):
        await asyncio.Event().wait()

    monkeypatch.setattr(main, 'Settings', lambda: settings)
    monkeypatch.setattr(main, 'make_session_factory', lambda _: None)
    monkeypatch.setattr(main, 'ImportRepository', lambda _: None)
    monkeypatch.setattr(main, 'ProcessPoolExecutor', lambda **kwargs: None)
    monkeypatch.setattr(main, 'enqueue_existing', enqueue)
    monkeypatch.setattr(main, 'watch_incoming', watch)
    monkeypatch.setattr(main, 'worker', worker)
    task = asyncio.create_task(main.run())
    try:
        await asyncio.wait_for(drained.wait(), timeout=2)
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
@pytest.mark.parametrize('complete', [True, False])
async def test_worker_readiness_contract(monkeypatch, complete):
    from unittest.mock import AsyncMock, Mock
    from pathlib import Path
    settings = SimpleNamespace(incoming_files_are_complete=complete,
                               file_stability_interval_seconds=1,
                               file_stability_required_checks=3,
                               file_stability_timeout_seconds=60)
    monkeypatch.setattr(Path, 'exists', lambda self: True)
    monkeypatch.setattr(Path, 'stat', lambda self, **kwargs: SimpleNamespace(st_size=100, st_mode=0))
    stable = AsyncMock(return_value=True)
    process = AsyncMock()
    monkeypatch.setattr(main, 'wait_until_stable', stable)
    monkeypatch.setattr(main, 'process_file', process)
    queue = asyncio.Queue()
    queue.put_nowait(Path('completed.dem.zst'))
    task = asyncio.create_task(main.worker('test', queue, set(), settings, Mock(), Mock(), Mock()))
    try:
        await asyncio.wait_for(queue.join(), 1)
        assert stable.await_count == (0 if complete else 1)
        process.assert_awaited_once()
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
