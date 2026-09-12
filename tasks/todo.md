# Instagram Order Capture MVP — Task Checklist

## Task 1: Verify Meta and Google access prerequisites

**Description:** Prove access to a test Instagram Professional account, required Meta permissions/webhooks, and a staging Google OAuth/Picker application before implementation depends on them.

**Acceptance criteria:**
- [ ] Meta webhook verification and one real message event are demonstrated.
- [x] A tenant owner can authorize Google and grant access only to a selected private test spreadsheet through Picker.
- [ ] Required approvals, credentials, and unresolved vendor gates are documented.

**Verification:**
- [ ] Save sanitized request/response evidence without tokens or personal data.
- [ ] Review the access checklist with the system owner.

**Dependencies:** None

**Files likely touched:**
- `docs/integrations/meta-access.md`
- `docs/integrations/google-sheets-access.md`

**Estimated scope:** Small

## Task 2: Scaffold and run the portable container stack

**Description:** Establish the pnpm monorepo and Docker Compose services for web, API, worker, PostgreSQL, Redis, MinIO, and Caddy.

**Acceptance criteria:**
- [ ] One documented command starts the complete local stack.
- [ ] Services use named volumes and internal networking.
- [ ] Production images run as non-root users with pinned runtime versions.

**Verification:**
- [ ] Tests pass: `pnpm test`
- [ ] Build succeeds: `docker compose build`
- [ ] Manual check: `docker compose up` reaches healthy web and API endpoints.

**Dependencies:** Task 1

**Files likely touched:**
- `pnpm-workspace.yaml`
- `compose.yaml`
- `apps/api/`
- `apps/worker/`
- `apps/web/`

**Estimated scope:** Medium

## Task 3: Add configuration, health checks, and secret validation

**Description:** Define typed environment configuration and readiness checks without embedding credentials in code or images.

**Acceptance criteria:**
- [ ] Startup fails clearly when a required variable is missing or malformed.
- [ ] Liveness and readiness reflect PostgreSQL, Redis, and object-storage dependencies.
- [ ] A redacted `.env.example` documents every setting.

**Verification:**
- [ ] Tests pass: `pnpm --filter api test config health`
- [ ] Manual check: missing secrets fail startup without printing secret values.

**Dependencies:** Task 2

**Files likely touched:**
- `packages/config/`
- `apps/api/src/health/`
- `apps/worker/src/health/`
- `.env.example`

**Estimated scope:** Medium

## Checkpoint: Foundation

- [ ] Clean checkout builds and all containers become healthy.
- [ ] Meta and Google access probes passed.
- [ ] Human review completed before domain implementation.

## Task 4: Persist and deduplicate verified Meta webhook events

**Description:** Receive Meta verification and message callbacks, validate authenticity, store raw event metadata, and enqueue each event exactly once.

**Acceptance criteria:**
- [ ] Invalid signatures are rejected and valid callbacks return promptly.
- [ ] Replaying the same external event does not create another processing job.
- [ ] Raw payload retention excludes access tokens and follows a documented retention policy.

**Verification:**
- [ ] Tests pass: `pnpm --filter api test meta-webhook`
- [ ] Manual check: replay a fixture twice and observe one stored event/job.

**Dependencies:** Task 3

**Files likely touched:**
- `apps/api/src/integrations/meta/`
- `packages/database/prisma/schema.prisma`
- `packages/contracts/src/meta.ts`

**Estimated scope:** Medium

## Task 5: Normalize Instagram conversations, messages, and media

**Description:** Convert Meta payloads into channel-neutral conversation/message records and copy supported media to MinIO in a background job.

**Acceptance criteria:**
- [ ] Text, sender, timestamps, message IDs, and attachments are normalized.
- [ ] Media is checksummed and stored before the source URL expires.
- [ ] Failed media retrieval is visible and retryable without duplicating messages.

**Verification:**
- [ ] Tests pass: `pnpm --filter worker test instagram-normalization`
- [ ] Manual check: a message with a photo appears once in PostgreSQL and MinIO.

**Dependencies:** Task 4

**Files likely touched:**
- `apps/worker/src/jobs/instagram/`
- `packages/database/prisma/schema.prisma`
- `packages/integrations/src/instagram/`

**Estimated scope:** Medium

## Task 6: Display the conversation inbox in the manager UI

**Description:** Deliver the first complete vertical slice by listing captured conversations and showing message history and attachments.

**Acceptance criteria:**
- [ ] Manager can list and open conversations ordered by latest activity.
- [ ] Message direction, timestamp, text, and media are clearly represented.
- [ ] Empty, loading, pagination, and error states are handled accessibly.

**Verification:**
- [ ] Tests pass: `pnpm --filter web test`
- [ ] Build succeeds: `pnpm --filter web build`
- [ ] Playwright: manager opens a fixture conversation and views its image.

**Dependencies:** Task 5

**Files likely touched:**
- `apps/api/src/conversations/`
- `apps/web/app/conversations/`
- `packages/contracts/src/conversations.ts`

**Estimated scope:** Medium

## Checkpoint: Conversation capture

- [ ] A real Instagram text and photo appear exactly once.
- [ ] API, worker, and browser tests pass.
- [ ] Replay and media failure cases are verified.

## Task 7: Import and search the product catalogue

**Description:** Add a canonical product catalogue with SKU, variations, aliases, and optional reference images, initially importable from a controlled CSV or Google Sheet export.

**Acceptance criteria:**
- [ ] Duplicate or missing SKU values are rejected with row-level errors.
- [ ] Exact SKU, alias, normalized text, and variant filters return deterministic candidates.
- [ ] Imports are versioned and auditable.

**Verification:**
- [ ] Tests pass: `pnpm --filter api test catalogue`
- [ ] Manual check: import a fixture catalogue and verify known aliases.

**Dependencies:** Task 3

**Files likely touched:**
- `apps/api/src/catalogue/`
- `packages/database/prisma/schema.prisma`
- `packages/contracts/src/catalogue.ts`

**Estimated scope:** Medium

## Task 8: Detect the confirmed-order trigger

**Description:** Evaluate manager messages and conversation context against configurable confirmation phrases while preventing repeated triggers.

**Acceptance criteria:**
- [ ] Configured phrases are normalized and matched with documented rules.
- [ ] One message can initiate at most one order draft.
- [ ] Trigger decisions retain rule version and evidence.

**Verification:**
- [ ] Tests pass: `pnpm --filter worker test order-trigger`
- [ ] Manual check: positive, negative, edited, and repeated phrase fixtures.

