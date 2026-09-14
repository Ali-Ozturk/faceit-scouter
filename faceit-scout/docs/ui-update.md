# Extension and dashboard update

## Update locally

1. From the `faceit-scout` directory, run `docker compose up -d --build web processor`. This rebuilds both services and applies nullable display metadata columns to `demo_download` and the requester nickname to `faceit_analysis`. Keep `PROCESSOR_CONCURRENCY=3` for three simultaneous jobs (a smaller configured value is respected).
2. Build Chrome: `npm --prefix apps/extension run build`.
3. Build Firefox: `npm --prefix apps/extension-firefox run build`.
4. Reload the extension in your browser's extension manager and reload open FACEIT tabs. Load the built `dist` directory (Firefox: `dist/manifest.json`), not the source directory.
5. Open **Settings**, enter your backend URL, import key and FACEIT nickname or player ID, and click **Save connection**. Accept the backend host permission if asked. Draft values are saved as you type, so reopening the popup retains them.
6. Open a FACEIT matchroom. The final map is detected automatically while the popup is open. When multiple veto maps are visible without one identifiable selection, Scout waits. Click **Analyze** once the map appears.
7. The newest three available, unprocessed demos are selected automatically. Adjust the checkboxes or use **Unselect all**. **Import selected** remains visible at the bottom; only the history list scrolls.

## Behavior

- The popup is 460 × 590 pixels, with compact settings behind a button. All downloads go to the chosen local or remote backend. There are no browser-download or subdirectory settings.
- Analyze is disabled while running and for six seconds afterwards. Four-player analysis and three-player fallback have separate cooldowns, so the first fallback is available immediately after an empty four-player result. Identical in-flight requests share one result; successful identical requests reuse a 60-second cache. These are extension protections, not a server-wide rate limit.
- Results, selections, messages and cooldowns are retained per match and backend/player connection. Moving to another browser tab does not clear the last match. Returning to another FACEIT match restores its stored state. An analysis finishing after the popup closes is saved by the background worker.
- Each submission still contains at most three demos, but the backend accepts nine outstanding demos in total (queued plus downloading/processing). A single production processor runs at most three jobs at once. Benchmark mode retains its configurable concurrency.
- Map detection inspects the visible FACEIT page every two seconds while the popup is open. It makes no recurring API calls and never automatically analyzes when voting ends. FACEIT can change its page structure; a map that cannot be identified safely remains in the waiting state.
- The three-player fallback is shown only for an analyzed match with no four-player results. Processed and active imports cannot be selected again.
- Extension import cards show the latest six requests, their processing stages, request time, match time, map and requester. Dates use the viewer's local time. Nicknames are saved with the original FACEIT analysis; submissions include the analysis reference plus display metadata, so the server can recover missing extension fields.
- Existing match dates and map names are recovered from parsed matches or stored candidates where possible. A requester never recorded cannot be reliably reconstructed and remains “Player not recorded.” Rebuild the backend and reload the newly built extension before testing new imports; an older deployed API can silently discard new metadata fields.
- Status badges sit beside the map/player text. Vertically centered dots use blue for queued jobs, orange for active work, green for completed jobs and red for failures.
- Team maps are illustrated cards with scene images, map logos and a “View analysis” action. The individual-match Open links are removed, and the table is titled “Matches analyzed.” Images are served locally and resized by Next.js image optimization.
- Team map links show a dimmed page and an animated top bar during navigation. The indicator is indeterminate, not a made-up completion percentage; reduced-motion preferences are respected.

## Release pipeline

Every main-branch push builds both extensions and publishes a new numeric patch tag and release after tests pass. Builds are queued, not canceled when another push arrives. A rerun of a tagged commit reuses its release. GitHub's concurrency queue supports up to 100 waiting runs. The workflow's `contents: write` permission must be allowed by repository policy. Manual runs continue to accept an existing tag.

The workflow uses Node 22 and pinned `web-ext@10.5.0`. It publishes a Chrome ZIP, an explicitly unsigned Firefox ZIP, a Mozilla-signed Firefox XPI and checksums. Configure `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` in repository secrets. The Firefox source manifest ID is retained; the current ID is `faceit-scout-firefox@alihan`.

Signing uses Mozilla's **unlisted** channel and includes buildable TypeScript source for review. Unlisted means absent from AMO search; it does not make GitHub assets private. The XPI and update feed must be anonymously downloadable for Firefox updates to work.

Reruns reuse a signed XPI already present on the release. Signed files are also retained as workflow artifacts if later publishing fails. If signing succeeded but no release asset was published, recover that XPI from the workflow artifact before rerunning the same version: Mozilla may reject signing an already-used version. Update-feed publication retries ordinary main-branch races and refuses to replace a newer feed with an older version.

**Pending approval:** the current Firefox manifest declares `data_collection_permissions.required: ["none"]`. This does not describe the existing import-key, match-detail and demo-URL transfers to the user-configured backend. Automatic approval review blocked replacing it with accurate required data categories; that declaration remains unchanged pending the user's approval. No signing or release publishing was performed during this task.

## Quick acceptance check

1. Enter connection details, trigger the permission prompt, close/reopen the popup and confirm the entered URL/key/nickname remain.
2. In a voting matchroom, confirm no arbitrary map is chosen. After voting, confirm a map appears and one Analyze click starts the search.
3. Repeated Analyze clicks must not start parallel requests. Close/reopen while analyzing and confirm the background guard still applies.
   After an empty four-player result, the first **Try 3 players** click should work immediately. Subsequent requests of the same kind have a six-second cooldown.
4. With results, confirm no “No 4-player history” banner is visible. With genuinely empty results, confirm the three-player option appears.
5. Scroll through history and confirm the footer stays in place. Confirm processed demos are disabled and selecting a fourth demo shows a visible explanation.
6. Submit demos, then open Imports. Confirm request/match dates, nickname and live processing stages appear. Older jobs may have missing metadata.
   Three groups of three can be outstanding; a tenth distinct demo must be rejected until a slot finishes. Switching away and returning must retain the extension's results and success message.
7. Click a map on a team page. On a slower navigation, the top bar and dark overlay should appear immediately and disappear on completion. Ctrl/Cmd-click should still open another tab normally.

The popup can be visually checked with fixture data, but the real Chrome/Firefox permission dialog and a live FACEIT voting transition require a browser session with the extension loaded.
