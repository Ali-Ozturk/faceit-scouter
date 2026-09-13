import asyncio
import errno
import hashlib
import uuid
from pathlib import Path

import pytest

from scout_processor.analysis.lineup import exact_lineup_fingerprint
from scout_processor.ingestion.checksum import sha256_file
from scout_processor.ingestion.file_claiming import claim_file
from scout_processor.parsing.demo_parser import extract_faceit_match_id
from scout_processor.watcher.file_stability import is_supported_demo, wait_until_stable
from scout_processor.watcher.directory_watcher import enqueue_existing


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


def test_claim_file_falls_back_for_cross_device_move(monkeypatch):
    root = workdir()
    incoming = root / "incoming"
    processing = root / "processing"
    incoming.mkdir()
    processing.mkdir()
    source = incoming / "sample.dem.zst"
    source.write_bytes(b"demo")

    def raise_cross_device(_self, _target):
        raise OSError(errno.EXDEV, "Invalid cross-device link")

    monkeypatch.setattr(Path, "replace", raise_cross_device)

    claimed = claim_file(source, processing)

    assert claimed == processing / "sample.dem.zst"
    assert claimed.read_bytes() == b"demo"
    assert not source.exists()


def test_faceit_match_id_extraction():
    value = extract_faceit_match_id("2b2a3f77-0a37-4b74-96a3-7f03ae193491.dem.zst")
    assert value == "2b2a3f77-0a37-4b74-96a3-7f03ae193491"


def test_faceit_match_id_extraction_keeps_room_prefix():
    value = extract_faceit_match_id("1-2b2a3f77-0a37-4b74-96a3-7f03ae193491.dem.zst")
    assert value == "1-2b2a3f77-0a37-4b74-96a3-7f03ae193491"


def test_lineup_fingerprint_is_order_independent():
    assert exact_lineup_fingerprint(["3", "1", "2"]) == exact_lineup_fingerprint(["2", "3", "1"])


@pytest.mark.asyncio
async def test_wait_until_stable():
    path = workdir() / "stable.dem"
    path.write_bytes(b"demo")
    assert await wait_until_stable(path, 0.01, 1, 1)


class FakeSettings:
    def __init__(self, incoming_directory: Path) -> None:
        self.incoming_directory = incoming_directory


class FakeImports:
    def __init__(self) -> None:
        self.discovered: list[Path] = []

    async def create_discovered(self, path: Path):
        self.discovered.append(path)


@pytest.mark.asyncio
async def test_enqueue_existing_records_discovered_supported_demos():
    root = workdir()
    incoming = root / "incoming"
    incoming.mkdir()
    demo = incoming / "sample.dem.zst"
    ignored = incoming / "sample.dem.zst.crdownload"
    demo.write_bytes(b"demo")
    ignored.write_bytes(b"partial")
    queue: asyncio.Queue[Path] = asyncio.Queue()
    imports = FakeImports()

    await enqueue_existing(FakeSettings(incoming), queue, imports, set())

    assert imports.discovered == [demo]
    assert await queue.get() == demo.resolve()
