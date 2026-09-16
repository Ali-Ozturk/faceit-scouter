import asyncio
from time import perf_counter
from concurrent.futures import Executor
from pathlib import Path

import structlog
from sqlalchemy.orm import Session, sessionmaker

from scout_processor.config import Settings
from scout_processor.database.models import ImportStatus
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.database.repositories.matches import persist_parsed_demo
from scout_processor.errors.exceptions import ErrorCode, ProcessingError
from scout_processor.faceit_metadata import FaceitMetadataError, fetch_match_played_at
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
    expected_map: str | None = None,
) -> None:
    total_started_at = perf_counter()
    imported = imports.create_or_get(path)
    claimed_path: Path | None = None
    demo_path: Path | None = None
    committed = False

    try:
        stage_started_at = perf_counter()
        imports.update_status(imported.id, ImportStatus.WAITING_FOR_STABILITY)
        claimed_path = claim_file(path, settings.processing_directory)
        imports.update_status(imported.id, ImportStatus.CLAIMED, current_path=str(claimed_path), faceit_match_id=extract_faceit_match_id(claimed_path.name))
        log_stage_timing(imports, "claim", stage_started_at, worker_name, imported.id, path.name)

        stage_started_at = perf_counter()
        checksum = await asyncio.to_thread(sha256_file, claimed_path)
        log_stage_timing(imports, "checksum", stage_started_at, worker_name, imported.id, path.name)

        stage_started_at = perf_counter()
        duplicate = imports.find_completed_by_checksum(checksum)
        log_stage_timing(imports, "duplicate_lookup", stage_started_at, worker_name, imported.id, path.name)
        if duplicate:
            selected_match = extract_faceit_match_id(claimed_path.name)
            if selected_match and duplicate.faceit_match_id and selected_match != duplicate.faceit_match_id:
                raise ProcessingError(ErrorCode.PARSER_FAILED, 'This demo was already imported for a different FACEIT match.')
            stage_started_at = perf_counter()
            completed = move_file(claimed_path, settings.completed_directory) if settings.keep_completed_demos else claimed_path
            imports.update_status(
                imported.id,
                ImportStatus.DUPLICATE,
                sha256_checksum=checksum,
                current_path=str(completed),
                duplicate_of_import_id=duplicate.id,
                parsed_match_id=duplicate.parsed_match_id,
            )
            committed = True
            cleanup_completed(imported.id, completed, settings, imports)
            log_stage_timing(imports, "duplicate_move", stage_started_at, worker_name, imported.id, path.name)
            log_stage_timing(imports, "total", total_started_at, worker_name, imported.id, path.name)
            return

        imports.update_status(imported.id, ImportStatus.DECOMPRESSING, sha256_checksum=checksum)
        stage_started_at = perf_counter()
        demo_path = await asyncio.to_thread(decompress_if_needed, claimed_path, settings.decompressed_directory, settings.max_demo_bytes)
        log_stage_timing(imports, "decompress", stage_started_at, worker_name, imported.id, path.name)

        imports.update_status(imported.id, ImportStatus.PARSING, parser_name=settings.parser_name, parser_version=parser_version(), schema_version=settings.schema_version)
        logger.info("parse_started", worker=worker_name, import_id=str(imported.id), file_name=path.name)
        parse_started_at = perf_counter()
        parsed = await asyncio.get_running_loop().run_in_executor(parse_executor, parse_demo_in_process, str(demo_path), checksum)
        if expected_map and parsed.map_name.lower() != expected_map.lower():
            raise ProcessingError(ErrorCode.PARSER_FAILED, 'The demo map does not match the selected historical match. Check the file assignment.')
        parse_duration_ms = duration_ms(parse_started_at)
        imports.record_stage_log(
            imported.id,
            source="processor",
            stage="parse",
            duration_ms=parse_duration_ms,
            worker=worker_name,
            metadata={
                "map_name": parsed.map_name,
                "teams": len(parsed.teams),
                "rounds": len(parsed.rounds),
                "position_samples": len(parsed.position_samples),
                "grenades": len(parsed.grenades),
            },
        )
        if parsed.faceit_match_id and not parsed.played_at:
            stage_started_at = perf_counter()
            parsed.played_at = await fetch_played_at(parsed.faceit_match_id, settings, worker_name, imported.id)
            log_stage_timing(imports, "faceit_metadata", stage_started_at, worker_name, imported.id, path.name)
        logger.info("parse_finished", worker=worker_name, import_id=str(imported.id), file_name=path.name, map_name=parsed.map_name, duration_ms=parse_duration_ms)

        imports.update_status(imported.id, ImportStatus.PERSISTING)
        stage_started_at = perf_counter()
        with session_factory() as session:
            db_import = session.get(type(imported), imported.id)
            if db_import is None:
                raise ProcessingError(ErrorCode.DATABASE_PERSISTENCE_FAILED, "Import row disappeared")
            persist_parsed_demo(session, db_import, parsed)
            from datetime import datetime, UTC
            db_import.status = ImportStatus.COMPLETED
            db_import.processing_completed_at = datetime.now(UTC)
            session.commit()
            committed = True
        log_stage_timing(imports, "persist", stage_started_at, worker_name, imported.id, path.name)

        stage_started_at = perf_counter()
        completed = move_file(claimed_path, settings.completed_directory) if settings.keep_completed_demos else claimed_path
        imports.update_status(imported.id, ImportStatus.COMPLETED, current_path=str(completed), faceit_match_id=parsed.faceit_match_id)
        cleanup_completed(imported.id, completed, settings, imports)
        log_stage_timing(imports, "completion_move", stage_started_at, worker_name, imported.id, path.name)
        log_stage_timing(imports, "total", total_started_at, worker_name, imported.id, path.name)
        logger.info("import_completed", import_id=str(imported.id), file_name=path.name, checksum=checksum, map_name=parsed.map_name, duration_ms=duration_ms(total_started_at))
    except ProcessingError as exc:
        if not committed:
            await _fail(imported.id, claimed_path or path, settings, imports, exc.code.value, exc.message)
        else:
            logger.warning("post_commit_cleanup_pending", import_id=str(imported.id))
    except Exception as exc:
        if not committed:
            await _fail(imported.id, claimed_path or path, settings, imports, ErrorCode.UNKNOWN_ERROR.value, str(exc))
        else:
            logger.warning("post_commit_cleanup_pending", import_id=str(imported.id))
    finally:
        if demo_path and demo_path != claimed_path and not settings.keep_decompressed_demos:
            try:
                demo_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("scratch_cleanup_pending", import_id=str(imported.id))


