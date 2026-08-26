# Instagram Order Capture MVP — Task Checklist

## Task 1: Verify Meta and Google access prerequisites

**Description:** Prove access to a test Instagram Professional account, required Meta permissions/webhooks, and a restricted Google service account before implementation depends on them.

**Acceptance criteria:**
- [ ] Meta webhook verification and one real message event are demonstrated.
- [ ] The Google service account can read and append to only the selected test spreadsheet.
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

## Task 12: Configure and validate a Google Sheets destination

**Description:** Add tenant-scoped spreadsheet configuration, service-account authentication, header mapping, and a connectivity check.

**Acceptance criteria:**
- [ ] Credentials are supplied as a mounted secret or secret reference, never committed.
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