**Dependencies:** Tasks 5 and 7

**Files likely touched:**
- `apps/worker/src/jobs/order-trigger/`
- `packages/contracts/src/orders.ts`
- `packages/database/prisma/schema.prisma`

**Estimated scope:** Medium

## Task 9: Extract a validated order draft with OpenAI

**Description:** Send the bounded conversation context and relevant images to an AI provider and validate its response against a versioned order schema.

**Acceptance criteria:**
- [ ] Output distinguishes extracted values, missing fields, and supporting message IDs.
- [ ] Invalid model output cannot be persisted as a ready order.
- [ ] Model, prompt, schema version, latency, and token usage are recorded without exposing personal data in logs.

**Verification:**
- [ ] Tests pass: `pnpm --filter worker test ai-extraction`
- [ ] Evaluation: run the versioned fixture dataset and publish per-field accuracy.

**Dependencies:** Task 8

**Files likely touched:**
- `packages/ai/src/extraction/`
- `apps/worker/src/jobs/order-extraction/`
- `packages/contracts/src/order-draft.ts`

**Estimated scope:** Medium

## Task 10: Match product candidates and calculate confidence

**Description:** Retrieve catalogue candidates using deterministic rules and optionally rank only those candidates with AI.

**Acceptance criteria:**
- [ ] A result can reference only an existing catalogue SKU.
- [ ] Confidence thresholds produce `READY`, `NEEDS_REVIEW`, or `PRODUCT_NOT_FOUND`.
- [ ] Matching evidence and algorithm version are persisted.

**Verification:**
- [ ] Tests pass: `pnpm --filter worker test product-matching`
- [ ] Evaluation: ambiguous fixture products never auto-select the wrong SKU.

**Dependencies:** Tasks 7 and 9

**Files likely touched:**
- `packages/ai/src/matching/`
- `apps/worker/src/jobs/product-matching/`
- `packages/database/prisma/schema.prisma`

**Estimated scope:** Medium

## Task 11: Configure approval policy and review routed orders

**Description:** Support `ALWAYS`, `NEVER`, and `ON_LOW_CONFIDENCE` per tenant. Let the manager inspect evidence, correct customer/product data, choose a candidate SKU, and approve orders routed to review. Incomplete or invalid AI output must require review regardless of configuration.

**Acceptance criteria:**
- [ ] Missing and low-confidence fields are visibly highlighted.
- [ ] Approval is blocked until required fields and a valid SKU are present.
- [ ] Every correction records actor, previous value, new value, and time.

**Verification:**
- [ ] Tests pass: `pnpm --filter web test`
- [ ] Playwright: review an ambiguous order, correct it, and approve it.

**Dependencies:** Task 10

**Files likely touched:**
- `apps/api/src/orders/`
- `apps/web/app/orders/`
- `packages/contracts/src/orders.ts`

**Estimated scope:** Medium

## Checkpoint: Reviewed order

- [ ] Representative conversations produce valid reviewable drafts.
- [ ] AI cannot persist an invented SKU.
- [ ] Corrections and approvals are auditable.
- [ ] Human review of extraction evaluation completed.

## Task 12: Configure and validate a Google Sheets destination (superseded by Tasks 20–28)

**Description:** The destination validation and export behavior remain required, but customer authentication is replaced by the approved tenant OAuth/Picker flow in Tasks 20–28.

**Acceptance criteria:**
- [ ] Credentials come from the tenant OAuth connection, are encrypted, and are never committed or returned to the browser.
- [ ] Spreadsheet ID, tab, and required headers are validated before activation.
- [ ] Access outside the selected spreadsheet is not required.

**Verification:**
- [ ] Tests pass: `pnpm --filter api test google-sheets-config`
- [ ] Manual check: validate correct, missing-header, wrong-tab, and revoked-access cases.

**Dependencies:** Tasks 1 and 3

**Files likely touched:**
- `apps/api/src/integrations/google-sheets/`
- `packages/integrations/src/google-sheets/`
- `packages/database/prisma/schema.prisma`

**Estimated scope:** Medium

## Task 13: Synchronize approved orders idempotently

**Description:** Export an approved order through the Google Sheets API, updating an existing row by stable `order_id` or appending one when absent.

**Acceptance criteria:**
- [ ] First export creates exactly one mapped row.
- [ ] Later order changes update that row instead of appending another.
- [ ] Retries after ambiguous network failures reconcile before writing again.

**Verification:**
- [ ] Tests pass: `pnpm --filter worker test google-sheets-sync`
- [ ] Integration test: create, update, replay, and timeout scenarios.

**Dependencies:** Tasks 11 and 12

**Files likely touched:**
- `apps/worker/src/jobs/google-sheets-sync/`
- `packages/integrations/src/google-sheets/`
- `packages/database/prisma/schema.prisma`

**Estimated scope:** Medium

## Task 14: Surface synchronization state and allow safe retry

**Description:** Show pending, successful, and failed Google Sheets exports and let a manager retry a recoverable failure.

**Acceptance criteria:**
- [ ] Order detail shows last attempt, result, and a safe error summary.
- [ ] Retry is unavailable for invalid configuration until configuration is fixed.
- [ ] Multiple retry clicks cannot produce duplicate jobs or rows.

**Verification:**
- [ ] Tests pass: `pnpm --filter web test sheets-status`
- [ ] Playwright: recover from a simulated transient failure.

**Dependencies:** Task 13

**Files likely touched:**
- `apps/api/src/exports/`
- `apps/web/app/orders/`
- `packages/contracts/src/exports.ts`

**Estimated scope:** Medium

## Checkpoint: Google Sheets export

- [ ] Approved order is created and updated exactly once in the target sheet.
- [ ] Revoked credentials and quota errors preserve the order and show recovery steps.
- [ ] Retry and reconciliation tests pass.

## Task 15: Add audit, structured logs, metrics, and error reporting

**Description:** Make webhook, job, AI, manager, and Sheets operations traceable by correlation and order IDs without leaking secrets.

**Acceptance criteria:**
- [ ] A request can be traced from Meta event to Google export.
- [ ] Secrets and configured personal-data fields are redacted from logs.
- [ ] Queue backlog, failures, API health, and export failures are observable.

**Verification:**
- [ ] Tests pass: `pnpm test observability`
- [ ] Manual check: force a failed export and trace it end to end.

**Dependencies:** Task 14

