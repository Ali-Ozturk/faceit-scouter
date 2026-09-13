import io
from pathlib import Path
from uuid import uuid4
from types import SimpleNamespace

import pytest
import zstandard

from scout_processor.ingestion import downloads
from scout_processor.ingestion.decompression import decompress_if_needed

HOST = 'demos-europe-central-faceit-cdn.s3.eu-central-003.backblazeb2.com'
URL = f'https://{HOST}/match.dem.zst?secret=do-not-log'


@pytest.fixture
def tmp_path():
    # Match the existing unit suite's Windows-compatible workspace scratch paths.
    root = Path(__file__).resolve().parents[4] / 'data' / 'temporary' / f'unit-{uuid4().hex}'
    root.mkdir(parents=True)
    return root


@pytest.mark.parametrize('url', [
    'http://' + HOST + '/a.dem', 'https://127.0.0.1/a.dem',
    f'https://{HOST}.evil.example/a.dem', f'https://user:pass@{HOST}/a.dem',
    f'https://{HOST}:8080/a.dem', f'https://{HOST}/a.zip',
])
def test_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        downloads.validate_url(url, HOST)


def test_rejects_private_dns(monkeypatch):
    monkeypatch.setattr(downloads.socket, 'getaddrinfo', lambda *a, **kw: [(2, 1, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError, match='public'):
        downloads.PinnedHTTPSConnection(HOST).connect()


@pytest.mark.parametrize('status,limit,length,success', [(200,100,'4',True), (302,100,'4',False), (403,100,'4',False), (200,3,None,False), (200,100,'8',False)])
def test_atomic_bounded_download(tmp_path, monkeypatch, status, limit, length, success):
    class Response(io.BytesIO):
        def getheader(self, name): return length
    response = Response(b'demo')
    response.status = status
    class Connection:
        def __init__(self, *a, **kw): pass
        def request(self, *a, **kw): pass
        def getresponse(self): return response
        def close(self): pass
    monkeypatch.setattr(downloads, 'PinnedHTTPSConnection', Connection)
    settings = SimpleNamespace(demo_download_hosts=HOST, max_download_bytes=limit, demo_download_timeout_seconds=10)
    target = tmp_path / 'match.dem.zst'
    if success:
        downloads.download_demo(URL, target, settings)
        assert target.read_bytes() == b'demo'
    else:
        with pytest.raises(ValueError) as error:
            downloads.download_demo(URL, target, settings)
        assert 'secret' not in str(error.value)
        assert not target.exists()
    assert not list(tmp_path.glob('*.part'))


def test_decompression_limit_removes_partial(tmp_path):
    source = tmp_path / 'a.dem.zst'
    source.write_bytes(zstandard.ZstdCompressor().compress(b'a' * 100))
    with pytest.raises(Exception, match='size limit'):
        decompress_if_needed(source, tmp_path, 10)
    assert source.exists()
    assert not (tmp_path / 'a.dem').exists()
