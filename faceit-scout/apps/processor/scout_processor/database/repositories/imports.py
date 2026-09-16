from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from scout_processor.database.models import CsMatch, ImportedDemo, ImportStageLog, ImportStatus, RoundPositionSample


class ImportRepository:
    def __init__(self, session_factory: sessionmaker[Session]):
        self.session_factory = session_factory

    async def create_discovered(self, path: Path) -> UUID:
        with self.session_factory() as session:
            existing = session.scalar(
                select(ImportedDemo).where(
                    ImportedDemo.original_path == str(path),
                    ImportedDemo.status.in_([ImportStatus.DISCOVERED, ImportStatus.WAITING_FOR_STABILITY]),
                )
            )
            if existing:
                return existing.id
            row = ImportedDemo(
                file_name=path.name,
                original_path=str(path),
                current_path=str(path),
                source_extension=".dem.zst" if path.name.endswith(".dem.zst") else ".dem.gz" if path.name.endswith(".dem.gz") else path.suffix,
                file_size=path.stat().st_size if path.exists() else 0,
                status=ImportStatus.DISCOVERED,
            )
            session.add(row)
            session.commit()
            return row.id

    def create_or_get(self, path: Path) -> ImportedDemo:
        with self.session_factory() as session:
            row = session.scalar(select(ImportedDemo).where(ImportedDemo.original_path == str(path)).order_by(ImportedDemo.created_at.desc()))
            if row:
                session.expunge(row)
                return row
            row = ImportedDemo(
                file_name=path.name,
                original_path=str(path),
                current_path=str(path),
                source_extension=".dem.zst" if path.name.endswith(".dem.zst") else ".dem.gz" if path.name.endswith(".dem.gz") else path.suffix,
                file_size=path.stat().st_size,
                status=ImportStatus.DISCOVERED,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            session.expunge(row)
            return row

    def update_status(self, import_id: UUID, status: ImportStatus, **fields) -> None:
        with self.session_factory() as session:
            row = session.get(ImportedDemo, import_id)
            if not row:
                return
            row.status = status
            row.updated_at = datetime.now(UTC)
            for key, value in fields.items():
                setattr(row, key, value)
            if status == ImportStatus.CLAIMED:
                row.processing_started_at = datetime.now(UTC)
            if status in (ImportStatus.COMPLETED, ImportStatus.DUPLICATE):
                row.processing_completed_at = datetime.now(UTC)
            if status == ImportStatus.FAILED:
                row.failed_at = datetime.now(UTC)
            session.commit()

    def record_stage_log(
        self,
        import_id: UUID,
        source: str,
        stage: str,
        duration_ms: int,
        worker: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        with self.session_factory() as session:
            session.add(
                ImportStageLog(
                    import_id=import_id,
                    source=source,
                    stage=stage,
                    duration_ms=duration_ms,
                    worker=worker,
                    metadata_json=metadata,
                )
            )
            session.commit()

    def find_completed_by_checksum(self, checksum: str) -> ImportedDemo | None:
        with self.session_factory() as session:
            row = session.scalar(
                select(ImportedDemo)
                .join(CsMatch, ImportedDemo.parsed_match_id == CsMatch.id)
                .join(RoundPositionSample, RoundPositionSample.match_id == CsMatch.id)
                .where(
                    ImportedDemo.sha256_checksum == checksum,
                    ImportedDemo.status == ImportStatus.COMPLETED,
                    CsMatch.team_1_score.is_not(None),
                    CsMatch.team_2_score.is_not(None),
                )
                .group_by(ImportedDemo.id)
                .having(func.count(RoundPositionSample.id) >= 1000)
            )
            if row:
                session.expunge(row)
            return row