**Files likely touched:**
- `packages/observability/`
- `apps/api/src/main.ts`
- `apps/worker/src/main.ts`

**Estimated scope:** Medium

## Task 16: Add backup, restore, migration, and deployment procedures

**Description:** Document and automate safe deployment and recovery of PostgreSQL, MinIO data, configuration, and application versions on a generic Linux Docker host.

**Acceptance criteria:**
- [ ] Versioned migrations run before application rollout and failure stops deployment.
- [ ] Backup covers PostgreSQL and object storage with a documented retention policy.
- [ ] Restore onto a clean second host is documented and tested.

**Verification:**
- [ ] Build succeeds: `docker compose build`
- [ ] Manual check: restore a backup on a clean host and open an existing conversation/order.

**Dependencies:** Tasks 2, 3, and 15

**Files likely touched:**
- `infra/compose/`
- `infra/scripts/`
- `docs/operations/deployment.md`
- `docs/operations/backup-restore.md`

**Estimated scope:** Medium

## Task 17: Run end-to-end acceptance and failure testing

**Description:** Verify the complete Instagram-to-Google-Sheets journey and critical recovery cases against the Definition of Done.

**Acceptance criteria:**
- [ ] Real test text/photo flows from Instagram to one approved Sheets row.
- [ ] Duplicate webhook, worker restart, AI failure, and Google outage recover safely.
- [ ] The owner signs off on field mapping and manager workflow.

**Verification:**
- [ ] Tests pass: `pnpm test && pnpm test:e2e`
- [ ] Build succeeds: `docker compose build`
- [ ] Manual acceptance checklist is signed off.

**Dependencies:** Tasks 15 and 16

**Files likely touched:**
- `tests/e2e/`
- `tests/fixtures/`
- `docs/acceptance/mvp-checklist.md`

**Estimated scope:** Medium

## Checkpoint: MVP complete

- [ ] All automated tests and production builds pass.
- [ ] Clean-host restore test passes.
- [ ] Secrets scan is clean.
- [ ] Client accepts the end-to-end workflow.

## Task 18: Send manual Instagram replies from the AutoSale inbox

**Status:** Implemented and automated verification complete; real Meta acceptance remains.

**Description:** Let an authenticated manager reply to an Instagram conversation from AutoSale through the official Instagram Send API. Persist the outbound message idempotently and reconcile it with Meta's echo webhook.

**Design:** `docs/superpowers/specs/2026-09-07-instagram-manual-replies-design.md`

**Plan:** `docs/superpowers/plans/2026-09-07-instagram-manual-replies.md`

**Acceptance criteria:**
- [x] The conversation page has an accessible message composer with pending, sent, and failed states.
- [x] The API sends text replies only for an active tenant-bound Instagram connection and never exposes the access token.
- [x] Meta echo webhooks reconcile with the locally initiated reply without creating duplicate messages.
- [x] Provider limits and expired/revoked credentials produce actionable errors and safe retry behavior.
- [x] A configured manager confirmation phrase sent from AutoSale can trigger the existing AI order-recognition flow exactly once.

**Verification:**
- [x] Unit and integration tests cover authorization, Send API errors, idempotency, and echo reconciliation.
- [ ] Browser test sends a reply from AutoSale and observes it once in both Instagram and the AutoSale conversation.
- [ ] End-to-end test confirms that a manager reply containing a trigger phrase starts AI order recognition.

**Dependencies:** Tasks 5, 6, 8, 9, and an active Meta Instagram OAuth connection.

**Files likely touched:**
- `packages/integrations/src/meta-instagram.ts`
- `apps/api/src/conversations/`
- `apps/web/app/conversations/[id]/`
- `apps/worker/src/instagram/`
- `packages/database/prisma/schema.prisma`

**Estimated scope:** Medium

## Task 19: Enrich Instagram conversations with customer profile details

**Description:** Resolve the Instagram customer's permitted profile fields through the official Meta API and display their username/name and avatar in the AutoSale inbox instead of the generic “Клієнт Instagram” label. Keep customer-sent message attachments in the existing media-copy pipeline.

**Acceptance criteria:**
- [ ] A new Instagram conversation schedules idempotent profile enrichment for its participant ID.
- [ ] AutoSale stores only profile fields permitted and returned by Meta, including username/display name and profile-picture URL when available.
- [ ] Profile pictures are copied or refreshed safely so expired remote URLs do not break the inbox.
- [ ] Conversation list and detail views show the customer avatar and best available name.
- [ ] Missing, private, revoked, rate-limited, or unavailable profile fields fall back to “Клієнт Instagram” without blocking message ingestion.
- [ ] Profile refreshes do not overwrite newer data or mix customers or tenants.

**Verification:**
- [ ] Unit and integration tests cover complete, partial, unavailable, expired-image, and rate-limited profile responses.
- [ ] Browser test verifies the avatar/name display and the generic fallback.
- [ ] End-to-end test receives a real message and verifies that the correct sender profile is attached to the conversation without exposing access tokens.

**Dependencies:** Tasks 5, 6, and an active Meta Instagram OAuth connection with the required profile access.

**Files likely touched:**
- `packages/integrations/src/meta-instagram.ts`
- `packages/database/prisma/schema.prisma`
- `apps/worker/src/instagram/`
- `apps/api/src/conversations/`
- `apps/web/src/components/`

**Estimated scope:** Medium

## Google Sheets OAuth — Current First Priority

The approved design is in `docs/superpowers/specs/2026-09-02-google-sheets-oauth-connection-design.md`. Exact TDD steps and commits are in `docs/superpowers/plans/2026-09-02-google-sheets-oauth-connection.md`.

## Task 20: Configure Google Cloud and the OAuth deployment contract

**Description:** Create the AutoSale Google OAuth/Picker configuration boundary and document the development, staging, and production Google Cloud setup.

**Acceptance criteria:**
- [x] Sheets, Drive, and Picker APIs, OAuth client, production origin, callback, branding, and least-privilege scope are documented.
- [x] Partial or unsafe environment configuration fails startup without exposing secrets.
- [ ] Picker API key is restricted to the production origin and Picker API.

**Verification:** Config tests, typecheck, Compose configuration validation, and manual Google Console checklist.

**Dependencies:** Approved Google OAuth design. **Estimated scope:** Medium

## Task 21: Persist tenant Google connections and OAuth attempts

**Description:** Add tenant-bound encrypted credential state and single-use authorization attempts.