def cleanup_completed(import_id, source, settings, imports):
    if settings.keep_completed_demos:
        return
    try:
        if source.name.endswith(('.dem.zst', '.dem.gz')) and not settings.keep_decompressed_demos:
            (settings.decompressed_directory / source.stem).unlink(missing_ok=True)
        source.unlink(missing_ok=True)
        # Preserve the terminal status while clearing the now-removed file path.
        from sqlalchemy import update
        from scout_processor.database.models import ImportedDemo
        with imports.session_factory() as session:
            session.execute(update(ImportedDemo).where(ImportedDemo.id == import_id).values(current_path=None))
            session.commit()
    except Exception:
        # A cleanup failure must never turn persisted results into a failed import.
        logger.warning("completed_cleanup_pending", import_id=str(import_id))


async def cleanup_loop(settings, imports):
    from sqlalchemy import select
    from scout_processor.database.models import ImportedDemo
    while True:
        if not settings.keep_completed_demos:
            try:
                with imports.session_factory() as session:
                    rows = session.scalars(select(ImportedDemo).where(
                        ImportedDemo.status.in_([ImportStatus.COMPLETED, ImportStatus.DUPLICATE]),
                        ImportedDemo.current_path.is_not(None),
                    )).all()
                for row in rows:
                    path = Path(row.current_path)
                    if path.resolve().parent in {settings.processing_directory.resolve(), settings.completed_directory.resolve()}:
                        cleanup_completed(row.id, path, settings, imports)
            except Exception:
                logger.warning("retention_cleanup_retry")
        await asyncio.sleep(60)


async def _fail(import_id, source: Path, settings: Settings, imports: ImportRepository, code: str, message: str) -> None:
    failed_path = source
    try:
        if source.exists() and source.parent != settings.failed_directory:
            failed_path = move_file(source, settings.failed_directory)
    except Exception as move_exc:
        message = f"{message}; additionally failed to move file: {move_exc}"
    imports.update_status(import_id, ImportStatus.FAILED, current_path=str(failed_path), error_code=code, error_message=message)
    logger.error("import_failed", import_id=str(import_id), error_code=code, error_message=message)


async def fetch_played_at(match_id: str, settings: Settings, worker_name: str | None, import_id) -> object:
    if not settings.faceit_api_token:
        logger.info("faceit_metadata_skipped", worker=worker_name, import_id=str(import_id), reason="missing_token")
        return None
    try:
        played_at = await asyncio.to_thread(fetch_match_played_at, match_id, settings.faceit_api_token)
    except FaceitMetadataError as exc:
        logger.warning("faceit_metadata_failed", worker=worker_name, import_id=str(import_id), faceit_match_id=match_id, error=str(exc))
        return None
    if played_at:
        logger.info("faceit_metadata_found", worker=worker_name, import_id=str(import_id), faceit_match_id=match_id, played_at=played_at.isoformat())
    else:
        logger.info("faceit_metadata_missing_date", worker=worker_name, import_id=str(import_id), faceit_match_id=match_id)
    return played_at


def duration_ms(started_at: float) -> int:
    return round((perf_counter() - started_at) * 1000)


def log_stage_timing(imports: ImportRepository, stage: str, started_at: float, worker_name: str | None, import_id, file_name: str) -> None:
    elapsed_ms = duration_ms(started_at)
    imports.record_stage_log(
        import_id,
        source="processor",
        stage=stage,
        duration_ms=elapsed_ms,
        worker=worker_name,
    )
    logger.info(
        "processor_stage_completed",
        stage=stage,
        duration_ms=elapsed_ms,
        worker=worker_name,
        import_id=str(import_id),
        file_name=file_name,
    )
