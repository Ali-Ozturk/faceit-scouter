# V2: local and remote URL imports

The extension obtains a fresh signed demo URL using your logged-in FACEIT browser session. It sends the URL to Scout, and the processor downloads, decompresses, parses, and persists the demo. FACEIT cookies never go to Scout. You can close the extension after the server accepts the job.

## Run locally (PowerShell, from the faceit-scout directory)

1. Start Docker Desktop and wait until its Linux engine is running. Check `docker info`.
2. Create the import key, preserving existing settings:

   ```powershell
   node scripts/setup-v2.mjs
   ```

   Open `.env`. Keep your existing `FACEIT_API_TOKEN` for match discovery. Copy the generated `SCOUT_IMPORT_KEY` for step 5. This is a Scout access key, not your FACEIT token or cookie. Normal imports default to `KEEP_COMPLETED_DEMOS=false`.

3. Build and start the services:

   ```powershell
   docker compose up -d --build
   docker compose logs --tail 40 web processor
   ```

   The web container applies the `demo_download` table and its display metadata columns automatically. Existing parsed match results remain in PostgreSQL. Successful retained demo files in the configured completed folder are also deleted by the retention sweep. Source copies outside Scout's managed directories are unaffected. If you want to retain originals for debugging, set `KEEP_COMPLETED_DEMOS=true` before starting.

4. Build the extension:

   ```powershell
   npm --prefix apps/extension ci
   npm --prefix apps/extension run build
   ```

   In Chrome/Edge's extensions page, enable Developer mode and load unpacked `apps/extension/dist`, or reload the existing extension. Reload your FACEIT tabs too. Firefox users run the equivalent commands under `apps/extension-firefox`, then load `dist/manifest.json` through `about:debugging` → This Firefox → Load Temporary Add-on.

5. In the extension open **Settings** and set:
   - **Backend URL:** `http://localhost:3101` (or your configured web port).
   - **Import access key:** the `SCOUT_IMPORT_KEY` value from `.env`.
   - Your FACEIT player ID or nickname.

   Click **Save connection** and allow access to your backend. Entered details survive a popup closing during the permission prompt. All extension imports now go to the backend; there is no download destination, subdirectory, or symlink to configure.

6. Open a FACEIT match while logged in, wait for the selected map to appear, then click **Analyze**. The newest three unprocessed demos are selected automatically; adjust the checkboxes if needed and click the always-visible **Import selected** button. Open `http://localhost:3101/imports` to watch live progress: QUEUED → DOWNLOADING → PROCESSING → COMPLETED (or FAILED with a reason). The extension also refreshes server states periodically.

7. Open the parsed match in Scout. Successful compressed and decompressed files are removed; database results and import timings remain. A failed parse keeps its original under `data/failed` for investigation. Download failures remove partial files. Failed jobs release their slot; retrying from the extension obtains a fresh URL.

## Limits and storage

- Nine outstanding URL imports **across the entire backend**, including queued, downloading, and parsing jobs. Each submission contains at most three demos; at most three run simultaneously in one production processor. There are no per-user accounts yet. Duplicate submissions for an active match reuse its job. The server enforces admission inside a database transaction, so simultaneous submissions cannot exceed nine outstanding jobs.
- `PROCESSOR_CONCURRENCY` controls active work separately; the default remains three locally. Two is the sensible starting value for the tested VPS. Legacy manually placed files share worker capacity but are not counted in the URL admission limit.
- Download and processing paths share a Docker named volume (`downloads_data`); decompression uses `decompressed_data`. Windows host copies are avoided for the new download-to-processing handoff.
- Downloads are capped at 2 GB, decompressed files at 4 GiB, with a 600-second download deadline and 20-second socket timeout. Only HTTP 200 is accepted; redirects are rejected.
- Successful cleanup runs immediately and retries every minute. Set `KEEP_COMPLETED_DEMOS=true` to retain successful originals; `KEEP_DECOMPRESSED_DEMOS` is the separate native processor setting for scratch files. The benchmark explicitly retains its staged copies to preserve its verification contract, and never modifies the input demo directory.
- Queued jobs survive restarts. Interrupted downloads start again from the beginning; expired URLs fail with instructions to resubmit. Interrupted parses reuse downloaded sources. Signed URLs are cleared from current job rows after download or failure (database backups/WAL can retain historical values).

