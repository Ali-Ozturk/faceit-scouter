# Manual demo imports (Chrome and Firefox)

This is the interim workflow until approved FACEIT Downloads API access is available. It replaces the old cookie/session-based URL import flow; it is not a claim of complete terms compliance.

## User workflow

1. Configure the extension with the Scout backend URL, FACEIT nickname and import access key.
2. Open the current matchroom and click **Analyze**. The backend reads the map from the documented Data API. Choose a map in the dropdown to override it or if the API has no final map.
3. Select up to three historical matches and click **Open matches**. The extension opens those matchrooms and a Scout Imports tab. It reserves an upload for each selected match.
4. Click FACEIT's own **Watch Demo** button in each matchroom. Scout does not click it, read page content, intercept downloads, or obtain signed demo URLs.
5. On Scout's Imports page, enter the same **import access key** and click **Load pending matches**. Select or drag the downloaded `.dem`, `.dem.zst` or `.dem.gz` files directly from Downloads. No local script or file move is necessary.
6. Check the match assignment for each file. Filenames containing a selected FACEIT match ID are matched automatically; renamed files require an explicit selection. Files are never assigned by selection order.
7. Click **Upload / resume**. Up to three files transfer one at a time, each with its own progress and resumable chunks, limiting memory and disk contention on a small VPS. Keep this tab open while transferring. A failed file does not stop the other uploads. **Pause uploads** lets each active chunk finish before pausing unfinished files. Completed files stay staged until every reservation created with them has finished or been cancelled, then the batch enters processing together.

After a successful connection, the key is saved in this browser's local storage for this Scout site. Later visits restore it and load pending matches automatically. **Forget saved key** removes it from this browser; rejected saved keys are cleared when the server returns 401. If browser storage is unavailable, entering the key still works for the current visit. The key is sent in Authorization headers, never query strings. This is a shared import key, not per-user authentication: everyone holding it can view, upload to, or cancel pending import reservations. Keep the dashboard behind the existing HTTPS/access-control layer.

## Transfer and processing

- All upload operations (list, create, resume, append, cancel) reject missing, incorrect or short configured keys. The backend must configure `SCOUT_IMPORT_KEY` with at least 24 characters.
- Uploads use 4 MiB chunks with a 2,000,000,000-byte maximum per file. File signatures must match their declared demo format. Archives are expanded only by the processor, with the existing 4 GiB decompression limit.
- Partial bytes stay in staging and never enter the worker queue. Interrupted transfers resume at the server's offset when the same file is selected again. A bounded fingerprint sample, size and original filename guard against accidentally mixing files; the processor calculates the full SHA-256 for duplicate detection.
- Closing or pausing a transfer preserves the partial upload. Pending uploads reserve queue slots until completed or cancelled; use **Pending matches** to cancel unused reservations and delete their staged bytes.
- Nine outstanding reservations/uploads/processing jobs are admitted across the backend, under a PostgreSQL advisory lock. Reopening an active match reuses its job. Worker concurrency remains configurable and capped at three for the durable queue.
- Completed files are atomically renamed before queue admission. Files reserved together wait for every upload in that batch to finish or be cancelled, preventing parsing from starving active transfers. Resume recovers a crash between the rename and database commit. Workers recover interrupted processing using the existing import record.
- Filenames with a conflicting match ID are rejected; the processor also rejects a known map mismatch or a checksum already associated with another match. A renamed demo does not necessarily contain a reliable FACEIT ID: the user must verify its assignment.
- Successful source/scratch cleanup and parsed-result persistence continue as before. Failed parser inputs remain in the failed directory for investigation.

## Deploy/update

From the project directory:

```sh
docker compose up -d --build
npm --prefix apps/extension ci
npm --prefix apps/extension run build
npm --prefix apps/extension-firefox ci
npm --prefix apps/extension-firefox run build
```

Update **both** backend services and both extensions. The web startup migration adds the nullable upload batch column; existing parsed results are retained. Reload the extensions and existing FACEIT tabs to unload any old content scripts.

