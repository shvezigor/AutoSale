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
- **AI boundary:** provider adapter returning a versioned JSON schema. AI proposes extracted facts and candidates; it cannot invent or directly persist a SKU.
- **Instagram boundary:** official Meta APIs only. Raw webhook payloads are retained for replay and audit.
- **Google Sheets boundary:** a dedicated adapter using the Google Sheets API. The MVP authenticates with a service account and grants it access only to the selected spreadsheet. OAuth can replace this adapter credential strategy later.
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
8. High-confidence, complete data becomes `READY`; ambiguity becomes `NEEDS_REVIEW`.
9. A manager approves or corrects the order in the web interface.
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
- [ ] Google service account can access only the selected spreadsheet.
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
- [ ] Task 9: Extract a validated order draft with AI.
- [ ] Task 10: Match product candidates and calculate confidence.
- [ ] Task 11: Review, correct, and approve an order in the UI.

### Checkpoint: Reviewed order

- [ ] A representative conversation produces a reviewable order draft.
- [ ] Unknown or ambiguous products cannot be silently approved by AI.
- [ ] Manager corrections are audited.
- [ ] Extraction evaluations meet the agreed acceptance threshold.

### Phase 4: Third vertical slice — approved order to Google Sheets

- [ ] Task 12: Configure and validate a Google Sheets destination.
- [ ] Task 13: Synchronize approved orders idempotently.
- [ ] Task 14: Surface synchronization state and allow safe retry.

### Checkpoint: Google Sheets export

- [ ] Approval creates exactly one row with the expected mapping.
- [ ] Updating the order updates the existing row.
- [ ] API retries and job retries do not duplicate rows.
- [ ] A revoked credential produces an actionable error without losing the order.

### Phase 5: Operational readiness

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
| Trigger phrase produces false positives | High | Require conversation context, completeness checks, and manual approval in MVP. |
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
- Google spreadsheet ID, sheet/tab name, exact desired columns, and service-account sharing approval.
- Rules for incomplete customer phone, delivery data, multiple products, edits, and cancellations.
- Target deployment environment: Linux VPS requirements, domain, and backup destination.

## Definition of Done

The MVP is complete only when a real Instagram test conversation can be ingested, reviewed, approved, and reflected exactly once in Google Sheets; all state remains recoverable after container restart; external outages produce visible retryable failures; and the documented backup can restore the system on another Docker host.

