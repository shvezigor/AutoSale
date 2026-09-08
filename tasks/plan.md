# Implementation Plan: Instagram Order Capture MVP

## Overview

Build a self-hosted, single-client MVP that receives messages from an Instagram Professional account through the official Meta API, stores conversations, detects a confirmed order, extracts structured customer and product data with AI, lets a manager review uncertain results, and synchronizes approved orders to Google Sheets through the official API. The complete system must run with Docker Compose and remain portable between Linux servers.

## Scope

### Included in the MVP

- One business client and one Instagram Professional account.
- Official Meta webhook ingestion and Conversations/Send API integration.
- Text and image attachment capture.
- Conversation history and order-trigger detection.
- AI extraction into a validated schema.
- Product catalogue with aliases and deterministic candidate search.
- Manager inbox for review, correction, and approval.
- Google Sheets synchronization through the Google Sheets API.
- Containerized web, API, worker, PostgreSQL, Redis, and MinIO services.
- Audit log, retry handling, health checks, backups, and deployment documentation.

### Explicitly deferred

- Automatic customer replies.
- Automatic Nova Poshta waybill creation.
- Telegram, Viber, TikTok, and OLX channels.
- Billing, subscriptions, and public self-service onboarding.
- Multiple active tenants in the UI.

The schema and integration interfaces will carry `tenant_id` from the beginning, but the MVP will expose only one configured tenant.

## Architecture Decisions

- **Monorepo:** pnpm workspaces with `apps/api`, `apps/worker`, `apps/web`, and shared packages.
- **Backend:** TypeScript and NestJS for HTTP APIs, webhook verification, domain services, and generated OpenAPI documentation.
- **Frontend:** Next.js, React, TypeScript, Tailwind CSS, and shadcn/ui.
- **Primary storage:** PostgreSQL through Prisma migrations. Google Sheets is a projection, never the source of truth.
- **Background processing:** Redis and BullMQ for media download, AI extraction, product matching, and Sheets synchronization.
- **Object storage:** S3-compatible interface; MinIO in local/self-hosted deployments.
- **AI boundary:** OpenAI Responses API adapter returning a strict, versioned JSON schema. The model extracts facts from prompts, conversation context, images, and supplied catalogue candidates; local validation rejects unknown SKUs and incomplete output.
- **Approval policy:** each tenant selects `ALWAYS`, `NEVER`, or `ON_LOW_CONFIDENCE`. Automatic approval is permitted only after schema, catalogue, completeness, and duplicate validation.
- **Instagram boundary:** official Meta APIs only. Raw webhook payloads are retained for replay and audit.
- **Google Sheets boundary:** a dedicated adapter using the Google Sheets API. Each tenant owner connects Google through AutoSale's OAuth web application and explicitly selects files through Google Picker using the least-privilege `drive.file` scope. A service account remains development-only during migration.
- **Idempotency:** unique external message IDs, unique order trigger IDs, and a unique `(tenant_id, order_id, destination)` export key prevent duplicate orders and rows.
- **Portability:** one production-oriented Docker Compose definition, environment-based secrets, versioned database migrations, named volumes, and documented backup/restore procedures.

## Runtime Topology

```text
Internet
   |
Caddy (HTTPS)
   |-- Next.js web
   `-- NestJS API <-- Meta webhooks
           |
        PostgreSQL
           |
        Redis/BullMQ --> Worker --> MinIO
                         |  |        |
                         |  |        `-- message images
                         |  `----------- AI provider
                         `-------------- Google Sheets API
```

## Core Data Flow

1. Meta calls the webhook endpoint.
2. API verifies the challenge/signature, records the raw event, and returns quickly.
3. A queue job normalizes and deduplicates the message.
4. Media is copied to controlled object storage before source URLs expire.
5. Conversation context is evaluated for an explicit order trigger.
6. AI extracts customer, products, quantity, and delivery fields into a strict schema.
7. Deterministic catalogue search produces SKU candidates; AI may rank only those candidates.
8. Local validation checks required fields, catalogue IDs, and duplicates after AI extraction.
9. The tenant approval policy routes the order to `NEEDS_REVIEW` or `AUTO_APPROVED`; unsafe results always require review.
10. When review is required, a manager approves or corrects the order in the web interface.
10. An idempotent job appends or updates the Google Sheets row by `order_id`.

## Google Sheets Contract

The target spreadsheet contains one protected header row and one row per order. The adapter locates an existing row by `order_id`; it updates that row or appends a new one.

Initial columns:

| Column | Meaning |
|---|---|
| `order_id` | Stable internal identifier |
| `created_at` | Order creation time |
| `status` | Current order status |
| `channel` | `instagram` |
| `conversation_id` | External conversation reference |
| `customer_name` | Confirmed customer name |
| `customer_phone` | Normalized phone |
| `sku` | Confirmed catalogue SKU |
| `product_name` | Canonical product name |
| `quantity` | Confirmed quantity |
| `delivery_city` | City/locality |
| `delivery_branch` | Branch/address text |
| `manager_note` | Manual note |
| `confidence` | Extraction/matching confidence |
| `updated_at` | Last synchronized update |

