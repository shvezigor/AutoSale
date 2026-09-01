# Task 6 report — Google Sheets catalogue sources and safe synchronization

## Outcome

Implemented owner-managed Google Sheets catalogue sources, privacy-safe manager health visibility, bounded Google table reads, manual and scheduled synchronization, mapping/fingerprint safety gates, and catalogue settings UI. Existing order-export `GoogleSheetsDestination`, Instagram processing, order export processing, catalogue mapping work, and reconciliation registrations remain independent and registered.

## Delivered

- Added `GoogleSheetsAdapter.readTable({ spreadsheetId, sheetName, maxRows })` using evaluated row values, a detection row beyond the configured bound, deterministic row revision hashes, quoted tab handling, and safe `AUTHORIZATION`, `NOT_FOUND`, `RATE_LIMIT`, and `RETRYABLE` failures.
- Added a deterministic normalized-header structure fingerprint shared by API connectivity checks and the worker.
- Added strict catalogue-source contracts and owner CRUD/configuration/check/sync endpoints. Full Google URLs and spreadsheet IDs are accepted; spreadsheet ID, tab, and `MANUAL`/`HOURLY`/`DAILY` schedule are persisted separately.
- Managers receive only source health, safe failure category, and last-sync/update times. Spreadsheet IDs, tabs, schedules, service-account details, mappings, and source rows remain owner-only.
- Service-account identity is read server-side only to show the safe sharing action. Uploaded credential JSON is rejected by strict request validation; no credentials are persisted or returned.
- Added manual BullMQ synchronization and bounded hourly/daily polling. Jobs contain only tenant/source IDs and use deterministic queue/revision idempotency boundaries with retry backoff.
- Added synchronization safety gates for confirmed mapping reuse, changed structure, missing required columns, repeated revisions, retryable Google failures, duplicate/cross-source SKU collisions, and safe run/source status updates.
- Moved Task 4 product upsert batching into a shared database helper and made both Task 4 confirmation and Google synchronization use it.
- Added owner settings UI for source/tab/schedule, access testing, run-now, and removal. Managers see health and last-sync only. Order-export settings remain a separate component and API model.

## TDD evidence

Red/green slices were run at the public adapter, service/controller, worker processor, and React component seams. Initial red failures included missing `readTable`, missing classified errors, missing source service/controller modules, missing synchronization processor, and missing settings component. Each slice was implemented and rerun before moving on.

## Verification

- Required focused suites:
  - `pnpm --filter @autosale/integrations test` — 44 passed.
  - `pnpm --filter @autosale/api test -- src/catalogue-sources` — 209 passed (workspace Vitest configuration runs the API suite).
  - `pnpm --filter @autosale/worker test -- google-catalogue-sync.processor.spec.ts` — 49 passed (worker suite).
  - `pnpm --filter @autosale/web test -- catalogue-source-settings.spec.tsx` — 60 passed (web suite).
- Final full `pnpm test` — PASS: config 10, contracts 18, integrations 44, observability 5, web 60, API 209, worker 49; database has no test files and passed with `--passWithNoTests`.
- Final full `pnpm typecheck` — PASS for all eight tested workspace projects.
- `git diff --check` — PASS (only Windows LF/CRLF advisory warnings).

## Privacy and isolation review

- Every database query/mutation in the source API and processor includes the server-owned `tenantId`; job payloads contain internal IDs only.
- No credentials, access tokens, raw rows, storage/object keys, Google response bodies, spreadsheet IDs, or tab names are logged.
- Persisted/reportable failures are bounded categories, never upstream response text.
- `GoogleSheetsDestination` is neither read nor mutated by catalogue-source service logic; the existing order-export processor remains independent.

## Remaining concern

- The first synchronization of a source without a confirmed mapping, and any later changed structure, intentionally pauses in `MAPPING_REVIEW` without product mutation. Completing that review continues to depend on the existing owner mapping workflow; this task does not auto-guess or auto-confirm a replacement mapping.
