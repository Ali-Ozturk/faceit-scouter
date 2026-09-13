"""Read-only export, executed in the processor image after ingestion stops."""
import json
import os
import psycopg
from psycopg import sql
from psycopg.rows import dict_row

with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    imports = conn.execute("SELECT * FROM imported_demo ORDER BY file_name").fetchall()
    stages = conn.execute("SELECT * FROM import_stage_log ORDER BY created_at").fetchall()
    tables = conn.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'").fetchall()
    counts = {}
    for row in tables:
        name = row["tablename"]
        counts[name] = conn.execute(sql.SQL("SELECT count(*) AS n FROM {}").format(sql.Identifier(name))).fetchone()["n"]
    size = conn.execute("SELECT pg_database_size(current_database()) AS bytes").fetchone()["bytes"]
    matches = conn.execute("SELECT id, map_name, duration_seconds FROM cs_match").fetchall()
    print(json.dumps({"imports": imports, "stages": stages, "row_counts": counts,
                      "database_bytes": size, "matches": matches}, default=str))