**Acceptance criteria:**
- [x] Refresh tokens are encrypted and never returned or logged.
- [x] State is expiring, single-use, and bound to tenant, owner, and safe return path.
- [x] Database constraints prevent cross-tenant or duplicate active connections.

**Verification:** PostgreSQL migration tests, replay/expiry tests, Prisma validation, and API typecheck.

**Dependencies:** Task 20. **Estimated scope:** Medium

## Task 22: Implement OAuth connect, callback, reconnect, and summary

**Description:** Let an owner authorize AutoSale with Google and safely persist/refresh the tenant grant.

**Acceptance criteria:**
- [x] Only owners can initiate or replace a connection.
- [x] Callback validates state, identity, scopes, subject, and refresh-token lifecycle.
- [x] Safe API responses expose status and owner-visible email but no credential material.

**Verification:** Unit/controller tests for success, cancellation, replay, mismatch, missing token, and reconnect.

**Dependencies:** Task 21. **Estimated scope:** Medium

## Task 23: Disconnect Google and clean credentials durably

**Description:** Stop new Google work immediately, revoke the grant where possible, and remove only the matching credential generation.

**Acceptance criteria:**
- [x] Disconnect pauses dependent catalogue sources and destinations without deleting internal data.
- [x] Failed revocation is retryable and cannot block a later safe reconnect indefinitely.
- [x] A stale cleanup cannot delete a newer credential.

**Verification:** Cleanup/reconciler migration tests and reconnect concurrency tests.

**Dependencies:** Task 22. **Estimated scope:** Medium

## Task 24: Select private spreadsheets with Google Picker

**Description:** Replace raw ID-only onboarding with owner sign-in, Picker selection, server validation, and tab selection.

**Acceptance criteria:**
- [x] Owner selects only Google Sheets files explicitly shared with AutoSale.
- [x] Backend verifies file type/access and lists real tabs before saving.
- [x] Cancellation, inaccessible files, deleted files, and provider errors are actionable.

**Verification:** Component/API tests plus a real private staging spreadsheet.

**Dependencies:** Task 22. **Estimated scope:** Medium

## Task 25: Use tenant OAuth for Google catalogue synchronization

**Description:** Feed tenant access tokens into the existing Google catalogue, AI mapping, and scheduled synchronization pipeline.

**Acceptance criteria:**
- [x] Selected private sheet can create a mapping review and confirmed catalogue import.
- [x] Scheduled/manual sync refreshes tokens without browser presence.
- [x] Revoked access pauses safely and preserves the last valid catalogue.

**Verification:** Catalogue sync, fencing, mapping, scheduler, and tenant-isolation tests.

**Dependencies:** Tasks 23–24. **Estimated scope:** Medium

## Task 26: Use tenant OAuth for Google order export

**Description:** Validate a Picker-selected destination and export approved orders with existing exactly-once semantics.

**Acceptance criteria:**
- [x] First export appends and later changes update by stable `order_id`.
- [x] Repeated clicks, retries, timeouts, and reconnects do not duplicate rows.
- [x] Catalogue and order spreadsheet configuration remain independent.

**Verification:** Settings/worker integration tests and real staging export.

**Dependencies:** Tasks 23–24. **Estimated scope:** Medium

## Task 27: Deliver the Google connection wizard

**Description:** Add the owner experience for connection, file/tab selection, purpose selection, validation, synchronization, reconnect, and disconnect.

**Acceptance criteria:**
- [x] Owner never handles API keys, JSON credentials, or refresh tokens.
- [x] Catalogue and order-export sections show selected file, tab, status, and safe errors.
- [x] Managers and platform administrators retain the approved privacy boundaries.

**Verification:** Role/accessibility component tests and production web build.

**Dependencies:** Tasks 24–26. **Estimated scope:** Medium

## Task 28: Complete Google staging and production readiness

**Description:** Verify the complete private-Sheets workflow, migrate away from production service-account use, and prepare Google verification.

**Acceptance criteria:**
- [x] Real OAuth → Picker → catalogue import → AI mapping → order export flow passes.
- [ ] Revoke, reconnect, disconnect, deleted-tab, quota, and restart recovery cases pass.
- [ ] Production branding, domains, policies, scopes, evidence, and credentials are configured.

**Verification:** Full test/typecheck/E2E/build suite and sanitized acceptance record.

**Dependencies:** Tasks 20–27. **Estimated scope:** Medium

## Checkpoint: Google Sheets OAuth complete

## Google Sign-In — Next Authentication Priority

The approved design is in `docs/superpowers/specs/2026-09-03-google-sign-in-design.md`. The TDD implementation sequence is in `docs/superpowers/plans/2026-09-03-google-sign-in.md`. Google identity authentication remains separate from the existing tenant Google Sheets authorization.

## Task 29: Add the Google identity and sign-in attempt domain model

**Status:** Completed in `1c0b57f`.

**Description:** Persist Google identities and one-time sign-in/onboarding attempts, and allow active Google-only users to exist without a password hash.

**Acceptance criteria:** Google subjects and users are uniquely linked; raw state, grants, codes, and provider tokens are never persisted; existing password accounts remain compatible.

**Verification:** Prisma migration tests, database uniqueness/concurrency tests, and password-login regression tests.

**Dependencies:** Existing self-hosted auth and Google Cloud configuration. **Estimated scope:** Medium

## Task 30: Implement the Google OpenID Connect client and state protection

**Status:** Completed in `bce921d` and `a31f51b`.

**Description:** Add a dedicated identity-only Google client with `openid email profile`, strict ID-token validation, hashed single-use state, safe return paths, and rate limiting.

**Acceptance criteria:** Issuer, audience, expiry, subject, and verified email are validated; replay, cancellation, malformed claims, and unsafe redirects fail closed.

**Verification:** Client, state, callback, and adversarial redirect unit tests.

**Dependencies:** Task 29. **Estimated scope:** Medium

## Task 31: Sign in and automatically link existing AutoSale users

**Status:** Completed in `03c77d5` and `2760a32`.

**Description:** Create normal AutoSale sessions for linked identities and automatically link an unlinked Google subject to an active user with the same Google-verified normalized email.

**Acceptance criteria:** Linking is atomic and auditable; identity conflicts never relink accounts; no Google token becomes a Sheets credential.

**Verification:** Service/controller tests for linked, matched-email, conflict, replay, cookies, and security audit events.

**Dependencies:** Task 30. **Estimated scope:** Medium

## Task 32: Onboard a new Google owner and workspace

**Status:** Completed in `03c77d5` and `2760a32`.

