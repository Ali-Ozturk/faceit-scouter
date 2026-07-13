import zstandard as zstd
import uuid
from pathlib import Path

from scout_processor.ingestion.decompression import decompress_if_needed


def workdir() -> Path:
    path = Path(__file__).resolve().parents[4] / "data" / "temporary" / f"unit-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_decompress_zst():
    root = workdir()
    source = root / "demo.dem.zst"
    source.write_bytes(zstd.ZstdCompressor().compress(b"demo-bytes"))
    out = decompress_if_needed(source, root)
    assert out.name == "demo.dem"
    assert out.read_bytes() == b"demo-bytes"
