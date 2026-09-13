"""Opt-in integration check against a DISPOSABLE scout_test database and web server.

SCOUT_TEST_DATABASE_URL, SCOUT_TEST_WEB_URL, SCOUT_TEST_DEMO must be set.
The web server must use the same database and integration-test-only-key-20260913.
This test resets imports and matches in the explicitly named scout_test database.
"""
import asyncio
import json
import os
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from sqlalchemy import text

from scout_processor.config import Settings
from scout_processor.database.engine import make_session_factory
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.database.models import ImportStatus
from scout_processor.ingestion import downloads
from scout_processor.ingestion.file_claiming import claim_file


@pytest.mark.asyncio
async def test_admission_parse_recovery_and_retention(monkeypatch):
    database = os.environ.get('SCOUT_TEST_DATABASE_URL')
    web = os.environ.get('SCOUT_TEST_WEB_URL')
    demo = os.environ.get('SCOUT_TEST_DEMO')
    if not all((database, web, demo)):
        pytest.skip('Set SCOUT_TEST_DATABASE_URL, SCOUT_TEST_WEB_URL, SCOUT_TEST_DEMO for integration checks')
    assert database.endswith('/scout_test'), 'Use only the disposable scout_test database'
    source = Path(demo)
    original_size = source.stat().st_size
    root = Path(__file__).resolve().parents[4] / 'data' / 'temporary' / f'unit-integration-{uuid.uuid4().hex}'
    settings = Settings(_env_file=None, database_url=database, faceit_api_token=None,
        **{f'{name}_directory': root / name for name in ['incoming', 'processing', 'completed', 'failed', 'decompressed', 'temporary']})
    settings.ensure_directories()
    factory = make_session_factory(settings)
    imports = ImportRepository(factory)
    with factory() as session:
        session.execute(text('DELETE FROM demo_download'))
        session.execute(text('TRUNCATE imported_demo, cs_match CASCADE'))
        session.commit()

    def request(demos=None, key='integration-test-only-key-20260913'):
        req = Request(web + '/api/demo-downloads', data=json.dumps({'demos': demos}).encode() if demos else None,
                      headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
        try:
            with urlopen(req, timeout=20) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    host = settings.demo_download_hosts.split(',')[0]
    payloads = [[{'faceitMatchId': '1-' + str(uuid.uuid4()), 'url': f'https://{host}/a.dem.zst?signature=private-test-value'}] for _ in range(4)]
    assert request(key='wrong')[0] == 401
    with ThreadPoolExecutor(4) as pool:
        responses = list(pool.map(request, payloads))
    assert sorted(status for status, _ in responses) == [202, 202, 202, 409]
    accepted = [payload for payload, response in zip(payloads, responses) if response[0] == 202]
    first_id = request(accepted[0])[1]['jobs'][0]['id']
    assert request(accepted[0])[1]['jobs'][0]['id'] == first_id
    assert 'private-test-value' not in json.dumps(request()[1])

    class Response:
        status = 200
        def __init__(self): self.file = source.open('rb')
        def getheader(self, name): return str(original_size)
        def read1(self, size): return self.file.read(size)
    class Connection:
        def __init__(self, *args, **kwargs): self.response = Response()
        def request(self, *args, **kwargs): pass
        def getresponse(self): return self.response
        def close(self): self.response.file.close()
    monkeypatch.setattr(downloads, 'PinnedHTTPSConnection', Connection)

    def get_job(job_id):
        with factory() as session:
            return session.execute(text('SELECT * FROM demo_download WHERE id=:id'), {'id': job_id}).mappings().one()

    # Real compressed demo -> actual parser -> committed PostgreSQL -> files deleted.
    await downloads.handle_job(get_job(first_id), settings, imports, factory, None, 'integration')
    first = get_job(first_id)
    assert first['status'] == 'COMPLETED' and first['signed_url'] is None
    with factory() as session:
        imported = session.execute(text('SELECT status,current_path,parsed_match_id FROM imported_demo WHERE id=:id'), {'id': first['import_id']}).mappings().one()
    assert imported['status'] == 'COMPLETED' and imported['parsed_match_id']
    assert imported['current_path'] is None
    assert not list(settings.processing_directory.iterdir())
    assert not list(settings.decompressed_directory.iterdir())

    # Simulate a crash after claiming a file: recover without its cleared signed URL.
    second_id = request(accepted[1])[1]['jobs'][0]['id']
    second = get_job(second_id)
    filename = f"{second['faceit_match_id']}_{second_id}.dem.zst"
    path = settings.temporary_directory / 'url-imports' / filename
    shutil.copyfile(source, path)
    row = imports.create_or_get(path)
    claimed = claim_file(path, settings.processing_directory)
    imports.update_status(row.id, ImportStatus.PARSING, current_path=str(claimed))
    downloads.update_job(factory, second_id, file_name=filename, signed_url=None, status='PROCESSING', import_id=row.id)
    await downloads.handle_job(get_job(second_id), settings, imports, factory, None, 'recovery')
    assert get_job(second_id)['status'] == 'COMPLETED'
    assert not claimed.exists() and not path.exists()

    # Interrupted download: replace its .part, then process/deduplicate normally.
    third_id = request(accepted[2])[1]['jobs'][0]['id']
    third = get_job(third_id)
    filename = f"{third['faceit_match_id']}_{third_id}.dem.zst"
    partial = settings.temporary_directory / 'url-imports' / (filename + '.part')
    partial.write_bytes(b'interrupted')
    downloads.update_job(factory, third_id, file_name=filename, status='DOWNLOADING')
    await downloads.handle_job(get_job(third_id), settings, imports, factory, None, 'download-recovery')
    assert get_job(third_id)['status'] == 'COMPLETED' and not partial.exists()
    assert source.exists() and source.stat().st_size == original_size
    assert not list((settings.temporary_directory / 'url-imports').iterdir())

    # Two live workers race for one expired URL: one claims it and releases the slot.
    failed_id = request(payloads[3])[1]['jobs'][0]['id']
    Response.status = 403
    slots = asyncio.Semaphore(2)
    tasks = [asyncio.create_task(downloads.download_worker(f'failure-{n}', settings, imports, factory, None, slots)) for n in range(2)]
    try:
        for _ in range(50):
            await asyncio.sleep(0.1)
            if get_job(failed_id)['status'] == 'FAILED':
                break
        failed = get_job(failed_id)
        assert failed['status'] == 'FAILED' and failed['signed_url'] is None
        assert '403' in failed['error'] and 'private-test-value' not in failed['error']
        assert not list((settings.temporary_directory / 'url-imports').iterdir())
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    factory.kw['bind'].dispose()
