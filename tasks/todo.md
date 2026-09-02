# Instagram Order Capture MVP — Task Checklist

## Task 1: Verify Meta and Google access prerequisites

**Description:** Prove access to a test Instagram Professional account, required Meta permissions/webhooks, and a staging Google OAuth/Picker application before implementation depends on them.

**Acceptance criteria:**
- [ ] Meta webhook verification and one real message event are demonstrated.
- [ ] A tenant owner can authorize Google and grant access only to a selected private test spreadsheet through Picker.
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

**Description:** Let an authenticated manager reply to an Instagram conversation from AutoSale through the official Instagram Send API. Persist the outbound message idempotently and reconcile it with Meta's echo webhook.

**Acceptance criteria:**
- [ ] The conversation page has an accessible message composer with pending, sent, and failed states.
- [ ] The API sends text replies only for an active tenant-bound Instagram connection and never exposes the access token.
- [ ] Meta echo webhooks reconcile with the locally initiated reply without creating duplicate messages.
- [ ] Provider limits and expired/revoked credentials produce actionable errors and safe retry behavior.
- [ ] A configured manager confirmation phrase sent from AutoSale can trigger the existing AI order-recognition flow exactly once.

**Verification:**
- [ ] Unit and integration tests cover authorization, Send API errors, idempotency, and echo reconciliation.
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
- [ ] Sheets, Drive, and Picker APIs, OAuth client, production origin, callback, branding, and least-privilege scope are documented.
- [ ] Partial or unsafe environment configuration fails startup without exposing secrets.
- [ ] Picker API key is restricted to the production origin and Picker API.

**Verification:** Config tests, typecheck, Compose configuration validation, and manual Google Console checklist.

**Dependencies:** Approved Google OAuth design. **Estimated scope:** Medium

## Task 21: Persist tenant Google connections and OAuth attempts

**Description:** Add tenant-bound encrypted credential state and single-use authorization attempts.

**Acceptance criteria:**
- [ ] Refresh tokens are encrypted and never returned or logged.
- [ ] State is expiring, single-use, and bound to tenant, owner, and safe return path.
- [ ] Database constraints prevent cross-tenant or duplicate active connections.

**Verification:** PostgreSQL migration tests, replay/expiry tests, Prisma validation, and API typecheck.

**Dependencies:** Task 20. **Estimated scope:** Medium

## Task 22: Implement OAuth connect, callback, reconnect, and summary

**Description:** Let an owner authorize AutoSale with Google and safely persist/refresh the tenant grant.

**Acceptance criteria:**
- [ ] Only owners can initiate or replace a connection.
- [ ] Callback validates state, identity, scopes, subject, and refresh-token lifecycle.
- [ ] Safe API responses expose status and owner-visible email but no credential material.

**Verification:** Unit/controller tests for success, cancellation, replay, mismatch, missing token, and reconnect.

**Dependencies:** Task 21. **Estimated scope:** Medium

## Task 23: Disconnect Google and clean credentials durably

**Description:** Stop new Google work immediately, revoke the grant where possible, and remove only the matching credential generation.

**Acceptance criteria:**
- [ ] Disconnect pauses dependent catalogue sources and destinations without deleting internal data.
- [ ] Failed revocation is retryable and cannot block a later safe reconnect indefinitely.
- [ ] A stale cleanup cannot delete a newer credential.

**Verification:** Cleanup/reconciler migration tests and reconnect concurrency tests.

**Dependencies:** Task 22. **Estimated scope:** Medium

## Task 24: Select private spreadsheets with Google Picker

**Description:** Replace raw ID-only onboarding with owner sign-in, Picker selection, server validation, and tab selection.

**Acceptance criteria:**
- [ ] Owner selects only Google Sheets files explicitly shared with AutoSale.
- [ ] Backend verifies file type/access and lists real tabs before saving.
- [ ] Cancellation, inaccessible files, deleted files, and provider errors are actionable.

**Verification:** Component/API tests plus a real private staging spreadsheet.

**Dependencies:** Task 22. **Estimated scope:** Medium

## Task 25: Use tenant OAuth for Google catalogue synchronization

**Description:** Feed tenant access tokens into the existing Google catalogue, AI mapping, and scheduled synchronization pipeline.

**Acceptance criteria:**
- [ ] Selected private sheet can create a mapping review and confirmed catalogue import.
- [ ] Scheduled/manual sync refreshes tokens without browser presence.
- [ ] Revoked access pauses safely and preserves the last valid catalogue.

**Verification:** Catalogue sync, fencing, mapping, scheduler, and tenant-isolation tests.

**Dependencies:** Tasks 23–24. **Estimated scope:** Medium

## Task 26: Use tenant OAuth for Google order export

**Description:** Validate a Picker-selected destination and export approved orders with existing exactly-once semantics.

**Acceptance criteria:**
- [ ] First export appends and later changes update by stable `order_id`.
- [ ] Repeated clicks, retries, timeouts, and reconnects do not duplicate rows.
- [ ] Catalogue and order spreadsheet configuration remain independent.

**Verification:** Settings/worker integration tests and real staging export.

**Dependencies:** Tasks 23–24. **Estimated scope:** Medium

## Task 27: Deliver the Google connection wizard

**Description:** Add the owner experience for connection, file/tab selection, purpose selection, validation, synchronization, reconnect, and disconnect.

**Acceptance criteria:**
- [ ] Owner never handles API keys, JSON credentials, or refresh tokens.
- [ ] Catalogue and order-export sections show selected file, tab, status, and safe errors.
- [ ] Managers and platform administrators retain the approved privacy boundaries.

**Verification:** Role/accessibility component tests and production web build.

**Dependencies:** Tasks 24–26. **Estimated scope:** Medium

## Task 28: Complete Google staging and production readiness

**Description:** Verify the complete private-Sheets workflow, migrate away from production service-account use, and prepare Google verification.

**Acceptance criteria:**
- [ ] Real OAuth → Picker → catalogue import → AI mapping → order export flow passes.
- [ ] Revoke, reconnect, disconnect, deleted-tab, quota, and restart recovery cases pass.
- [ ] Production branding, domains, policies, scopes, evidence, and credentials are configured.

**Verification:** Full test/typecheck/E2E/build suite and sanitized acceptance record.

**Dependencies:** Tasks 20–27. **Estimated scope:** Medium

## Checkpoint: Google Sheets OAuth complete

- [ ] A customer connects Google without technical credentials.
- [ ] A private catalogue synchronizes into AutoSale.
- [ ] An approved order reaches the selected sheet exactly once.
- [ ] Revocation and disconnect stop access without losing internal business data.