**Description:** Use a short-lived protected onboarding grant to collect the business name and atomically create an active user, tenant, `OWNER` membership, identity, and session.

**Acceptance criteria:** Repeated or concurrent completion creates exactly one workspace; expired grants are rejected safely; no password or email verification is required for Google-verified email.

**Verification:** Transaction/concurrency integration tests and onboarding API tests.

**Dependencies:** Tasks 29–31. **Estimated scope:** Medium

## Task 33: Add Google sign-in and onboarding UI

**Status:** Completed in `71e1f07`.

**Description:** Add Google buttons to login/register and a focused business-name onboarding page with safe loading, validation, cancellation, expiry, and redirect behavior.

**Acceptance criteria:** Existing password flows remain available; validated `next` is preserved for existing users; onboarding asks only for business name.

**Verification:** Component, route, accessibility, and browser-flow tests.

**Dependencies:** Task 32. **Estimated scope:** Medium

## Task 34: Configure, roll out, and observe Google Sign-In

**Status:** Implementation and operator documentation complete; live Google callback and production smoke tests remain.

**Description:** Document the production callback and consent-screen setup, add an environment feature flag, privacy-safe metrics/audit events, and staged rollout/rollback checks.

**Acceptance criteria:** Production callback is verified; partial configuration fails startup; disabling sign-in leaves password auth and Google Sheets connections operational.

**Verification:** Config tests, full `pnpm test`, production Docker build, manual existing-user/new-user acceptance, and callback telemetry review.

**Dependencies:** Tasks 29–33. **Estimated scope:** Medium

## Checkpoint: Google Sign-In complete

- [ ] Existing linked users sign in through Google and receive the standard AutoSale session.
- [ ] Matching verified emails link to the existing user without creating duplicates.
- [ ] New users complete business-name onboarding and receive one owner workspace.
- [ ] Password auth and Google Sheets authorization remain independent and fully functional.
- [ ] Replay, conflict, concurrency, cancellation, rollback, and production callback checks pass.

- [ ] A customer connects Google without technical credentials.
- [ ] A private catalogue synchronizes into AutoSale.
- [ ] An approved order reaches the selected sheet exactly once.
- [ ] Revocation and disconnect stop access without losing internal business data.

## Task 35: Simplify product data and order export setup

**Status:** Implementation complete on `codex/data-connections-ux`; live Google acceptance remains.

**Description:** Replace the technical Google configuration flow with one data workspace. Owners choose a Google Sheet or upload CSV/XLSX for products, while order export is connected through the same Picker flow. Confident mappings import automatically; uncertain mappings alone require review.

**Acceptance criteria:**
- [x] Settings contain a dedicated `Дані` tab with separate product-source and order-export cards.
- [x] Google authorization resumes the intended Picker action automatically.
- [x] Catalogue source selection triggers synchronization immediately.
- [x] Confident AI mappings import without a preview; uncertain mappings retain manager review.
- [x] Missing SKU is accepted and generated stably during import.
- [x] A one-tab order spreadsheet is saved and validated automatically; multi-tab files ask for one tab choice.
- [x] API source summaries remain tenant-safe and managers cannot inspect owner data.
- [x] Automated regression suite passes: web 84, worker 96, API 273 tests; production web build passes.
- [x] Run the complete production OAuth → Picker → catalogue import → order export flow against a real customer spreadsheet.
- [x] Verify desktop/mobile layout in the deployed Docker stack after merge.

**Dependencies:** Tasks 20–28. **Estimated scope:** Medium

## Task 36: Reliable catalogue reload and mobile navigation

**Status:** Implemented and verified on the deployed Docker stack.

**Description:** Explain failed catalogue replacements clearly, let owners clear all tenant products before a full reload, provide a reusable accessible confirmation dialog, and expose the complete application navigation through a mobile drawer.

**Acceptance criteria:**
- [x] A current source failure takes precedence over an older successful import summary.
- [x] Wide Google Sheets catalogues support up to 500 columns and long product descriptions up to 65,536 characters.
- [x] Repeated source headings are disambiguated internally by column without modifying the customer's Google Sheet.
- [x] Only an owner can clear products, and only inside their current workspace.
- [x] Clearing preserves orders and records an audit event with the deleted count.
- [x] Confirmation requires one explicit click, not typed text; progress and completion are visible globally.
- [x] Mobile users can open every permitted navigation destination and close the drawer by link, backdrop, or Escape.
- [x] Verify the real replacement spreadsheet through Google Sheets read and AI mapping; uncertain mappings open the review screen before import.

**Dependencies:** Task 35. **Estimated scope:** Small

## Task 37: Persistent workspace shell and smooth navigation

**Status:** Completed and deployed for acceptance on 6 September 2026.

**Description:** Move all authenticated customer routes under one persistent Next.js App Router layout, add a collapsible desktop sidebar, retain the existing mobile drawer, and animate only the changing workspace content instead of remounting the whole application shell.

**Acceptance criteria:**
- [x] Dialogues, orders, catalogue, team, and settings share one persistent authenticated layout without changing their public URLs.
- [x] Internal navigation uses Next.js client-side links; Google and Meta OAuth keep their required external browser navigation.

## Task 35: Hybrid AI catalogue structure analysis

**Status:** Implemented and verified with the real supplier sheet in production on 7 September 2026.

- [x] Preserve original row and column coordinates for CSV, XLSX, and Google Sheets.
- [x] Detect multi-row headers and semantic columns with strict OpenAI structured output.
- [x] Classify obvious rows locally and send only ambiguous rows to AI.
- [x] Reuse confirmed Google Sheet layouts and pause safely when the structure changes.
- [x] Show backend-driven progress and concise review context without exposing source rows.
- [x] Verify the real MetrDoor sheet after production deployment: version-2 analysis found header rows 21–22, data from row 24, confidence 0.97, 46 product rows, and 13 skipped structure rows.
- [x] Desktop navigation expands to 240 px, collapses to a stable 72 px icon rail, and restores the preference without a first-frame width jump.
- [x] Active and nested routes expose `aria-current`; collapsed links and icon controls retain accessible names.
- [x] Mobile navigation remains a modal drawer with backdrop, Escape, focus return, and close-on-navigation behavior.
- [x] Route-level loading and error states replace only workspace content; transitions respect `prefers-reduced-motion`.
- [x] Production Docker stack is healthy and the deployed domain returns HTTP 200.
- [x] Browser acceptance confirms desktop collapse, persistence after refresh, accessible navigation labels, and route changes on `https://sales-aito.com`.

