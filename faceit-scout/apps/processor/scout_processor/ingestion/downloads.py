"""Durable manual file imports. Remote URL acquisition is disabled."""
import asyncio
import http.client
import ipaddress
import socket
import ssl
import time
from pathlib import Path
from urllib.parse import urlsplit

import structlog
from sqlalchemy import text

from scout_processor.ingestion.lifecycle import process_file

logger = structlog.get_logger(__name__)
ACTIVE = "('QUEUED', 'DOWNLOADING', 'PROCESSING')"


class DownloadError(ValueError):
    """A controlled message safe to display without request credentials."""


def validate_url(url: str, allowed_hosts: str):
    parts = urlsplit(url)
    hosts = {host.strip().lower() for host in allowed_hosts.split(',')}
    if (parts.scheme != 'https' or parts.hostname not in hosts or parts.username
            or parts.password or parts.port not in (None, 443) or parts.fragment
            or not parts.path.lower().endswith(('.dem', '.dem.zst'))):
        raise DownloadError('Unsupported demo URL; the server allows only configured HTTPS demo hosts.')
    return parts


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Resolve once, reject private addresses, connect to that exact public IP."""
    def connect(self):
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise DownloadError('Demo host did not resolve exclusively to public addresses.')
        address = addresses[0][4][0]
        raw = socket.create_connection((address, self.port), self.timeout)
        try:
            self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def download_demo(url: str, target: Path, settings) -> None:
    parts = validate_url(url, settings.demo_download_hosts)
    partial = target.with_suffix(target.suffix + '.part')
    started = time.monotonic()
    connection = PinnedHTTPSConnection(parts.hostname, timeout=20)
    try:
        connection.request('GET', parts.path + ('?' + parts.query if parts.query else ''),
                           headers={'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        if response.status != 200:
            # Never include the URL or server response (which may echo credentials).
            raise DownloadError(f'Demo download returned HTTP {response.status}. Obtain a fresh URL in the extension.')
        length = response.getheader('Content-Length')
        if length and int(length) > settings.max_download_bytes:
            raise DownloadError('Compressed demo exceeds the download size limit.')
        count = 0
        with partial.open('wb') as output:
            while True:
                if time.monotonic() - started > settings.demo_download_timeout_seconds:
                    raise DownloadError('Demo download exceeded the time limit.')
                chunk = response.read1(256 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > settings.max_download_bytes:
                    raise DownloadError('Demo exceeds the download size limit.')
                output.write(chunk)
        if count == 0 or (length is not None and count != int(length)):
            raise DownloadError('Demo download was empty or incomplete.')
        partial.replace(target)
    finally:
        connection.close()
        partial.unlink(missing_ok=True)


def update_job(factory, job_id, **fields):
    # Column names come only from this module, never from request data.
    with factory() as session:
        session.execute(text('UPDATE demo_download SET ' + ', '.join(f'{key}=:{key}' for key in fields)
                             + ', updated_at=now() WHERE id=:id'), dict(fields, id=job_id))
        session.commit()


async def handle_job(job, settings, imports, factory, executor, name):
    job_id = job['id']
    if job['signed_url']:
        raise DownloadError('URL imports are disabled. Download manually on FACEIT and upload the file in Scout.')
    root = settings.temporary_directory / 'url-imports'
    root.mkdir(parents=True, exist_ok=True)
    filename = job['file_name']
    if not filename:
        raise DownloadError('No completed upload is attached to this job.')
    if Path(filename).name != filename:
        raise DownloadError('Invalid upload filename.')
    path = root / filename
    with factory() as session:
        imported = session.execute(text('SELECT id,status,current_path FROM imported_demo WHERE original_path=:path ORDER BY created_at DESC LIMIT 1'), {'path': str(path)}).mappings().first()
    if imported:
        update_job(factory, job_id, import_id=imported['id'])
        if imported['status'] in ('COMPLETED', 'DUPLICATE', 'FAILED'):
            update_job(factory, job_id, status='FAILED' if imported['status'] == 'FAILED' else 'COMPLETED', signed_url=None,
                       error='Parsing failed; see Imports for details.' if imported['status'] == 'FAILED' else None)
            return
        # Recover an interrupted parse using the already downloaded source.
        current = Path(imported['current_path']) if imported['current_path'] else path
        if not current.exists() and (settings.processing_directory / filename).exists():
            # The process may have died between the atomic claim and the DB update.
            current = settings.processing_directory / filename
        if current != path and current.exists():
            if current.resolve().parent != settings.processing_directory.resolve():
                raise DownloadError('Unexpected recovery path.')
            current.replace(path)
    if not path.exists():
        raise DownloadError('Uploaded file is missing. Open the match again and upload its demo.')
    (root / f'{job_id}.json').unlink(missing_ok=True)
    imported_row = imports.create_or_get(path)
    update_job(factory, job_id, status='PROCESSING', signed_url=None, import_id=imported_row.id)
    await process_file(path, settings, imports, factory, executor, name, expected_map=job.get('map_name'))
    with factory() as session:
        status = session.execute(text('SELECT status FROM imported_demo WHERE id=:id'), {'id': imported_row.id}).scalar_one()
    update_job(factory, job_id, status='COMPLETED' if status in ('COMPLETED', 'DUPLICATE') else 'FAILED',
               error=None if status in ('COMPLETED', 'DUPLICATE') else 'Parsing failed; see Imports for details.', signed_url=None)


async def download_worker(name, settings, imports, factory, executor, slots):
    engine = factory.kw['bind']
    while True:
        try:
            with factory() as session:
                ids = session.execute(text(f'SELECT id FROM demo_download WHERE status IN {ACTIVE} ORDER BY created_at')).scalars().all()
            for job_id in ids:
                async with slots:
                    # Session advisory lock survives commits and vanishes on process exit.
                    # A second processor cannot recover a job still owned by a live worker.
                    with engine.connect() as connection:
                        locked = connection.execute(text('SELECT pg_try_advisory_lock(hashtextextended(:id, 0))'), {'id': str(job_id)}).scalar()
                        connection.commit()
                        if not locked:
                            continue
                        try:
                            with factory() as session:
                                job = session.execute(text(f'SELECT * FROM demo_download WHERE id=:id AND status IN {ACTIVE}'), {'id': job_id}).mappings().first()
                            if job:
                                try:
                                    await handle_job(job, settings, imports, factory, executor, name)
                                except Exception as exc:
                                    # Only our controlled errors are safe to display; library errors can contain URLs.
                                    error = str(exc) if isinstance(exc, DownloadError) else 'Demo import failed. Check the file and upload it again.'
                                    update_job(factory, job_id, status='FAILED', error=error, signed_url=None)
                                    logger.warning('url_import_failed', job_id=str(job_id), error_type=type(exc).__name__)
                        finally:
                            connection.execute(text('SELECT pg_advisory_unlock(hashtextextended(:id, 0))'), {'id': str(job_id)})
                            connection.commit()
        except Exception as exc:
            logger.warning('download_queue_unavailable', error_type=type(exc).__name__)
        await asyncio.sleep(2)
