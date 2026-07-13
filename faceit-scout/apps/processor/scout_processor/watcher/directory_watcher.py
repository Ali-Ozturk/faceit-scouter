import asyncio
from pathlib import Path

import structlog
from watchfiles import awatch

from scout_processor.config import Settings
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.watcher.file_stability import is_supported_demo, wait_until_stable

logger = structlog.get_logger(__name__)


async def enqueue_existing(settings: Settings, queue: asyncio.Queue[Path]) -> None:
    for path in sorted(settings.incoming_directory.iterdir()):
        if path.is_file() and is_supported_demo(path):
            await queue.put(path)


async def watch_incoming(settings: Settings, queue: asyncio.Queue[Path], imports: ImportRepository) -> None:
    await enqueue_existing(settings, queue)
    async for changes in awatch(settings.incoming_directory):
        for _, raw_path in changes:
            path = Path(raw_path)
            if not path.is_file() or not is_supported_demo(path):
                continue
            await imports.create_discovered(path)
            stable = await wait_until_stable(
                path,
                settings.file_stability_interval_seconds,
                settings.file_stability_required_checks,
                settings.file_stability_timeout_seconds,
            )
            if stable:
                await queue.put(path)
            else:
                logger.warning("file_never_stabilized", file_name=path.name)