**Verification:** `pnpm test` — web 118, API 292, worker 105, config 18, contracts 20, database 14, integrations 73, observability 5 tests passed; `pnpm typecheck`; `pnpm --filter @autosale/web build`; `git diff --check`; Docker Compose rebuild and health checks.

**Dependencies:** Tasks 35–36. **Estimated scope:** Medium

## Production Google Sheets acceptance — 7 September 2026

- [x] Owner OAuth connection and Google Picker operate on `https://sales-aito.com` without exposing credentials.
- [x] The selected MetrDoor sheet reused the structure plan for its exact source revision and imported 46 of 46 products after a full catalogue clear.
- [x] A reviewed test order was corrected against the current catalogue, approved, and exported to the selected `SalesOrder` sheet.
- [x] The export completed once on row 2 with status `SUCCEEDED`, one attempt, and no error summary.
- [x] AutoSale displayed both the 46-product catalogue and the successful Google Sheets row number after a fresh page load.
- [x] Approval now returns the newly queued export and the order screen shows `Очікує синхронізації` immediately, without a manual refresh.

## Task 38: Live Instagram inbox and manual AI order creation

**Status:** Implemented; production acceptance pending.

**Description:** Keep the open Instagram dialogue and conversation list current without a page reload, and let a manager explicitly start AI order recognition when no configured confirmation phrase was sent.

- [x] Refresh an open conversation in the background and render new inbound messages without switching chats.
- [x] Refresh conversation previews and ordering without remounting the workspace page.
- [x] Replace the disabled placeholder with a tenant-scoped manual order action.
- [x] Process manual requests through the same AI recognition, approval, catalogue matching, and Sheets export pipeline as automatic triggers.
- [x] Keep repeated clicks idempotent for the latest message and expose the latest order state in the conversation.
- [ ] Verify one automatic trigger and one manual order against the real Instagram account in production.

**Dependencies:** Tasks 8–11, 18–19. **Estimated scope:** Small

## Task 39: Stable inbox layout and manager-friendly order review

**Status:** Implemented; production acceptance pending.

**Description:** Keep the conversation list, message history, composer, and order summary in independent viewport regions, and translate AI validation into clear manager actions.

- [x] Give the conversation list and message history independent scrolling.
- [x] Pin the reply composer to the bottom of the dialogue viewport.
- [x] Keep new messages visible while preserving the manager's position when reading older history.
- [x] Keep the conversation list mounted across chat navigation and update only the center and order panels.
- [x] Refresh conversation previews independently in the background when Instagram activity changes.
- [x] Correct the order page grid so the review form uses the available width.
- [x] Recalculate required fields from extracted data instead of trusting contradictory AI `missingFields` output.
- [x] Deduplicate validation issues and replace internal paths with Ukrainian guidance.
- [x] Use enriched Instagram profile data as the customer-name and username fallback.
- [ ] Verify the revised inbox and order review at desktop and mobile widths in production.

**Dependencies:** Task 38. **Estimated scope:** Small

## Task 40: Optional conversational AI order-intent detection

**Status:** Planned.

**Description:** Add an owner-controlled mode that can recognize a completed sales agreement from the conversation without requiring one exact manager phrase. Keep the deterministic trigger phrase and manual action available.

- [ ] Add modes: trigger phrase only, AI suggestion, and high-confidence AI automation.
- [ ] Evaluate only new relevant conversation revisions and prevent duplicate orders idempotently.
- [ ] Require explicit purchase intent plus usable customer, delivery, and product data for automatic creation.
- [ ] Send uncertain cases to the manager as a proposed order instead of silently creating one.
- [ ] Show why AI proposed or created the order without exposing internal schema paths.
- [ ] Track cost, latency, false positives, and manager corrections before enabling automatic mode by default.

**Dependencies:** Tasks 18, 38–39. **Estimated scope:** Medium

## Task 41: Add optional shared-bot configuration

**Description:** Configure one operator-owned AutoSale bot without making Telegram credentials mandatory when the integration is unused.

**Acceptance criteria:**
- [x] Complete Telegram configuration is optional outside live use, while partial configuration fails startup clearly.
- [x] Customers never submit or receive a bot token, and logs/errors never expose it.
- [x] API and worker parse the same bot username, token, and webhook-secret contract.

**Verification:**
- [x] `pnpm --filter @autosale/config test`

**Dependencies:** None

**Files likely touched:** `.env.example`, API and worker environment schemas, and their colocated specs.

**Estimated scope:** Medium

## Task 42: Add a safe Bot API adapter

**Description:** Provide a narrow HTTPS adapter for bot identity validation and text delivery with bounded Telegram error mapping.

**Acceptance criteria:**
- [x] The adapter supports `getMe` and text delivery without exposing the configured token.
- [x] Network, authorization, rate-limit, forbidden-chat, and provider failures map to bounded safe codes.
- [x] Tests use a fake HTTPS boundary and never contact Telegram.

**Verification:**
- [x] `pnpm --filter @autosale/integrations test`

**Dependencies:** Task 41

**Files likely touched:** `packages/integrations/src/telegram-bot.ts`, its spec, and package exports.

**Estimated scope:** Small

## Task 43: Add tenant-safe Telegram contracts and persistence

**Description:** Persist link attempts, member bindings, business/group chat summaries, and durable delivery state with stable idempotency constraints.

**Acceptance criteria:**
- [x] Link attempts are hashed, expiring, single-use, and bound to tenant, user, and purpose.
- [x] External Telegram identifiers are stored losslessly as strings without cross-tenant uniqueness mistakes.
- [x] Each logical delivery has one durable row and a stable unique idempotency key.

**Verification:**
- [x] `pnpm --filter @autosale/contracts test`
- [x] `pnpm --filter @autosale/database test`

**Dependencies:** Task 42

**Files likely touched:** `packages/contracts/src/telegram.ts`, contract specs, `packages/database/prisma/schema.prisma`, one additive migration.

**Estimated scope:** Medium

## Checkpoint: Telegram provider foundation

- [x] Configuration, adapter, contract, and migration tests pass.
- [x] Partial production configuration fails without printing secrets.
- [x] Schema constraints demonstrate tenant isolation and delivery idempotency.

## Task 44: Receive and verify Telegram webhook updates

**Description:** Add a public endpoint that verifies Telegram's webhook secret and processes only supported, validated connection/link updates.

