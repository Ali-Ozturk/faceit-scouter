import asyncio
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import structlog

from scout_processor.config import Settings
from scout_processor.database.engine import make_session_factory
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.ingestion.lifecycle import process_file, cleanup_loop
from scout_processor.ingestion.downloads import download_worker
from scout_processor.logging import configure_logging
from scout_processor.watcher.directory_watcher import enqueue_existing, watch_incoming
from scout_processor.watcher.file_stability import is_supported_demo, wait_until_stable

logger = structlog.get_logger(__name__)


async def worker(
    name: str,
    queue: asyncio.Queue[Path],
    queued_paths: set[Path],
    settings: Settings,
    imports: ImportRepository,
    session_factory,
    parse_executor,
    slots=None,
) -> None:
    while True:
        path = await queue.get()
        try:
            if not path.exists() or not is_supported_demo(path) or path.stat().st_size == 0:
                continue
            stable = settings.incoming_files_are_complete or await wait_until_stable(
                path,
                settings.file_stability_interval_seconds,
                settings.file_stability_required_checks,
                settings.file_stability_timeout_seconds,
            )
            if not stable:
                logger.warning("file_never_stabilized", worker=name, file_name=path.name)
                continue
            if not path.exists():
                continue
            logger.info("worker_processing_file", worker=name, file_name=path.name)
            async with slots or asyncio.Semaphore(1):
                await process_file(path, settings, imports, session_factory, parse_executor, name)
        finally:
            queued_paths.discard(path.resolve())
            queue.task_done()


async def run() -> None:
    settings = Settings()
    configure_logging(settings.log_level)
    settings.ensure_directories()
    session_factory = make_session_factory(settings)
    imports = ImportRepository(session_factory)
    queue: asyncio.Queue[Path] = asyncio.Queue(maxsize=max(1, settings.processor_concurrency * 4))
    queued_paths: set[Path] = set()
    parse_executor = ProcessPoolExecutor(max_workers=settings.processor_concurrency)
    slots = asyncio.Semaphore(settings.processor_concurrency)

    tasks = [
        asyncio.create_task(cleanup_loop(settings, imports)),
        asyncio.create_task(enqueue_existing(settings, queue, imports, queued_paths)),
        asyncio.create_task(watch_incoming(settings, queue, imports, queued_paths)),
    ]
    for index in range(settings.processor_concurrency):
        tasks.append(asyncio.create_task(worker(f"worker-{index + 1}", queue, queued_paths, settings, imports, session_factory, parse_executor, slots)))
        if settings.url_imports_enabled:
            tasks.append(asyncio.create_task(download_worker(f"download-{index + 1}", settings, imports, session_factory, parse_executor, slots)))
    logger.info("processor_started", incoming_directory=str(settings.incoming_directory), concurrency=settings.processor_concurrency)
    await asyncio.gather(*tasks)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
