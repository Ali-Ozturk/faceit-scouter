from pathlib import Path

import zstandard as zstd

from scout_processor.errors.exceptions import ErrorCode, ProcessingError


def decompress_if_needed(source: Path, decompressed_directory: Path) -> Path:
    if not source.name.endswith(".dem.zst"):
        return source
    destination = decompressed_directory / source.name.removesuffix(".zst")
    try:
        with source.open("rb") as compressed, destination.open("wb") as output:
            zstd.ZstdDecompressor().copy_stream(compressed, output)
    except Exception as exc:
        raise ProcessingError(ErrorCode.DECOMPRESSION_FAILED, str(exc)) from exc
    return destination
