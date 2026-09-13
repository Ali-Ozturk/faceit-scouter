import asyncio
from contextlib import suppress
from types import SimpleNamespace

import pytest
from scout_processor import main


@pytest.mark.asyncio
async def test_startup_drains_more_files_than_queue_capacity(monkeypatch):
    settings = SimpleNamespace(processor_concurrency=1, log_level='INFO',
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