## Switching to a remote backend later

Use the same extension and select your HTTPS server origin instead of localhost, plus that server's import key. Click Save connection to grant access to that specific host. The optional HTTPS permission in the manifest makes arbitrary server addresses possible; the browser asks you to approve the chosen address. FACEIT login stays in the user's browser.

Firefox uses `optional_permissions` for compatibility with Firefox 121+; Mozilla still supports that declaration for optional hosts. Its permission applies to the chosen hostname across ports because Firefox does not support ports in permission match patterns; actual API requests still use your configured port. See [Mozilla's optional-permission documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_permissions) and [match-pattern documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Match_patterns).

This change prepares the import flow; it does not deploy a public site. Docker ports bind to loopback by default. When deploying, put the application behind HTTPS and access control for the whole dashboard/API; the import key protects the new URL-import endpoints, while the existing dashboard and analysis endpoints still use the app's existing access model. Set the same strong import key for web and the extension. Do not publish PostgreSQL.

`DEMO_DOWNLOAD_HOSTS` is a comma-separated list of exact trusted CDN hostnames used by both web and processor. Defaults cover the observed European and US FACEIT Backblaze hosts. If FACEIT uses another host, verify it before adding it and recreate both containers. Wildcards, arbitrary URL proxying, private-network DNS results, and redirects are not supported. A signed URL that is tied to the browser's IP would still fail remotely; cross-IP acceptance must be checked on the VPS during deployment.

## Troubleshooting

- **401 / invalid key:** run setup-v2, recreate web with `docker compose up -d`, and save the exact `.env` key in the extension.
- **Host permission/network failure:** save the connection again, check the server address, and make sure Docker is running. Remote origins require HTTPS. Keys are not forwarded across redirects.
- **409 / three slots occupied:** wait for a current job to finish; repeated clicks will not create extra worker capacity.
- **Unsupported URL:** check the actual FACEIT CDN hostname against `DEMO_DOWNLOAD_HOSTS`; do not add arbitrary hosts.
- **403 from CDN:** retry from the extension to obtain a fresh signed URL. Never paste your FACEIT cookies into Scout.
- **Parsing failure:** read the import stage/error on Imports or `docker compose logs --tail 100 processor`.
- **No progress:** ensure web completed its schema update and processor is running. `docker compose restart processor` safely retries unfinished URL jobs.

## Checks for developers

```powershell
npm --prefix apps/extension test
npm --prefix apps/extension run build
npm --prefix apps/extension-firefox test
npm --prefix apps/extension-firefox run build
npm --prefix apps/web test
npm --prefix apps/web run build
python -m pytest apps/processor/tests/unit -q
```

Run processor tests from `apps/processor` if Python cannot resolve the package. Integration checks should use a disposable PostgreSQL database and managed test files, never the user's benchmark originals or production results.

The opt-in test `apps/processor/tests/integration/test_url_imports.py` uses `SCOUT_TEST_DATABASE_URL` (database name must be `scout_test`), `SCOUT_TEST_WEB_URL`, and `SCOUT_TEST_DEMO`. Start a web instance against that disposable database with `SCOUT_IMPORT_KEY=integration-test-only-key-20260913` and apply its schema first. The test resets that database's import/match tables. It verifies concurrent admission, duplicate submission, real demo parsing/persistence/cleanup, interrupted download/parse recovery, and competing workers handling an expired URL. It substitutes the CDN response with the supplied demo bytes; it does not validate a live FACEIT signed URL or cross-IP CDN behavior.
