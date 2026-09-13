from pathlib import Path

import zstandard as zstd

from scout_processor.errors.exceptions import ErrorCode, ProcessingError


def decompress_if_needed(source: Path, decompressed_directory: Path, max_bytes: int = 4 * 1024 ** 3) -> Path:
    if not source.name.endswith(".dem.zst"):
        return source
    destination = decompressed_directory / source.name.removesuffix(".zst")
    try:
        with source.open("rb") as compressed, destination.open("wb") as output:
            with zstd.ZstdDecompressor().stream_reader(compressed) as reader:
                count = 0
                while chunk := reader.read(1024 * 1024):
                    count += len(chunk)
                    if count > max_bytes:
                        raise ValueError("Decompressed demo exceeds the size limit")
                    output.write(chunk)
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise ProcessingError(ErrorCode.DECOMPRESSION_FAILED, str(exc)) from exc
    return destination
