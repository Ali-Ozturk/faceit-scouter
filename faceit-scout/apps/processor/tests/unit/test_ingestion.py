import asyncio
import hashlib
import uuid
from pathlib import Path

import pytest

from scout_processor.analysis.lineup import exact_lineup_fingerprint
from scout_processor.ingestion.checksum import sha256_file
from scout_processor.parsing.demo_parser import extract_faceit_match_id
from scout_processor.watcher.file_stability import is_supported_demo, wait_until_stable


def workdir() -> Path:
    path = Path(__file__).resolve().parents[4] / "data" / "temporary" / f"unit-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_supported_demo_filtering():
    root = workdir()
    assert is_supported_demo(root / "match.dem")
    assert is_supported_demo(root / "match.dem.zst")
    assert not is_supported_demo(root / ".match.dem")
    assert not is_supported_demo(root / "match.dem.crdownload")
    assert not is_supported_demo(root / "match.zip")


def test_checksum():
    path = workdir() / "sample.dem"
    path.write_bytes(b"abc")
    assert sha256_file(path) == hashlib.sha256(b"abc").hexdigest()


def test_faceit_match_id_extraction():
    value = extract_faceit_match_id("2b2a3f77-0a37-4b74-96a3-7f03ae193491.dem.zst")
    assert value == "2b2a3f77-0a37-4b74-96a3-7f03ae193491"


def test_lineup_fingerprint_is_order_independent():
    assert exact_lineup_fingerprint(["3", "1", "2"]) == exact_lineup_fingerprint(["2", "3", "1"])


@pytest.mark.asyncio
async def test_wait_until_stable():
    path = workdir() / "stable.dem"
    path.write_bytes(b"demo")
    assert await wait_until_stable(path, 0.01, 1, 1)
