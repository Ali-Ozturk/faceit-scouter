import zstandard as zstd
import uuid
import gzip
import pytest
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


def test_decompress_gzip_and_limit():
    root = workdir()
    source = root / 'demo.dem.gz'
    source.write_bytes(gzip.compress(b'demo-bytes'))
    assert decompress_if_needed(source, root).read_bytes() == b'demo-bytes'
    with pytest.raises(Exception, match='size limit'):
        decompress_if_needed(source, root, 4)
    assert not (root / 'demo.dem').exists()