**Acceptance criteria:**
- [x] Invalid or missing secret headers and malformed updates produce no state change.
- [x] Replayed update IDs are acknowledged without duplicate processing.
- [x] Valid Start, group Start, and business-connection updates invoke narrow tenant-safe services.

**Verification:**
- [x] `pnpm --filter @autosale/api test`

**Dependencies:** Task 43

**Files likely touched:** Telegram API controller/service/module and specs, `apps/api/src/app.module.ts`.

**Estimated scope:** Medium

## Task 45: Link and summarize personal or group Telegram destinations

**Description:** Let authenticated members generate safe deep links, inspect their own connection status, and unlink without deleting AutoSale business data.

**Acceptance criteria:**
- [x] Personal link is membership-scoped; supplier-group link is owner-only.
- [x] Safe summaries expose status and display labels but no secrets or another user's private chat ID.
- [x] Unlink revokes the binding and future delivery while preserving audit history.

**Verification:**
- [x] `pnpm --filter @autosale/api test`

**Dependencies:** Tasks 43–44

**Files likely touched:** Telegram API controller/service/module and specs, shared contracts.

**Estimated scope:** Medium

## Task 46: Deliver queued Telegram messages durably

**Status:** Implemented and verified on 9 September 2026.

**Description:** Claim PostgreSQL deliveries in the worker, send through the shared Bot API, and reconcile retryable or abandoned work.

**Acceptance criteria:**
- [x] The database delivery exists before queue wake-up, and missed wake-ups are recovered.
- [x] Success records the provider message ID; retryable and terminal failures store only safe codes.
- [x] Repeated jobs, worker restarts, and expired leases cannot produce a second logical delivery request.

**Verification:**
- [x] `pnpm --filter @autosale/worker test`

**Dependencies:** Tasks 41–45

**Files likely touched:** Telegram worker processor/reconciler/module and specs.

**Estimated scope:** Medium

## Checkpoint: Telegram durable connection flow

- [x] Valid Start links one member exactly once.
- [x] Webhook replay and queue retry tests pass.
- [x] A fake Bot API test message reaches `SUCCEEDED` exactly once.

## Task 47: Add the minimal Telegram connection card and test notification

**Description:** Add a Telegram settings tab where a member can open the shared bot, see connection status, send a privacy-safe test alert, and unlink.

**Acceptance criteria:**
- [x] The card explains the single Start action and never asks for BotFather or a token.
- [x] Pending actions show stable loading state and global success/error notifications.
- [x] Owner and manager see only data permitted for their own membership, on desktop and mobile.

**Verification:**
- [x] `pnpm --filter @autosale/web test`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] Browser check at desktop and 390px widths.

**Dependencies:** Tasks 44–46

**Files likely touched:** settings page/tabs, Telegram settings component and spec, API client, `apps/web/app/globals.css`.

**Estimated scope:** Medium

## Checkpoint: Telegram platform module complete

- [x] Full automated suite passes and production images build.
- [x] Docker services remain healthy without live Telegram credentials.
- [x] With operator credentials, one Start action links a test user and one test notification is delivered exactly once.
- [x] Human review approves the platform before `supplier-dispatch` implementation starts.

## Checkpoint: комплектація та сповіщення

- [x] Після підтвердження кожна позиція автоматично отримує рішення `IN_STOCK` або `TO_ORDER`.
- [x] Паралельні замовлення не резервують один і той самий залишок двічі.
- [x] Менеджер може змінити рішення, надіслати лише `TO_ORDER` постачальнику та завершити передачу.
- [x] Статус позиції синхронізується з результатом Telegram-доставки.
- [x] Особисті Telegram-сповіщення налаштовуються окремо для кожного користувача й не містять даних клієнта.
- [x] Старі підтверджені замовлення обробляються фоновими пакетами без повторної оцінки завершених позицій.
- [x] Production rollout: 865 тестів, typecheck, production build, Compose validation, additive migration, health-check і публічний smoke test виконано 10 вересня 2026 року; 6 історичних замовлень успішно оцінено фоновим backfill.

## Наступний пріоритет: доставка перед оплатою

До реалізації банківських рахунків і повного модуля оплат AutoSale має створювати та відстежувати відправлення. Перший перевізник — Нова пошта; далі окремими адаптерами додаються Meest та Укрпошта. Погоджений дизайн: `docs/superpowers/specs/2026-09-10-delivery-carriers-and-nova-poshta-design.md`.

## Task 60: Add provider-neutral delivery contracts and persistence

- [x] Add carrier, connection, sender-profile, shipment, status-event and idempotency contracts.
- [x] Add an additive tenant-safe migration with one active shipment per order and preserved attempt history.
- [x] Store only provider credential ciphertext and keep the secret outside public contracts and browser responses.

Status: complete on 2026-09-11. Verification: contracts `52/52`, database `42/42`, full workspace typecheck passed; migration `20260910180000_delivery_foundation` applies from an empty PostgreSQL database.

## Task 61: Implement the Nova Poshta API adapter

- [x] Validate credentials and expose typed sender, city, branch, parcel-locker, quote, create, status, label and cancel operations.
- [x] Validate every external response and map provider failures to bounded safe codes.
- [x] Cover authorization errors, validation errors, rate limits, malformed responses, timeouts and unknown create outcomes with fake HTTP tests.

Status: complete on 2026-09-11. Verification: Nova Poshta adapter covered by fake HTTP tests only; integrations `111/111` and package typecheck passed without contacting the provider.

## Task 62: Connect Nova Poshta and configure sender defaults

- [x] Add `Налаштування → Доставка` with an owner-only API-key connection flow.
- [x] Let the owner choose sender, contact, origin, payer and default parcel parameters.
- [x] Let managers use the connection without exposing or changing its secret.

Status: complete on 2026-09-11. Verification: delivery API/controller `13/13`, Nova Poshta adapter `11/11`, web delivery/settings `9/9`, config `26/26`, package and full workspace typechecks passed. Credentials remain encrypted server-side; browser responses and manager UI never contain the API key.

## Task 63: Add delivery location search and caching

- [x] Search exact Nova Poshta cities, branches and parcel lockers instead of sending AI-extracted text directly.
- [x] Use bounded caching, debounce, keyboard-accessible results and clear stale-reference recovery.
- [x] Keep the public contract provider-neutral for later Meest and Ukrposhta adapters.

Status: complete on 2026-09-11. Verification: contracts `53/53`, API `363/363`, web `167/167`, full workspace typecheck passed. Search is tenant-scoped, credential-generation-aware, capped at 50 results and cached for five minutes without caching rejected calls.

