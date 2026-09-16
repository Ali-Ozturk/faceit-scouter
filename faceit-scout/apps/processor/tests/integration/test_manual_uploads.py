"""Opt-in real HTTP upload -> PostgreSQL -> real parser test. Never uses FACEIT.

Set SCOUT_TEST_DATABASE_URL (database must be scout_test), SCOUT_TEST_WEB_URL,
SCOUT_TEST_DEMO and SCOUT_TEST_UPLOAD_ROOT. Web must share that root as
DEMO_UPLOAD_DIRECTORY=<root>/temporary/url-imports and use the test key below.
"""
import asyncio
import hashlib
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
from uuid import uuid4

import pytest
from sqlalchemy import text
from scout_processor.config import Settings
from scout_processor.database.engine import make_session_factory
from scout_processor.database.repositories.imports import ImportRepository
from scout_processor.ingestion import downloads
from scout_processor.ingestion.file_claiming import claim_file
from scout_processor.database.models import ImportStatus

KEY = 'integration-test-only-key-20260916'

@pytest.mark.asyncio
async def test_manual_upload_end_to_end(monkeypatch):
    database = os.environ.get('SCOUT_TEST_DATABASE_URL')
    web = os.environ.get('SCOUT_TEST_WEB_URL')
    source_name = os.environ.get('SCOUT_TEST_DEMO')
    root_name = os.environ.get('SCOUT_TEST_UPLOAD_ROOT')
    if not all((database, web, source_name, root_name)):
        pytest.skip('Set manual upload integration environment variables')
    assert database.endswith('/scout_test')
    source, root = Path(source_name), Path(root_name)
    settings = Settings(_env_file=None, database_url=database, faceit_api_token=None,
        **{f'{name}_directory': root / name for name in ['incoming','processing','completed','failed','decompressed','temporary']})
    settings.ensure_directories()
    factory = make_session_factory(settings)
    imports = ImportRepository(factory)
    # Fail immediately if the manual pipeline ever attempts remote download.
    monkeypatch.setattr(downloads, 'download_demo', lambda *args: pytest.fail('Unexpected remote download'))
    def request(path='', method='GET', body=None, headers=None, key=KEY):
        req = Request(web+'/api/demo-uploads'+path, method=method, data=body,
            headers={'Authorization':'Bearer '+key, **(headers or {})})
        try:
            with urlopen(req, timeout=90) as response: return response.status, json.load(response)
        except HTTPError as error: return error.code, json.load(error)
    def batch(match):
        return request(method='POST',body=json.dumps({'demos':[{'faceitMatchId':match,'requesterNickname':'upload-integration'}]}).encode(),headers={'Content-Type':'application/json'})
    def job(job_id):
        with factory() as session:
            return session.execute(text('select * from demo_download where id=:id'), {'id':job_id}).mappings().one()
    with factory() as session:
        assert session.execute(text('select count(*) from demo_download')).scalar() == 0, 'Start with a fresh test database'
    matches=['1-'+str(uuid4()) for _ in range(10)]
    assert request(key='wrong')[0] == 401
    # Compile route before concurrent test requests.
    first_status, first_body=batch(matches[0])
    assert first_status == 202
    with ThreadPoolExecutor(9) as pool: responses=list(pool.map(batch,matches[1:]))
    assert sorted(r[0] for r in responses) == [202]*8+[409]
    first_id=first_body['jobs'][0]['id']
    assert batch(matches[0])[1]['jobs'][0]['id'] == first_id
    for method in ['GET','PUT','DELETE']:
        assert request('/'+first_id,method,key='wrong')[0] == 401
    # Cancel one reservation, freeing its slot.
    cancel_id=next(r[1]['jobs'][0]['id'] for r in responses if r[0]==202)
    assert request('/'+cancel_id,'DELETE')[0] == 200
    assert job(cancel_id)['status'] == 'FAILED'
    legacy = Request(web+'/api/demo-downloads',method='POST',headers={'Authorization':'Bearer '+KEY})
    with pytest.raises(HTTPError) as error: urlopen(legacy)
    assert error.value.code == 410
    size=source.stat().st_size
    with source.open('rb') as f:
        sample=f.read(65536); f.seek(max(0,size-65536)); sample+=f.read()
    fingerprint=hashlib.sha256(sample).hexdigest()
    # Source fixture may be renamed; explicitly associate it with this test match.
    filename='fixture.dem.zst' if source.name.endswith('.zst') else 'fixture.dem.gz' if source.name.endswith('.gz') else 'fixture.dem'
    offset=0
    with source.open('rb') as f:
        while chunk:=f.read(4*1024*1024):
            headers={'Content-Type':'application/octet-stream','X-File-Name':quote(filename),'X-File-Size':str(size),'X-File-Fingerprint':fingerprint,'X-Upload-Offset':str(offset)}
            status,result=request('/'+first_id,'PUT',chunk,headers)
            assert status == 200, result
            offset=result['offset']
            if offset < size:
                assert job(first_id)['status'] == 'UPLOADING'
                # Resume state survives an independent HTTP client/request.
                assert request('/'+first_id)[1]['offset'] == offset
    assert job(first_id)['status']=='QUEUED'
    # Two actual polling workers compete for the completed upload. Only one parses.
    workers=[asyncio.create_task(downloads.download_worker(f'upload-worker-{n}',settings,imports,factory,None,asyncio.Semaphore(2))) for n in range(2)]
    try:
        for _ in range(600):
            await asyncio.sleep(0.1)
            if job(first_id)['status'] in ('COMPLETED','FAILED'): break
    finally:
        for worker in workers: worker.cancel()
        await asyncio.gather(*workers,return_exceptions=True)
    final=job(first_id)
    assert final['status']=='COMPLETED', final
    assert final['signed_url'] is None
    with factory() as session:
        parsed=session.execute(text('select parsed_match_id,current_path,status from imported_demo where id=:id'),{'id':final['import_id']}).mappings().one()
    assert parsed['parsed_match_id'] and parsed['status']=='COMPLETED' and parsed['current_path'] is None
    assert not list(settings.processing_directory.iterdir())
    assert not list(settings.decompressed_directory.iterdir())
    assert source.stat().st_size == size
    # Simulate a process exit after the atomic file claim, then recover/deduplicate.
    second_id=batch(matches[0])[1]['jobs'][0]['id']
    suffix='.dem.zst' if filename.endswith('.zst') else '.dem.gz' if filename.endswith('.gz') else '.dem'
    recovery_name=f'{matches[0]}_{second_id}{suffix}'
    recovery_path=settings.temporary_directory / 'url-imports' / recovery_name
    shutil.copyfile(source,recovery_path)
    imported=imports.create_or_get(recovery_path)
    claimed=claim_file(recovery_path,settings.processing_directory)
    imports.update_status(imported.id,ImportStatus.PARSING,current_path=str(claimed))
    downloads.update_job(factory,second_id,file_name=recovery_name,status='PROCESSING',import_id=imported.id)
    await downloads.handle_job(job(second_id),settings,imports,factory,None,'recovery')
    assert job(second_id)['status']=='COMPLETED'
    with factory() as session:
        assert session.execute(text('select status from imported_demo where id=:id'),{'id':imported.id}).scalar()=='DUPLICATE'
    assert not claimed.exists()
    # Existing queued URL jobs cannot bypass the disabled HTTP endpoint.
    blocked=dict(final, signed_url='https://example.invalid/private-demo')
    with pytest.raises(downloads.DownloadError,match='URL imports are disabled'):
        await downloads.handle_job(blocked,settings,imports,factory,None,'blocked')
    factory.kw['bind'].dispose()