The web and processor services share the existing `downloads_data` volume at `/data/runtime`. The web's `DEMO_UPLOAD_DIRECTORY` is `/data/runtime/temporary/url-imports`, matching the processor's `TEMPORARY_DIRECTORY` plus `/url-imports`. For a native setup, explicitly point both to the same absolute directory. The legacy `URL_IMPORTS_ENABLED=true` setting still enables the durable file-import worker; it no longer permits URL downloads.

Allow at least 4 MiB request bodies through the VPS reverse proxy (for nginx, `client_max_body_size 5m;`). Each chunk has a two-minute client timeout. The Node route buffers at most one 4 MiB chunk per request, not the entire demo. No FACEIT credentials are needed for uploads or demo parsing; Data API discovery still needs the server-side API token.

Docker Compose defaults to one processor worker. On a small VPS, also set `PROCESSOR_CONCURRENCY=1` in `.env` if it currently overrides the default. Batch admission keeps CPU- and memory-intensive parsing from starting while sibling files are still uploading, and single-worker processing limits the peak load after transfer. The browser automatically retries transient upload failures for as long as the page remains open, with delays capped at 30 seconds, and reconciles the saved server offset, so an interrupted chunk resumes without a page refresh.

`POST /api/demo-downloads` returns **410** to authenticated older extensions. The worker also rejects old queued jobs containing signed URLs and clears their URLs through its failure path. Completed historical job records remain intact. Automated FACEIT acquisition cannot be re-enabled with an environment flag; a future approved Downloads API integration requires an explicit implementation.

## Retention review still outstanding

This release removes internal FACEIT endpoint calls and DOM extraction. It does not introduce an arbitrary API-data TTL or delete existing results while the developer terms are unresolved.

The retention audit found API-sourced values in `faceit_analysis`, `faceit_analysis_opponent`, `faceit_analysis_candidate`, extension popup storage, and job metadata (`demo_download.map_name`/`match_played_at`). The processor may also enrich `cs_match.played_at` through `faceit_metadata.py`; logs, summary dates, and database backups can retain copies. Demo event tables primarily contain parsed file data. Retention must be specified by field/source and confirmed against the applicable developer agreement, not assumed from a table name. Hosted analysis, team sharing and commercial use also require their own terms assessment.

## Verification

```sh
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix apps/extension test
npm --prefix apps/extension run build
npm --prefix apps/extension-firefox test
npm --prefix apps/extension-firefox run build
python -m pytest apps/processor/tests/unit -q
```

The opt-in `apps/processor/tests/integration/test_manual_uploads.py` uses a **fresh, isolated `scout_test` database** and a web server configured with `SCOUT_IMPORT_KEY=integration-test-only-key-20260916`. Set `SCOUT_TEST_DATABASE_URL`, `SCOUT_TEST_WEB_URL`, `SCOUT_TEST_DEMO` and `SCOUT_TEST_UPLOAD_ROOT`; configure the web upload directory as `<root>/temporary/url-imports`. Apply the schema to that database first. The test checks real HTTP auth, concurrent admission, cancellation, chunk resume, the real parser, PostgreSQL persistence and cleanup without contacting FACEIT. It never modifies the supplied source demo.

### Transfer reliability and throughput

Upload status and batch locks fail promptly when busy instead of holding a web database connection behind processing. Lost chunk responses are reconciled against bytes already saved before resending. Temporary HTTP/network failures retry automatically; invalid files and authentication errors still stop with an actionable message. Pause takes effect after the current request/recovery or backoff finishes. The browser must remain open and the VPS must eventually recover; no client can guarantee completion through permanent disk exhaustion or a stopped server.

Upload the original `.dem.zst` or `.dem.gz` downloaded from FACEIT to avoid transferring the larger decompressed `.dem`. Downloads happen in the user's browser; server URL acquisition is disabled. The 4 MiB chunk limit and durable disk sync remain unchanged. Serial uploads reduce contention but can reduce throughput on a powerful server or high-latency link; benchmark on the actual VPS before increasing concurrency or chunk sizes. Existing batches can still be processing while another batch uploads, so keeping the processor at one worker matters. These changes do not claim a measured speedup.
