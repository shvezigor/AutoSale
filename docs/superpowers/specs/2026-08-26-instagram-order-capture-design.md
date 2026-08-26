# Instagram Order Capture — System Design

**Status:** Approved design captured for implementation review

**Date:** 2026-08-26
**Initial deployment:** One client, one Instagram Professional account, one Google spreadsheet

## 1. Objective

Build a portable, self-hosted service that converts confirmed Instagram conversations into reviewed sales orders and synchronizes approved orders to Google Sheets through the official API.

The first release optimizes for one client and a fast operational launch. Its boundaries remain tenant-aware so additional clients and channels can be added without replacing the order domain.

## 2. Success Criteria

The MVP succeeds when:

1. A real Instagram text or photo message is received through an official Meta webhook and appears once in the manager inbox.
2. A configured confirmation phrase starts order extraction using the relevant conversation context.
3. AI returns a schema-valid draft and can select only products present in the catalogue.
4. A manager can correct and approve uncertain or incomplete data.
5. An approved order creates or updates exactly one Google Sheets row identified by the internal `order_id`.
6. Restarts, duplicate webhooks, and transient external failures do not lose or duplicate orders.
7. The documented backup can restore the service on another Linux Docker host.

## 3. Scope

### Included

- Official Instagram API integration for an Instagram Professional account.
- Webhook verification, signature validation, normalization, deduplication, and replay-safe processing.
- Text and image message storage.
- Conversation inbox and order review interface.
- Configurable confirmation phrases.
- AI extraction of customer, product, quantity, and delivery data.
- Product catalogue with stable SKU, variants, aliases, and optional reference images.
- Candidate-based product matching with explicit confidence and manual review.
- Google Sheets API synchronization.
- Audit events, structured logging, background retries, health checks, and backup/restore instructions.
- Docker Compose deployment.

### Deferred

- Automatic replies to Instagram customers.
- Nova Poshta waybill creation.
- Telegram, Viber, TikTok, OLX, and other inbound channels.
- Public signup, billing, subscriptions, and self-service integrations.
- Multiple active tenants in the first user interface.

## 4. Chosen Approach

The system is a custom application. n8n is not part of the critical runtime.

The alternatives considered were:

- **n8n-only:** fastest initial automation, but weak as the owner of order state, deduplication, product matching, testing, and multi-tenant evolution.
- **Single-process custom application:** simpler deployment, but webhook response paths and slow AI/media work would compete in one runtime.
- **Custom API plus worker:** selected. It provides controlled domain logic while separating fast webhook intake from retryable background work.

## 5. Technology Stack

- **Language:** TypeScript across services and shared contracts.
- **Backend API:** NestJS.
- **Worker:** NestJS application context with BullMQ processors.
- **Frontend:** Next.js and React.
- **UI:** Tailwind CSS and shadcn/ui.
- **Database:** PostgreSQL.
- **Database toolkit:** Prisma with versioned migrations.
- **Queue:** Redis and BullMQ.
- **Object storage:** S3-compatible adapter, with MinIO in the default Docker deployment.
- **Reverse proxy/TLS:** Caddy.
- **AI:** provider adapter supporting image input and strict structured output.
- **Tests:** Vitest or Jest for unit/integration tests, Supertest for HTTP, and Playwright for browser flows.
- **Packaging:** pnpm workspace and Docker Compose.

## 6. Repository Structure

```text
apps/
  api/              HTTP API, Meta webhook, manager API
  worker/           queued media, AI, matching, and export jobs
  web/              manager interface
packages/
  contracts/        shared schemas and API contracts
  database/         Prisma schema and client
  integrations/     Instagram, Google Sheets, storage adapters
  ai/               extraction and product-ranking adapters
  config/           typed environment configuration
  observability/    logging, metrics, and correlation
infra/
  compose/          deployment configuration
  scripts/          backup, restore, and deployment helpers
```

Each package exposes a narrow interface. Domain services do not import Meta or Google client types directly.

## 7. Runtime Architecture

```text
Meta webhook
     |
     v
NestJS API -----> PostgreSQL
     |                 ^
     v                 |
Redis/BullMQ -----> Worker -----> AI provider
                       |  \
                       |   `----> Google Sheets API
                       `--------> MinIO/S3

Manager browser ----> Next.js ----> NestJS API
```

