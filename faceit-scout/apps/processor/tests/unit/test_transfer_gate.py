import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scout_processor.ingestion.transfer_gate import processing_phase


def factory_for(values):
    connection = MagicMock()
    connection.execute.side_effect = [SimpleNamespace(scalar=lambda value=value: value) for value in values]
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value = connection
    return SimpleNamespace(kw={'bind': engine}), connection


@pytest.mark.asyncio
async def test_waits_for_all_pending_uploads_and_releases_between_checks(monkeypatch):
    # Busy upload lock, then a paused upload, then all uploads received.
    factory, connection = factory_for([False, True, True, True, True, False, True])
    sleeps = []
    async def sleep(delay):
        sleeps.append(delay)
    monkeypatch.setattr('scout_processor.ingestion.transfer_gate.asyncio.sleep', sleep)
    async with processing_phase(factory):
        assert len(sleeps) == 2
        queries = [str(call.args[0]) for call in connection.execute.call_args_list]
        assert "'AWAITING_UPLOAD', 'UPLOADING'" in queries[-1]
        assert sum('pg_advisory_unlock' in query for query in queries) == 1
    assert 'pg_advisory_unlock' in str(connection.execute.call_args.args[0])


@pytest.mark.asyncio
async def test_releases_processing_lock_on_cancellation():
    factory, connection = factory_for([True, False, True])
    with pytest.raises(asyncio.CancelledError):
        async with processing_phase(factory):
            raise asyncio.CancelledError()
    assert 'pg_advisory_unlock' in str(connection.execute.call_args.args[0])
