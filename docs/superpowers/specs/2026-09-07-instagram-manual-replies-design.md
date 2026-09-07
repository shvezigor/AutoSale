# Instagram manual replies — design

**Date:** 7 September 2026  
**Status:** Approved in conversation; awaiting written-spec review

## Goal

Allow an AutoSale owner or manager to send text replies from an Instagram conversation. A reply must appear immediately in the dialogue, survive process restarts, expose a clear delivery state, and never be duplicated by a repeated browser request, worker retry, or Meta echo webhook.

The first version supports text messages only. Attachments, templates, automated replies, and WebSocket delivery are outside this scope.

## User experience

The existing disabled composer becomes an accessible text form. It accepts non-empty text up to 1,000 characters and disables submission while the request is being accepted. After submission, the outgoing bubble appears immediately with `Надсилається…`.

While a message is `PENDING` or `SENDING`, the conversation client polls only that conversation about every two seconds. Polling stops when no transient message remains or after a bounded timeout. A successful message shows `Надіслано`. A terminal failure shows `Не вдалося надіслати` and a `Повторити` action.

If the tenant has no active Instagram connection, or its credential is expired or revoked, the composer is disabled. The page explains the reason and links an owner to the Instagram settings flow. A manager sees the same safe status without access to credentials or owner-only configuration.

## Architecture

The durable PostgreSQL message record is the outbox. The request flow is:

1. The client creates a random idempotency key and submits the message text.
2. The NestJS API authorizes the tenant membership, verifies the tenant-bound conversation and active Instagram connection, and creates one `OUTBOUND` message with status `PENDING`.
3. A BullMQ dispatch wakes the worker. If Redis dispatch fails after the database commit, the worker's periodic outbox scan still discovers the pending record.
4. The worker claims the record atomically as `SENDING`, decrypts the tenant credential server-side, and calls the Meta Instagram Send API.
5. The worker records `SENT` plus the provider message ID, or records a sanitized failure and retry metadata.
6. The client polling response updates the existing bubble without remounting the workspace page.
7. A later Meta echo webhook reconciles with the local outbound message and does not create a second message.

Only the API and worker can access encrypted Instagram credentials. Access tokens, provider response bodies, and customer message text are excluded from structured logs.

## Data model

Add an outbound delivery state with these values:

- `PENDING`: durably accepted and waiting for a worker;
- `SENDING`: leased by a worker;
- `SENT`: Meta accepted the message;
- `FAILED`: delivery reached a terminal or user-actionable failure.

Message records gain nullable outbound-only fields:

- `clientIdempotencyKey` — unique inside the tenant;
- `providerMessageId` — Meta's message identifier when accepted;
- `deliveryStatus`;
- `deliveryAttempts`;
- `deliveryLeaseId` and `deliveryLeaseExpiresAt`;
- `nextDeliveryAttemptAt`;
- `lastDeliveryAttemptAt`;
- `deliveryErrorCode` — a controlled internal code, never raw provider text.

Inbound messages retain no artificial delivery status. Database uniqueness covers the existing external message identity and the new tenant/client idempotency key. The conversation's `lastMessageAt` is updated when the outgoing message is accepted locally.

## API contract

`POST /api/conversations/:conversationId/messages`

- membership: owner or manager in the current tenant;
- CSRF required;
- body: `{ text, idempotencyKey }`;
- validates trimmed text length `1..1000`;
- returns the existing message when the same tenant and idempotency key are replayed;
- returns the created message with `PENDING` status otherwise;
- does not accept tenant IDs, credentials, sender IDs, or provider IDs from the browser.

`POST /api/conversations/:conversationId/messages/:messageId/retry`

- membership and CSRF requirements match message creation;
- permits only a tenant-bound outbound message in `FAILED`;
- resets controlled retry fields and returns `PENDING`;
- repeated retry clicks are idempotent and cannot create a new row.

The existing conversation detail response includes outbound delivery status, retry availability, and a safe localized error code. It never returns credential data or raw Meta failures.

## Meta adapter

Extend the existing `MetaInstagramClient` with a narrow text-send method. It sends a bearer token in the authorization header and the recipient participant ID plus text in the documented request body. The adapter validates the response and exposes only normalized success metadata or a sanitized `MetaInstagramError`.

Transient provider and transport failures are retried with bounded exponential backoff. Authentication or permission failures are terminal for the message and mark the tenant connection as requiring reconnection. Other permanent request failures become `FAILED` without deleting the local conversation or message.

## Echo reconciliation and order triggers

Meta echo webhooks continue through the verified webhook ingestion pipeline. Reconciliation first uses the provider message ID. Where Meta does not return a usable correlation identifier, it uses a narrowly bounded tenant, conversation, direction, normalized text, and timestamp match. A matched echo updates the local message instead of inserting another one.

The existing confirmed-order phrase detector runs once against the canonical outbound message. A confirmation reply sent from AutoSale can therefore start order recognition, while the later echo replay is deduplicated by the same event/message constraints.

## Recovery and concurrency

Workers acquire a database lease before sending. An expired lease is recoverable after a worker crash. A periodic outbox scan queues eligible `PENDING` records and expired `SENDING` records, so PostgreSQL remains the source of truth and a Redis outage cannot strand accepted messages.

The worker reconciles known provider identifiers before a retry where possible. Retry attempts update the same row. The client idempotency key protects browser retries; provider and webhook uniqueness protect callback replay.

## Security and privacy

- Every read and mutation is constrained by the authenticated principal's tenant.
- CSRF protection is mandatory for send and retry mutations.
- The browser never supplies or receives Instagram access tokens.
- Logs contain request/message IDs, state transitions, latency, and controlled error codes, but not message text, tokens, or raw provider payloads.
- The existing connection cipher decrypts credentials only at the worker call boundary.
- Rate limiting applies per tenant and user to prevent accidental or abusive message bursts.

## Testing and acceptance

Automated tests cover:

- shared request and response contracts;
- controller membership, CSRF, validation, and tenant isolation;
- service idempotency and inactive-connection rejection;
- Meta adapter request shape and sanitized errors;
- worker claiming, success, transient retry, terminal failure, expired lease recovery, and duplicate-job safety;
- webhook echo reconciliation and exactly-once trigger behavior;
- composer validation, optimistic bubble, polling, sent/failed states, retry, and inactive-connection UX;
- production builds and database migration safety.

Browser acceptance uses a fixture connection first. Real Meta acceptance is completed after the Meta application grants the required messaging role and permissions: send one reply from AutoSale, observe it once in Instagram and once in AutoSale, then send the configured confirmation phrase and verify one order-recognition run.