The API acknowledges valid webhook events quickly after durable event recording. All slow or retryable work occurs in the worker.

## 8. Domain Model

All business records carry `tenant_id`, even though the MVP configures one tenant.

### Principal entities

- `Tenant`: business boundary and integration ownership.
- `ChannelConnection`: Instagram account configuration and encrypted credential reference.
- `Conversation`: normalized external thread.
- `Message`: normalized inbound or outbound message.
- `Attachment`: controlled copy and original metadata for a message asset.
- `WebhookEvent`: raw verified event, processing status, and deduplication identity.
- `Product`: canonical catalogue item with stable SKU.
- `ProductAlias`: known alternative or misspelled description.
- `CatalogueImport`: versioned source and validation result.
- `Order`: aggregate with explicit lifecycle state.
- `OrderItem`: extracted description, candidates, confirmed SKU, quantity, and confidence.
- `ReviewTask`: manager-visible ambiguity or missing-field work.
- `ExportAttempt`: destination, idempotency key, row identity, status, and error.
- `AuditEvent`: actor, action, old/new values, and correlation identity.

## 9. Order Lifecycle

```text
NEW
  -> EXTRACTING
  -> NEEDS_REVIEW | READY
  -> CONFIRMED
  -> EXPORT_PENDING
  -> EXPORTED
```

Exceptional states include `PRODUCT_NOT_FOUND`, `AWAITING_DATA`, `EXTRACTION_ERROR`, `EXPORT_ERROR`, and `CANCELLED`.

State transitions are performed by the order domain service. Queue processors request transitions; they do not update status fields directly.

## 10. Instagram Processing

1. Meta verifies the callback URL through the webhook challenge.
2. Incoming requests have their authenticity validated before processing.
3. A stable external event/message identity is used as a unique database key.
4. The raw payload and safe metadata are stored without access tokens.
5. The event is enqueued and the webhook returns promptly.
6. The worker normalizes conversation, sender, message, time, direction, and attachments.
7. Referenced media is downloaded immediately, checksummed, and copied to object storage.
8. Retry is safe because message and attachment identities are unique.

Only official Meta APIs are supported. Browser scraping and personal-account automation are outside the design.

## 11. Order Trigger and AI Extraction

A manager confirmation phrase is a trigger, not proof that all order data is correct.

The trigger service:

- normalizes configurable phrases;
- evaluates only manager-authored messages;
- stores the matched rule and evidence;
- creates at most one order draft per trigger message.

The extraction job receives a bounded conversation window and relevant images. It returns a versioned structured result containing:

- whether the conversation describes a confirmed order;
- extracted customer and delivery fields;
- one or more described order items;
- supporting message IDs for each material field;
- missing and ambiguous fields;
- extraction confidence.

Schema-invalid output becomes an extraction failure. It never becomes a ready order.

## 12. Product Matching

AI cannot invent or directly assign a SKU.

Matching occurs in this order:

1. Exact SKU or barcode.
2. Exact normalized alias.
3. Product name and variant filters.
4. Text similarity candidate retrieval.
5. Optional image/reference similarity.
6. Optional AI ranking of the retrieved candidate set only.

The matcher stores candidates, evidence, score components, algorithm version, and final confidence. Thresholds are configurable and calibrated against an anonymized evaluation set.

- High-confidence and complete: `READY`.
- Ambiguous: `NEEDS_REVIEW`.
- No credible candidate: `PRODUCT_NOT_FOUND`.

The MVP still requires manager approval before export, including high-confidence results.

## 13. Manager Interface

The first frontend contains:

- conversation inbox;
- conversation detail with text and images;
- order draft panel;
- highlighted missing or low-confidence fields;
- catalogue candidate selection;
- customer and delivery correction;
- approve/cancel actions;
- Google Sheets export status and safe retry.

Approval is blocked until required customer fields, at least one valid SKU, and positive quantities are present. Every correction and status change produces an audit event.

## 14. Google Sheets Integration

PostgreSQL is the system of record. Google Sheets is an operational projection for the sales team.

### Authentication

The MVP uses a Google service account. The client shares only the destination spreadsheet with that service-account email. Credentials are mounted as a secret and never stored in Git or baked into an image.

