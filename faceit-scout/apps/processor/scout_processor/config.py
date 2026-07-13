from pathlib import Path

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    database_url: PostgresDsn
    incoming_directory: Path = Path("./data/incoming")
    processing_directory: Path = Path("./data/processing")
    completed_directory: Path = Path("./data/completed")
    failed_directory: Path = Path("./data/failed")
    decompressed_directory: Path = Path("./data/decompressed")
    temporary_directory: Path = Path("./data/temporary")

    file_stability_interval_seconds: float = 1
    file_stability_required_checks: int = 3
    file_stability_timeout_seconds: float = 60
    processor_concurrency: int = 3
    keep_decompressed_demos: bool = False
    max_demo_bytes: int = Field(default=4 * 1024 * 1024 * 1024)

    parser_name: str = "demoparser2"
    schema_version: int = 1
    analysis_version: int = 1
    log_level: str = "INFO"

    @field_validator(
        "incoming_directory",
        "processing_directory",
        "completed_directory",
        "failed_directory",
        "decompressed_directory",
        "temporary_directory",
    )
    @classmethod
    def normalize_path(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    def ensure_directories(self) -> None:
        for path in (
            self.incoming_directory,
            self.processing_directory,
            self.completed_directory,
            self.failed_directory,
            self.decompressed_directory,
            self.temporary_directory,
        ):
            path.mkdir(parents=True, exist_ok=True)
