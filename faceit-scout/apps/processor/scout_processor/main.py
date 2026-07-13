import asyncio
from pathlib import Path

import structlog

from scout_processor.config import Settings
from scout_processor.database.engine import make_session_factory
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.ingestion.lifecycle import process_file
from scout_processor.logging import configure_logging
from scout_processor.watcher.directory_watcher import enqueue_existing, watch_incoming
from scout_processor.watcher.file_stability import is_supported_demo, wait_until_stable

logger = structlog.get_logger(__name__)


async def worker(
    name: str,
    queue: asyncio.Queue[Path],
    settings: Settings,
    imports: ImportRepository,
    session_factory,
) -> None:
    while True:
        path = await queue.get()
        try:
            if not path.exists() or not is_supported_demo(path):
                continue
            stable = await wait_until_stable(
                path,
                settings.file_stability_interval_seconds,
                settings.file_stability_required_checks,
                settings.file_stability_timeout_seconds,
            )
            if not stable:
                logger.warning("file_never_stabilized", worker=name, file_name=path.name)
                continue
            await process_file(path, settings, imports, session_factory)
        finally:
            queue.task_done()


async def run() -> None:
    settings = Settings()
    configure_logging(settings.log_level)
    settings.ensure_directories()
    session_factory = make_session_factory(settings)
    imports = ImportRepository(session_factory)
    queue: asyncio.Queue[Path] = asyncio.Queue(maxsize=max(1, settings.processor_concurrency * 4))

    await enqueue_existing(settings, queue)
    tasks = [asyncio.create_task(watch_incoming(settings, queue, imports))]
    for index in range(settings.processor_concurrency):
        tasks.append(asyncio.create_task(worker(f"worker-{index + 1}", queue, settings, imports, session_factory)))
    logger.info("processor_started", incoming_directory=str(settings.incoming_directory), concurrency=settings.processor_concurrency)
    await asyncio.gather(*tasks)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