The adapter boundary supports replacing service-account authentication with per-tenant OAuth later.

### Synchronization behavior

- Configuration stores spreadsheet ID, tab name, and field mapping.
- Required headers are validated before activation and before writes when configuration changes.
- `order_id` is the stable external key.
- First synchronization appends a row and records its identity.
- Later synchronization updates the same order row.
- After an ambiguous timeout, the worker reconciles by `order_id` before writing again.
- Queue retries use exponential backoff and eventually enter a visible failed state.

Initial fields are `order_id`, timestamps, status, channel, conversation ID, customer name/phone, SKU, product name, quantity, delivery city/branch, manager note, and confidence. Client-specific columns are handled by configuration, not by the order domain.

## 15. API Boundaries

### Public callback

- Meta verification callback.
- Meta event callback with authenticity validation and strict size limits.

### Manager API

- List and view conversations.
- List and view orders/review tasks.
- Correct an order draft.
- Approve or cancel an order.
- View and retry a recoverable export.
- Validate catalogue and Google Sheets configuration.

The API publishes an OpenAPI document. Shared runtime schemas define request and response contracts; TypeScript types are generated or inferred from those schemas.

## 16. Reliability and Idempotency

The following unique identities are mandatory:

- Meta event/message external ID.
- Trigger message to order-draft relation.
- Media source identity and checksum.
- `(tenant_id, order_id, destination)` export identity.
- Queue job ID derived from the durable operation identity.

Database transactions guard aggregate state changes. External calls are never assumed to be exactly once; reconciliation makes them effectively idempotent.

## 17. Security and Privacy

- Verify webhook authenticity before accepting business data.
- Store secrets outside Git and container images.
- Encrypt integration credentials or store only references to a deployment secret store.
- Apply least-privilege Google spreadsheet sharing.
- Redact secrets, message contents, phone numbers, and AI payload data from ordinary logs.
- Restrict object access through authenticated application routes or short-lived signed URLs.
- Record administrative and manager mutations in the audit log.
- Define retention for raw webhook payloads, conversation data, attachments, and AI request evidence.

## 18. Error Handling

- Invalid webhook: reject without enqueueing.
- Duplicate webhook: return success without duplicating work.
- Media failure: retain message, show attachment failure, and retry.
- AI/provider failure: keep draft evidence and enter a retryable extraction error.
- Invalid AI schema: reject output and record the schema/prompt version.
- Unknown product: require manager resolution.
- Google permission/header failure: stop export with an actionable non-retryable error.
- Google quota/network failure: back off, retry, reconcile, and expose state.
- Worker restart: pending jobs resume from durable queue/database state.

## 19. Testing Strategy

- Unit tests for signatures, normalization, trigger rules, validation schemas, matching scores, mappings, state transitions, and idempotency keys.
- Integration tests using containerized PostgreSQL, Redis, and MinIO.
- Versioned fixtures for Meta webhooks and Google responses.
- AI evaluation dataset with anonymized representative conversations and field-level scoring.
- HTTP contract tests for manager endpoints.
- Playwright tests for conversation review, correction, approval, and export recovery.
- Staging acceptance test with real test Instagram and Google resources.
- Clean-host backup restoration test.

## 20. Deployment and Portability

The default topology uses Docker Compose services for Caddy, web, API, worker, PostgreSQL, Redis, and MinIO. Services use internal networking, health checks, pinned versions, non-root application users, and named volumes.

Deployment configuration is environment-driven. Database migrations run as an explicit release step before application rollout. Backups cover PostgreSQL and object storage, and restoration is verified on a second clean Docker host.

No provider-specific compute, database, queue, or storage feature is required for the MVP. A future migration can replace Compose services with managed PostgreSQL, Redis, or S3-compatible storage without changing domain contracts.

## 21. Implementation Sequence

1. Prove Meta webhook and restricted Google Sheets access.
2. Establish the containerized monorepo and configuration validation.
3. Deliver Instagram message ingestion through to the manager inbox.
4. Deliver conversation trigger through to a reviewed and approved order.
5. Deliver approved order synchronization to Google Sheets.
6. Add observability, backup/restore, and failure acceptance testing.

The detailed dependency-ordered checklist is maintained in `tasks/todo.md`.