## Task 64: Add shipment draft, quote and manager review

- [x] Pre-fill recipient and delivery hints from the approved order and tenant defaults.
- [x] Require an exact location, parcel data, declared value, payer and optional COD amount.
- [x] Calculate and show the delivery quote without creating an external document.
- [x] Provide a responsive review dialog/drawer with stable loading states.

Status: complete on 2026-09-11. Verification: API `370/370`, web `173/173`, contracts `53/53`, and full workspace typecheck passed. Chat-extracted city/branch values remain search hints only; the persisted draft contains exact provider references and quote calls do not create a TTN.

## Task 65: Create Nova Poshta TTNs idempotently

- [x] Persist the create intent before contacting Nova Poshta and return an asynchronous shipment summary.
- [x] Prevent duplicate TTNs across clicks, request retries, worker retries and restarts.
- [x] Reconcile timeout/unknown outcomes using a stable client reference before any retry.
- [x] Show the created TTN and safe recovery actions without a full page reload.

## Task 66: Add labels, cancellation and shipment tracking

- [x] Download authorized labels, copy/open tracking and cancel where the provider permits it.
- [x] Poll active shipment statuses in the background and retain a status-event history.
- [x] Show delivery status in order detail, the paginated orders table and mobile cards.

## Task 67: Let a manager notify the customer about the TTN

- [x] Generate an editable tenant-branded Instagram message after successful TTN creation.
- [x] Require an explicit manager click to send in the first version.
- [x] Keep Instagram delivery failures independent from the shipment and preserve copyable TTN details.

Status: complete on 2026-09-11. The message uses the workspace name, an owner-editable template and the existing durable Instagram queue. Duplicate clicks reuse one shipment-version idempotency key; failed Instagram delivery leaves the shipment and TTN unchanged and provides a copy fallback. Verification: API `380/380`, web `179/179`, contracts `54/54`, full workspace typecheck and production build; the one transient PostgreSQL migration-test reset passed on isolated rerun.

## Task 68: Verify and roll out Nova Poshta delivery

- [x] Add privacy, tenant-isolation, observability, idempotency and mobile regressions.
- [x] Let an owner choose a sender city and branch/parcel locker in AutoSale when Nova Poshta returns no saved sender addresses.
- [ ] Complete one controlled real Nova Poshta shipment acceptance after the owner selects the actual sender city and branch/parcel locker.
- [ ] Verify duplicate prevention, quote, TTN, label, status sync, cancellation where allowed and manual customer notification during that acceptance.
- [ ] After stabilization, plan Meest, Ukrposhta, bank-account filtering and payments in that order.

Status: automated rollout checks in progress on 2026-09-12. The authenticated-tenant matrix covers connection, location, draft, quote, create, label, cancellation and customer message boundaries. A new regression found and fixed generic `apiKey`/credential log redaction. The 390×844 delivery drawer check covers horizontal overflow, sticky actions, stable loading width and right-aligned toast; component coverage verifies focus restoration. Owner onboarding opens the Nova Poshta API-key settings directly, uses one manual-paste field with one connection action and preselects the only available sender profile. Accounts without a Nova Poshta-saved sender origin can now search and persist an exact city plus branch or parcel-locker reference directly in AutoSale. Production migration `20260910180000_delivery_foundation` applied successfully and API, web, worker, PostgreSQL, Redis and MinIO are healthy. At the owner's request, real-provider acceptance is deferred until the actual sender city and branch/parcel locker are selected; this remains a required pre-rollout check and does not block work on the next carrier.

## Task 69: Automate production deployment from master

- [x] Run type checking, tests, production build and dependency audit for every pull request and push to `master`.
- [x] Keep production deployment disabled until the real server and GitHub Environment secrets are configured.
- [x] Deploy the exact verified `master` commit through a pinned SSH host key and a dedicated deployment user.
- [x] Serialize deployments, run migrations, wait for container health checks and restore the previous application commit on failure.
- [x] Document the one-time server and GitHub setup without storing production secrets in the repository.

Status: implementation complete on 2026-09-11 and intentionally inactive until a real server is configured. Verification: 954 tests, workspace typecheck, production build, production Docker image build, Compose validation, shell syntax validation, workflow YAML validation and production dependency audit passed; no high-severity audit findings remain.

## Task 70: Add Meest connection and directories

- [x] Verify the current official API authentication, sandbox, HTTPS endpoints and provider error model.
- [x] Add a credential-safe XML query adapter with signed requests, city/branch mapping and contract tests.
- [x] Add encrypted tenant credentials for Meest (`login`, `password`, `ClientUID`) without returning secrets to the browser.
- [x] Add owner connection UI in Delivery settings.
- [x] Make the shared location API and picker provider-aware for Meest city, branch and parcel-locker directories.
- [x] Add provider-aware city/branch search and persist the Meest sender name, phone, exact origin and parcel defaults in Delivery settings.
- [ ] Verify the official sandbox and document any contract-only production prerequisites.

Status: implementation started on 2026-09-12. Official Meest documentation confirms that production login/password are supplied after signing a contract, while test client parameters and browser sandboxes are available. The adapter uses the working HTTPS endpoints even though some documentation examples still show HTTP, signs requests with the documented MD5 envelope, disables XML entity processing, validates response structure and exposes only safe error codes. Provider-aware directory search now resolves credentials per tenant and carrier and isolates cached results by provider and credential generation; the remaining settings step is to persist Meest sender identity and its selected origin.

## Task 71: Create and track Meest shipments

- [ ] Extend provider-neutral shipment drafts so the manager explicitly chooses an active carrier.
- [ ] Implement Meest quote, idempotent create, lookup/reconciliation, label, tracking and allowed cancellation.
- [ ] Map Meest statuses into the existing shipment lifecycle without provider-specific UI leakage.
- [ ] Complete sandbox acceptance before enabling production shipment creation.

## Task 72: Add Ukrposhta delivery

- [ ] Confirm current official API onboarding, test environment and credential model.
- [ ] Implement the same connection, directory, shipment and acceptance slices through a separate adapter.

## Task 73: Add bank accounts and payments

- [ ] Model tenant legal entities, currencies, bank accounts and payment state after delivery adapters stabilize.
- [ ] Filter selectable accounts by the order's legal entity and payment currency and show only active accounts.
- [ ] Add payment recording and reconciliation as a separate audited lifecycle.
