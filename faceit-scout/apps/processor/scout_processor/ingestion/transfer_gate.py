"""Separate upload and processing phases across all batches and processor instances."""
import asyncio
from contextlib import asynccontextmanager

from sqlalchemy import text

# Must match the web upload route. Session lock spans commits and the entire parse.
LOCK = "hashtextextended('scout-transfer-processing', 0)"


@asynccontextmanager
async def processing_phase(factory):
    engine = factory.kw['bind']
    while True:
        with engine.connect() as connection:
            locked = connection.execute(text(f'SELECT pg_try_advisory_lock({LOCK})')).scalar()
            connection.commit()
            if locked:
                try:
                    pending = connection.execute(text(
                        "SELECT EXISTS (SELECT 1 FROM demo_download "
                        "WHERE status IN ('AWAITING_UPLOAD', 'UPLOADING'))"
                    )).scalar()
                    connection.commit()
                    if not pending:
                        yield
                        return
                finally:
                    # Never put a connection with an owned session lock back in the pool.
                    try:
                        connection.execute(text(f'SELECT pg_advisory_unlock({LOCK})'))
                        connection.commit()
                    except BaseException:
                        connection.invalidate()
                        raise
        # Release the connection and lock while waiting for uploads, including paused ones.
        await asyncio.sleep(2)
