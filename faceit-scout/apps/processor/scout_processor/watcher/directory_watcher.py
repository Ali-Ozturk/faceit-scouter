import asyncio
from pathlib import Path

import structlog
from watchfiles import awatch

from scout_processor.config import Settings
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.watcher.file_stability import is_supported_demo

logger = structlog.get_logger(__name__)


async def enqueue_path(path: Path, queue: asyncio.Queue[Path], queued_paths: set[Path]) -> None:
    resolved = path.resolve()
    if resolved in queued_paths:
        return
    queued_paths.add(resolved)
    await queue.put(resolved)


async def enqueue_existing(settings: Settings, queue: asyncio.Queue[Path], queued_paths: set[Path]) -> None:
    for path in sorted(settings.incoming_directory.iterdir()):
        if path.is_file() and is_supported_demo(path):
            await enqueue_path(path, queue, queued_paths)


async def watch_incoming(
    settings: Settings,
    queue: asyncio.Queue[Path],
    imports: ImportRepository,
    queued_paths: set[Path],
) -> None:
    async for changes in awatch(settings.incoming_directory):
        for _, raw_path in changes:
            path = Path(raw_path)
            if not path.is_file() or not is_supported_demo(path):
                continue
            await imports.create_discovered(path)
            await enqueue_path(path, queue, queued_paths)