The exact client spreadsheet can add mapped columns through configuration without leaking sheet-specific logic into the order domain.

## Task List

### Phase 1: Foundations and risk probes

- [ ] Task 1: Verify Meta and Google access prerequisites.
- [ ] Task 2: Scaffold and run the portable container stack.
- [ ] Task 3: Add configuration, health checks, and secret validation.

### Checkpoint: Foundation

- [ ] All containers become healthy from a clean checkout.
- [ ] Meta webhook challenge succeeds in a test environment.
- [ ] A tenant owner can authorize the staging Google OAuth client and select only the intended private spreadsheet through Picker.
- [ ] Review results before building domain features.

### Phase 2: First vertical slice — Instagram message to inbox

- [ ] Task 4: Persist and deduplicate verified Meta webhook events.
- [ ] Task 5: Normalize Instagram conversations, messages, and media.
- [ ] Task 6: Display the conversation inbox in the manager UI.

### Checkpoint: Conversation capture

- [ ] A real test message and photo appear once in the web inbox.
- [ ] Replayed webhook events do not create duplicates.
- [ ] API, worker, and browser tests pass.

### Phase 3: Second vertical slice — conversation to reviewed order

- [ ] Task 7: Import and search the product catalogue.
- [ ] Task 8: Detect the confirmed-order trigger.
- [ ] Task 9: Extract a strict, validated order draft through the OpenAI Responses API.
- [ ] Task 10: Match product candidates and calculate confidence.
- [ ] Task 11: Configure approval policy and review only orders routed to `NEEDS_REVIEW`.

### Checkpoint: Reviewed order

- [ ] A representative conversation produces a reviewable order draft.
- [ ] Unknown or ambiguous products cannot be silently approved by AI.
- [ ] Manager corrections are audited.
- [ ] Extraction evaluations meet the agreed acceptance threshold.

### Phase 4 (current first priority): Tenant Google OAuth and Picker

- [ ] Task 20: Configure the AutoSale Google Cloud project and OAuth contract.
- [ ] Task 21: Persist tenant Google connections and single-use OAuth attempts.
- [ ] Task 22: Implement OAuth start, callback, reconnect, and safe connection summary.
- [ ] Task 23: Add durable disconnect and credential cleanup.
- [ ] Task 24: Select and validate private spreadsheets through Google Picker.
- [ ] Task 25: Use tenant OAuth for catalogue synchronization.
- [ ] Task 26: Use tenant OAuth for idempotent order export.
- [ ] Task 27: Deliver the owner-facing Google connection wizard.
- [ ] Task 28: Complete staging, verification, migration, and end-to-end acceptance.

Detailed execution steps: `docs/superpowers/plans/2026-09-02-google-sheets-oauth-connection.md`.

### Phase 5: Approved order to Google Sheets

- [ ] Task 12: Configure and validate a Google Sheets destination.
- [ ] Task 13: Synchronize approved orders idempotently.
- [ ] Task 14: Surface synchronization state and allow safe retry.

### Checkpoint: Google Sheets export

- [ ] Approval creates exactly one row with the expected mapping.
- [ ] Updating the order updates the existing row.
- [ ] API retries and job retries do not duplicate rows.
- [ ] A revoked credential produces an actionable error without losing the order.

### Phase 6: Operational readiness

- [ ] Task 15: Add audit, structured logs, metrics, and error reporting.
- [ ] Task 16: Add backup, restore, migration, and deployment procedures.
- [ ] Task 17: Run end-to-end acceptance and failure testing.

### Checkpoint: MVP complete

- [ ] All focused, integration, and end-to-end tests pass.
- [ ] Production images build without development dependencies.
- [ ] The stack is restored on a second clean Docker host from backup.
- [ ] No production secret exists in the repository or container images.
- [ ] The client accepts the Instagram-to-Google-Sheets workflow.

## Dependency Graph

```text
1 Meta/Google access probe
|\
| `------------------------------> 12 Sheets configuration
v
2 Container stack -> 3 Config/health
                        |
                        v
4 Webhook persistence -> 5 Normalization -> 6 Inbox UI
                              |
                              v
7 Catalogue -> 8 Trigger -> 9 AI extraction -> 10 Matching -> 11 Review
                                                               |
                                                               v
12 Sheets configuration -> 13 Sync -> 14 Sync recovery
                                         |
                                         v
