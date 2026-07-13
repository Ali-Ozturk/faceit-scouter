import asyncio
from concurrent.futures import Executor
from pathlib import Path

import structlog
from sqlalchemy.orm import Session, sessionmaker

from scout_processor.config import Settings
from scout_processor.database.models import ImportStatus
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.database.repositories.matches import persist_parsed_demo
from scout_processor.errors.exceptions import ErrorCode, ProcessingError
from scout_processor.ingestion.checksum import sha256_file
from scout_processor.ingestion.decompression import decompress_if_needed
from scout_processor.ingestion.file_claiming import claim_file, move_file
from scout_processor.parsing.demo_parser import DemoParser, extract_faceit_match_id, parser_version

logger = structlog.get_logger(__name__)


def parse_demo_in_process(demo_path: str, checksum: str):
    return DemoParser().parse(Path(demo_path), checksum)


async def process_file(
    path: Path,
    settings: Settings,
    imports: ImportRepository,
    session_factory: sessionmaker[Session],
    parse_executor: Executor | None = None,
    worker_name: str | None = None,
) -> None:
    imported = imports.create_or_get(path)
    claimed_path: Path | None = None
    demo_path: Path | None = None

    try:
        imports.update_status(imported.id, ImportStatus.WAITING_FOR_STABILITY)
        claimed_path = claim_file(path, settings.processing_directory)
        imports.update_status(imported.id, ImportStatus.CLAIMED, current_path=str(claimed_path), faceit_match_id=extract_faceit_match_id(claimed_path.name))

        checksum = await asyncio.to_thread(sha256_file, claimed_path)
        duplicate = imports.find_completed_by_checksum(checksum)
        if duplicate:
            completed = move_file(claimed_path, settings.completed_directory)
            imports.update_status(
                imported.id,
                ImportStatus.DUPLICATE,
                sha256_checksum=checksum,
                current_path=str(completed),
                duplicate_of_import_id=duplicate.id,
                parsed_match_id=duplicate.parsed_match_id,
            )
            return

        imports.update_status(imported.id, ImportStatus.DECOMPRESSING, sha256_checksum=checksum)
        demo_path = await asyncio.to_thread(decompress_if_needed, claimed_path, settings.decompressed_directory)

        imports.update_status(imported.id, ImportStatus.PARSING, parser_name=settings.parser_name, parser_version=parser_version(), schema_version=settings.schema_version)
        logger.info("parse_started", worker=worker_name, import_id=str(imported.id), file_name=path.name)
        parsed = await asyncio.get_running_loop().run_in_executor(parse_executor, parse_demo_in_process, str(demo_path), checksum)
        logger.info("parse_finished", worker=worker_name, import_id=str(imported.id), file_name=path.name, map_name=parsed.map_name)

        imports.update_status(imported.id, ImportStatus.PERSISTING)
        with session_factory() as session:
            db_import = session.get(type(imported), imported.id)
            if db_import is None:
                raise ProcessingError(ErrorCode.DATABASE_PERSISTENCE_FAILED, "Import row disappeared")
            persist_parsed_demo(session, db_import, parsed)
            session.commit()

        completed = move_file(claimed_path, settings.completed_directory)
        imports.update_status(imported.id, ImportStatus.COMPLETED, current_path=str(completed), faceit_match_id=parsed.faceit_match_id)
        if demo_path != claimed_path and demo_path.exists() and not settings.keep_decompressed_demos:
            demo_path.unlink()
        logger.info("import_completed", import_id=str(imported.id), file_name=path.name, checksum=checksum, map_name=parsed.map_name)
    except ProcessingError as exc:
        await _fail(imported.id, claimed_path or path, settings, imports, exc.code.value, exc.message)
    except Exception as exc:
        await _fail(imported.id, claimed_path or path, settings, imports, ErrorCode.UNKNOWN_ERROR.value, str(exc))


async def _fail(import_id, source: Path, settings: Settings, imports: ImportRepository, code: str, message: str) -> None:
    failed_path = source
    try:
        if source.exists() and source.parent != settings.failed_directory:
            failed_path = move_file(source, settings.failed_directory)
    except Exception as move_exc:
        message = f"{message}; additionally failed to move file: {move_exc}"
    imports.update_status(import_id, ImportStatus.FAILED, current_path=str(failed_path), error_code=code, error_message=message)
    logger.error("import_failed", import_id=str(import_id), error_code=code, error_message=message)