15 Observability -> 16 Operations -> 17 End-to-end acceptance
```

## Verification Strategy

- Unit tests cover signature validation, normalization, trigger rules, schemas, candidate scoring, field mapping, and idempotency keys.
- Integration tests use PostgreSQL, Redis, and MinIO containers and mock external Meta, AI, and Google endpoints.
- Contract fixtures preserve representative Meta webhook payloads and Google Sheets responses.
- AI evaluation uses an anonymized, versioned dataset of real or representative conversations; outputs are scored per field and for correct SKU selection.
- Playwright verifies inbox, review, approval, and synchronization status.
- A staging test uses real Meta and Google test resources before production access.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Meta App Review or permissions are delayed | High | Make Task 1 a blocking spike; use a client-owned test account before estimating production launch. |
| Message media URL expires | High | Queue immediate download and retain checksum plus original metadata. |
| Trigger phrase produces false positives | High | Require conversation context and completeness checks; unsafe results override the tenant's auto-approval preference and require review. |
| AI selects the wrong SKU | High | Retrieve deterministic candidates, enforce confidence thresholds, and require review for ambiguity. |
| Google Sheets rows are duplicated | High | Persist export state and row identity; use an order-level idempotency key and reconciliation job. |
| User manually changes headers/columns | Medium | Validate configured headers before export and stop with an actionable error. |
| Google quota or transient outage | Medium | Exponential backoff, queue retry, dead-letter state, and manual retry. |
| Docker host is lost | High | Automated PostgreSQL and object-storage backups plus tested restore procedure. |
| Single-client assumptions leak into code | Medium | Keep `tenant_id`, integration interfaces, and credential boundaries from day one. |

## Inputs Required Before Implementation

- Meta Business ownership and Instagram Professional account details.
- A Meta developer app or authority to create one.
- Exact confirmation phrases and 50–100 anonymized example conversations for the first evaluation set.
- Product catalogue with stable SKU, canonical name, variations, aliases, and reference photos where available.
- Access to create/configure the AutoSale Google Cloud project, a private staging spreadsheet, final catalogue/export tabs, and approval to submit Google OAuth verification materials.
- Rules for incomplete customer phone, delivery data, multiple products, edits, and cancellations.
- Target deployment environment: Linux VPS requirements, domain, and backup destination.

## Definition of Done

The MVP is complete only when a real Instagram test conversation can be ingested, reviewed, approved, and reflected exactly once in Google Sheets; all state remains recoverable after container restart; external outages produce visible retryable failures; and the documented backup can restore the system on another Docker host.

## Telegram platform implementation plan

Approved capability map: `CAPABILITY-MAP-telegram-integration.md`. Current module spec: `SPEC-telegram-platform.md`.

### Architecture decisions

- AutoSale operates one optional shared bot configured by the operator; customers never create a bot or submit a token.
- Telegram webhook updates are accepted only with the configured secret header and persisted through narrow, validated commands rather than as raw payload history.
- A hashed, expiring, single-use deep-link token binds a Telegram identity or group to the authenticated tenant/user.
- PostgreSQL delivery rows are authoritative. BullMQ only wakes workers, and a reconciler recovers missed wake-ups and expired leases.
- Telegram numeric identifiers remain strings, provider errors become bounded safe codes, and personal alerts omit order PII by default.
- Supplier delivery supports Telegram Business when Telegram permits the target chat and a bot-managed group fallback when it does not.

### Dependency graph

```text
Shared config and Bot API adapter
             |
             v
Persistence and contracts
       |             |
       v             v
Webhook receiver   Link/summary API
       \             /
        v           v
       Durable delivery worker
                 |
                 v
       Minimal Telegram settings UI
```

### Phase 1: Provider and persistence foundations

- [ ] Task 41: Add optional shared-bot configuration.
- [ ] Task 42: Add a safe Bot API adapter.
- [ ] Task 43: Add tenant-safe Telegram contracts and persistence.

Checkpoint: focused configuration, adapter, contract, and migration tests pass; partial production configuration fails closed.

### Phase 2: Secure linking and delivery

- [ ] Task 44: Receive and verify Telegram webhook updates.
- [ ] Task 45: Link and summarize personal or group Telegram destinations.
- [ ] Task 46: Deliver queued Telegram messages durably.

Checkpoint: replayed or ambiguous updates do not duplicate bindings or deliveries; tenant, user, and purpose boundaries are covered by tests.

### Phase 3: User-visible platform slice

- [ ] Task 47: Add the minimal Telegram connection card and test notification.

Checkpoint: a member can generate a private deep link, see connected state after Start, send one test alert, and unlink; responsive UI, full tests, typecheck, build, and Docker health pass.

### Sequential versus parallel work

- Tasks 41–43 are sequential because they define shared configuration, the provider adapter, and persistence contracts.
- After Task 43, webhook validation and authenticated link APIs are logically independent, but this implementation remains sequential to avoid shared-module churn.
- Supplier dispatch and personal event preferences start only after Task 47 validates the platform slice.

### Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Bot token or webhook secret leaks | High | Environment-only secrets, redaction, no token API fields, secret-header verification |
| Queue wake-up is lost | High | Commit delivery first; due-delivery reconciler re-enqueues from PostgreSQL |
| Telegram retries a webhook | Medium | Provider update ID uniqueness and transactional single-use link consumption |
| A link binds the wrong tenant or user | High | Short-lived random token, hashed storage, tenant/user/purpose binding, explicit Start |
| Telegram returns ambiguous network failure | Medium | Stable delivery idempotency key, retry state, provider message ID when known, bounded attempts |
| Production bot is not configured yet | Medium | Optional startup configuration, explicit unavailable summary, fake provider tests, live acceptance deferred |

### External prerequisite

Implementation and automated verification do not require a real Telegram credential. Live acceptance and production webhook registration require an operator-created AutoSale bot token, bot username, and independently generated webhook secret supplied through `.env`, never committed.
