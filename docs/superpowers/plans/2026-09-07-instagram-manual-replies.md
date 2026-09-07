# Instagram Manual Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tenant owners and managers send reliable, visible, retry-safe Instagram text replies from an AutoSale conversation.

**Architecture:** PostgreSQL `Message` rows form a durable outbox. NestJS accepts an idempotent outbound message, BullMQ wakes a worker, a periodic reconciler recovers missed jobs and expired leases, and the worker calls Meta through the existing encrypted tenant credential. Next.js renders an optimistic outbound bubble and polls only while delivery is transient.

**Tech Stack:** TypeScript 5.9, NestJS 11, Next.js 16/React 19, Prisma 7/PostgreSQL 17, BullMQ/Redis, Meta Instagram Send API, Zod, Vitest, Testing Library, Testcontainers, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-07-instagram-manual-replies-design.md`

## Global Constraints

- First version sends text only; attachments, templates, automated replies, and WebSockets are excluded.
- Text is trimmed and must contain 1–1,000 characters.
- Owners and managers may send; all reads and writes remain tenant-scoped and mutations require CSRF.
- The browser never supplies or receives tenant IDs, sender IDs, provider IDs, or Instagram credentials.
- Logs must not contain access tokens, raw Meta payloads, or customer message text.
- Every production change follows red-green TDD and ends with a focused commit.
- Meta Instagram Login send shape is `POST https://graph.instagram.com/{version}/me/messages` with bearer authorization and JSON `{ recipient: { id }, message: { text } }`; validate `recipient_id` and `message_id` from the response.
- Meta does not document provider-side idempotency for this endpoint: timeout and ambiguous `5xx` outcomes become `UNKNOWN` and are never retried automatically.

---

### Task 1: Define reply and delivery contracts

**Files:**
- Modify: `packages/contracts/src/conversations.ts`
- Modify: `packages/contracts/src/conversations.spec.ts`
- Modify: `packages/contracts/src/index.ts` only if the conversations module is not already exported

**Interfaces:**
- Produces: `outboundMessageInputSchema`, `retryOutboundMessageInputSchema`, `conversationMessageSchema` delivery fields, `replyCapabilitySchema`.
- Produces: `OutboundMessageInput`, `ConversationMessage`, `ReplyCapability` inferred types.
- Consumes: existing Zod conversation list/detail contracts.

- [x] **Step 1: Write failing contract tests**

Add tests that parse a pending outbound message and reject blank, oversized, and malformed-idempotency inputs:

```ts
const pending = conversationMessageSchema.parse({
  id: '11111111-1111-4111-8111-111111111111',
  direction: 'OUTBOUND', senderId: 'shop', text: 'Доброго дня!',
  sourceTimestamp: '2026-09-07T12:00:00.000Z', attachments: [],
  delivery: { status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false },
});
expect(pending.delivery?.status).toBe('PENDING');

expect(() => outboundMessageInputSchema.parse({ text: '   ', idempotencyKey: crypto.randomUUID() })).toThrow();
expect(() => outboundMessageInputSchema.parse({ text: 'x'.repeat(1001), idempotencyKey: crypto.randomUUID() })).toThrow();
```

Also require detail responses to contain:

```ts
replyCapability: { enabled: true, reason: null }
```

- [x] **Step 2: Run the contract tests and verify red**

Run: `pnpm --filter @autosale/contracts exec vitest run src/conversations.spec.ts`

Expected: FAIL because reply schemas and delivery fields do not exist.

- [x] **Step 3: Add strict Zod schemas**

Implement these shapes:

```ts
export const outboundDeliverySchema = z.object({
  status: z.enum(['PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN']),
  attempts: z.number().int().min(0),
  errorCode: z.enum(['INSTAGRAM_RECONNECT_REQUIRED', 'INSTAGRAM_RATE_LIMITED', 'INSTAGRAM_SEND_FAILED', 'INSTAGRAM_DELIVERY_UNKNOWN']).nullable(),
  retryAllowed: z.boolean(),
});

export const outboundMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().uuid(),
});

export const replyCapabilitySchema = z.object({
  enabled: z.boolean(),
  reason: z.enum(['NOT_CONNECTED', 'RECONNECT_REQUIRED']).nullable(),
});
```

Add `delivery: outboundDeliverySchema.nullable()` to each message and `replyCapability` to detail.

- [x] **Step 4: Run focused and package tests**

Run: `pnpm --filter @autosale/contracts test && pnpm --filter @autosale/contracts typecheck`

Expected: all contract tests pass and TypeScript reports no error.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/conversations.ts packages/contracts/src/conversations.spec.ts packages/contracts/src/index.ts
git commit -m "feat: define Instagram reply contracts"
```

---

### Task 2: Add the durable outbound-message schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260907160000_instagram_outbound_messages/migration.sql`
- Create: `packages/database/src/instagram-outbound-messages.postgres.spec.ts`
- Regenerate: `packages/database/src/generated/**`

**Interfaces:**
- Consumes: Task 1 delivery-state names.
- Produces: Prisma `OutboundDeliveryStatus`; nullable outbound metadata on `Message`.
- Produces database constraints: unique `(tenant_id, client_idempotency_key)` where key is non-null and unique `(tenant_id, provider_message_id)` where provider ID is non-null.

- [x] **Step 1: Write a failing PostgreSQL migration test**

Use the existing Testcontainers migration runner pattern. Prove that a local outbound message can have no `rawEventId`, that duplicate client keys fail in one tenant, that the same key is allowed in another tenant, and that delivery metadata survives a read:

```ts
const created = await prisma.message.create({ data: {
  tenantId, conversationId, rawEventId: null, channel: 'INSTAGRAM',
  externalMessageId: `local:${crypto.randomUUID()}`, direction: 'OUTBOUND',
  senderId: 'shop-account', text: 'Вітаю', sourceTimestamp: new Date(),
  clientIdempotencyKey: key, deliveryStatus: 'PENDING',
}});
expect(created).toMatchObject({ rawEventId: null, deliveryStatus: 'PENDING', deliveryAttempts: 0 });
```

- [x] **Step 2: Run and verify red**

Run: `pnpm --filter @autosale/database exec vitest run src/instagram-outbound-messages.postgres.spec.ts`

Expected: FAIL because the migration and Prisma fields are absent.

- [x] **Step 3: Add enum, nullable relation, fields, indexes, and SQL guards**

Add:

```prisma
enum OutboundDeliveryStatus { PENDING SENDING SENT FAILED UNKNOWN }

model Message {
  rawEventId              String?                 @map("raw_event_id") @db.Uuid
  clientIdempotencyKey    String?                 @map("client_idempotency_key") @db.Uuid
  sentByUserId            String?                 @map("sent_by_user_id") @db.Uuid
  providerMessageId       String?                 @map("provider_message_id")
  deliveryStatus          OutboundDeliveryStatus? @map("delivery_status")
  deliveryAttempts        Int                     @default(0) @map("delivery_attempts")
  deliveryLeaseId         String?                 @map("delivery_lease_id") @db.Uuid
  deliveryLeaseExpiresAt  DateTime?               @map("delivery_lease_expires_at")
  nextDeliveryAttemptAt   DateTime?               @map("next_delivery_attempt_at")
  lastDeliveryAttemptAt   DateTime?               @map("last_delivery_attempt_at")
  deliveryErrorCode       String?                 @map("delivery_error_code")
  rawEvent                WebhookEvent?            @relation(fields: [rawEventId], references: [id], onDelete: Restrict)
  sentBy                  User?                    @relation("InstagramMessageSender", fields: [sentByUserId], references: [id], onDelete: SetNull)
  @@index([deliveryStatus, nextDeliveryAttemptAt])
}
```

Add `instagramMessagesSent Message[] @relation("InstagramMessageSender")` to `User`.

Use partial unique indexes in SQL for non-null client/provider identifiers. Add a check constraint requiring local delivery fields only on `OUTBOUND` records and `raw_event_id IS NULL` only when `client_idempotency_key IS NOT NULL`.

- [x] **Step 4: Regenerate Prisma and run database verification**

Run: `pnpm --filter @autosale/database generate && pnpm --filter @autosale/database test && pnpm --filter @autosale/database typecheck`

Expected: migration test and existing database tests pass.

- [x] **Step 5: Commit**

```bash
git add packages/database/prisma packages/database/src/generated packages/database/src/instagram-outbound-messages.postgres.spec.ts
git commit -m "feat: persist Instagram outbound delivery state"
```

---

### Task 3: Add a sanitized Meta text-send adapter

**Files:**
- Modify: `packages/integrations/src/meta-instagram.ts`
- Modify: `packages/integrations/src/meta-instagram.spec.ts`
- Modify: `packages/integrations/src/index.ts` if the new result type needs export

**Interfaces:**
- Produces: `MetaInstagramClient.sendText(recipientId: string, text: string, accessToken: string): Promise<{ recipientId: string; messageId: string }>`.
- Consumes: existing `MetaInstagramError`, bearer-token request helper, graph version configuration.

- [x] **Step 1: Write failing adapter tests**

Cover the exact request and sanitized failures:

```ts
await expect(client.sendText('ig-customer-1', 'Вітаю', 'secret-token')).resolves.toEqual({
  recipientId: 'ig-customer-1', messageId: 'mid.123',
});
expect(fetchFn).toHaveBeenCalledWith(
  'https://graph.instagram.com/v24.0/me/messages',
  expect.objectContaining({
    method: 'POST',
    headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' },
    body: JSON.stringify({ recipient: { id: 'ig-customer-1' }, message: { text: 'Вітаю' } }),
  }),
);
```

Add cases for invalid participant ID before fetch, malformed 200 response, 190 invalid-token response, transient response, timeout, and assertions that neither token nor provider text appears in the thrown error.

- [x] **Step 2: Run and verify red**

Run: `pnpm --filter @autosale/integrations exec vitest run src/meta-instagram.spec.ts`

Expected: FAIL because `sendText` is missing.

- [x] **Step 3: Implement the smallest adapter method**

Validate participant IDs with the existing allowlist. POST JSON to `me/messages`; accept only a non-empty string `recipient_id` and `message_id`; otherwise throw `MetaInstagramError` with a new response stage `SEND` and no raw body.

- [x] **Step 4: Run integration package checks**

Run: `pnpm --filter @autosale/integrations test && pnpm --filter @autosale/integrations typecheck`

Expected: all tests pass.

- [x] **Step 5: Commit**

```bash
git add packages/integrations/src/meta-instagram.ts packages/integrations/src/meta-instagram.spec.ts packages/integrations/src/index.ts
git commit -m "feat: send Instagram text messages"
```

---

### Task 4: Accept tenant-safe idempotent replies in the API

**Files:**
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/api/src/conversations/conversations.controller.ts`
- Modify: `apps/api/src/conversations/conversations.controller.spec.ts`
- Modify: `apps/api/src/conversations/conversations.module.ts`
- Modify: `apps/api/src/queue/queue.module.ts`

**Interfaces:**
- Consumes: `OutboundMessageInput`; Prisma outbound fields; existing authenticated principal and global CSRF guard.
- Produces: `ConversationsService.send(tenantId, actorUserId, conversationId, input)` and `retry(tenantId, actorUserId, conversationId, messageId)`.
- Produces queue job `instagram.message.send` with `{ tenantId, messageId }` and `jobId: messageId`.

- [x] **Step 1: Write failing service tests**

Test active connection creation, replay, tenant isolation, inactive connection, rate limit, and retry state:

```ts
const first = await service.send('tenant-1', 'user-1', conversationId, { text: ' Вітаю ', idempotencyKey });
const replay = await service.send('tenant-1', 'user-1', conversationId, { text: 'Вітаю', idempotencyKey });
expect(first.id).toBe(replay.id);
expect(prisma.message.count({ where: { tenantId: 'tenant-1', clientIdempotencyKey: idempotencyKey } })).resolves.toBe(1);
expect(queue.add).toHaveBeenCalledWith('instagram.message.send', { tenantId: 'tenant-1', messageId: first.id }, expect.objectContaining({ jobId: first.id }));
```

Set the initial limit to 30 accepted replies per user/tenant rolling minute. A queue-add rejection must not roll back the durable message and must not expose Redis details.

- [x] **Step 2: Run focused service tests and verify red**

Run: `pnpm --filter @autosale/api exec vitest run src/conversations/conversations.service.spec.ts`

Expected: FAIL because send/retry do not exist.

- [x] **Step 3: Implement service methods and response mapping**

Inside a Prisma transaction: find `{ id, tenantId, channel: 'INSTAGRAM' }`, verify an `ACTIVE` tenant connection with non-expired credential, enforce the rolling limit, and upsert/find by tenant/client key. Create:

```ts
{
  rawEventId: null,
  externalMessageId: `local:${messageId}`,
  direction: 'OUTBOUND',
  senderId: connection.externalAccountId,
  text: input.text.trim(),
  deliveryStatus: 'PENDING',
  nextDeliveryAttemptAt: now,
}
```

Update conversation activity in the same transaction. After commit, call `queue.add`; catch and record only a structured safe metric/log entry because the periodic worker reconciler provides recovery.

Map `replyCapability` from the tenant connection and map message delivery with `retryAllowed` true only when status is `FAILED`, error code is `INSTAGRAM_RATE_LIMITED`, and the connection is active. The retry service enforces the same predicate server-side.

- [x] **Step 4: Write failing controller tests**

Add authenticated POST tests for manager and owner, missing/invalid CSRF, invalid body, cross-tenant ID, and retry. Validate each response with the shared schema and assert OpenAPI contains both routes.

- [x] **Step 5: Implement controller endpoints and queue wiring**

Parse bodies with `outboundMessageInputSchema`. Add:

```ts
@Post(':id/messages')
send(@CurrentPrincipal() principal, @Param('id', uuidPipe) id, @Body() raw) {
  return this.conversations.send(principal.tenantId!, principal.userId, id, outboundMessageInputSchema.parse(raw));
}

@Post(':id/messages/:messageId/retry')
retry(@CurrentPrincipal() principal, @Param('id', uuidPipe) id, @Param('messageId', uuidPipe) messageId) {
  return this.conversations.retry(principal.tenantId!, principal.userId, id, messageId);
}
```

Export the existing Instagram queue under a neutral token or add `INSTAGRAM_QUEUE` while preserving `INSTAGRAM_NORMALIZE_QUEUE` compatibility. Import `QueueModule.register(env.REDIS_URL)` in `ConversationsModule`. Every send/retry job uses `{ jobId: message.id, attempts: 1, removeOnComplete: true, removeOnFail: true }`; database state owns retries and removing the completed wake-up job permits a later safe manual retry of the same message.

- [x] **Step 6: Run API conversation checks**

Run: `pnpm --filter @autosale/api exec vitest run src/conversations && pnpm --filter @autosale/api typecheck`

Expected: service and controller tests pass.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/conversations apps/api/src/queue/queue.module.ts
git commit -m "feat: accept idempotent Instagram replies"
```

---

### Task 5: Deliver and recover outbound messages in the worker

**Files:**
- Create: `apps/worker/src/instagram/instagram-message-delivery.service.ts`
- Create: `apps/worker/src/instagram/instagram-message-delivery.service.spec.ts`
- Create: `apps/worker/src/instagram/instagram-message-reconciler.ts`
- Create: `apps/worker/src/instagram/instagram-message-reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `MetaInstagramClient.sendText`, `CredentialCipher`, Prisma outbound state, and the existing `TriggeredOrderProcessor.processIfTriggered(messageId)`.
- Produces: `InstagramMessageDeliveryService.process({ tenantId, messageId }): Promise<'SENT' | 'RETRY' | 'FAILED' | 'UNKNOWN' | 'IGNORED'>`.
- Produces: `InstagramMessageReconciler.reconcile(): Promise<{ attempted: number; queued: number }>`.

- [x] **Step 1: Write failing delivery tests**

Cover atomic lease acquisition, tenant connection lookup, credential decryption at call time, success, invalid token, explicit rate-limit retry, ambiguous timeout/`5xx`, permanent failure, and competing workers. Assert logs/codes never include token or message text.

Use a 60-second lease and these normalized outcomes:

```ts
expect(await delivery.process({ tenantId, messageId })).toBe('SENT');
expect(await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).toMatchObject({
  deliveryStatus: 'SENT', providerMessageId: 'mid.123', deliveryLeaseId: null,
});
```

An explicit `429` rejection sets `PENDING`, increments attempts, and sets `nextDeliveryAttemptAt` using bounded delays `5s, 15s, 60s, 5m`. After five rejected attempts, store `FAILED` with `INSTAGRAM_RATE_LIMITED`. A transport timeout or Meta `5xx` stores `UNKNOWN` with `INSTAGRAM_DELIVERY_UNKNOWN` and no next attempt. No provider outcome is retried by BullMQ itself.

Meta code 190 or missing messaging permission stores `FAILED`, sets `INSTAGRAM_RECONNECT_REQUIRED`, and updates the same-generation connection to `REAUTH_REQUIRED` without touching a newer connection generation.

- [x] **Step 2: Run delivery test and verify red**

Run: `pnpm --filter @autosale/worker exec vitest run src/instagram/instagram-message-delivery.service.spec.ts`

Expected: FAIL because the delivery service is absent.

- [x] **Step 3: Implement the focused delivery service**

Claim with `updateMany` constrained to tenant, ID, eligible status/time, and absent/expired lease. Fetch the claimed row with its conversation and active connection, decrypt, send, then finalize only when `deliveryLeaseId` still equals the current lease. Convert `MetaInstagramError` fields into controlled error codes. After the fenced update reaches `SENT`, call `processIfTriggered(messageId)`; its existing database uniqueness remains the exactly-once guard.

- [x] **Step 4: Write and run failing reconciler tests**

The reconciler selects due `PENDING` and expired `SENDING` rows, at most 50 per pass, and enqueues each with `jobId: message.id`:

Run: `pnpm --filter @autosale/worker exec vitest run src/instagram/instagram-message-reconciler.spec.ts`

Expected: FAIL because the reconciler is absent.

- [x] **Step 5: Implement reconciliation and worker wiring**

Handle `instagram.message.send` before the normalizer branch in the existing `instagram` worker. Instantiate one delivery service with the existing Meta client/cipher configuration. Run reconciliation every five seconds, prevent overlapping passes, emit safe backlog/operation metrics, invoke once on startup, and close its timer during shutdown.

- [x] **Step 6: Run worker package verification**

Run: `pnpm --filter @autosale/worker test && pnpm --filter @autosale/worker typecheck`

Expected: all worker tests pass.

- [x] **Step 7: Commit**

```bash
git add apps/worker/src/instagram apps/worker/src/main.ts
git commit -m "feat: deliver Instagram replies durably"
```

---

### Task 6: Reconcile Meta echoes without duplicates

**Files:**
- Modify: `apps/worker/src/instagram/instagram.processor.ts`
- Modify: `apps/worker/src/instagram/instagram.processor.spec.ts`
- Modify: `apps/worker/src/instagram/instagram-normalizer.ts` only if extra echo correlation data is required
- Modify: `apps/worker/src/instagram/instagram-normalizer.spec.ts` if normalization changes

**Interfaces:**
- Consumes: local outbound `providerMessageId`, `clientIdempotencyKey`, and delivery state.
- Produces: one canonical `Message` row after a Meta echo; returns/uses `wasCreated: false` for reconciliation so order triggering remains exactly once.

- [x] **Step 1: Add failing PostgreSQL echo tests**

Seed a local `SENT` message with provider ID `mid.123`, then process an echo with `mid.123`. Assert message count stays one, `providerMessageId` remains `mid.123`, `rawEventId` is linked to the echo event, and the order trigger is not invoked twice.

Add the bounded fallback case: same tenant/conversation/direction/normalized text within 30 seconds reconciles only when exactly one candidate exists. Zero or multiple candidates create/use the ordinary webhook-unique row rather than guessing.

- [x] **Step 2: Run processor tests and verify red**

Run: `pnpm --filter @autosale/worker exec vitest run src/instagram/instagram.processor.spec.ts`

Expected: FAIL with duplicate outbound rows or uniqueness conflict.

- [x] **Step 3: Implement provider-first, unique-fallback reconciliation**

For outbound normalized events, inside the existing transaction:

1. find a tenant message by `providerMessageId === normalized.externalMessageId`;
2. otherwise query the narrow text/time window and accept it only when exactly one local outbound candidate exists;
3. update the canonical row to `SENT`, link `rawEventId`, clear delivery error/lease, and retain the provider ID;
4. only use the current createMany path when reconciliation found no unambiguous candidate.

Keep attachment behavior and inbound profile enrichment unchanged. Call `processIfTriggered` only when this canonical outbound content has not previously been evaluated; rely on the existing one-order-per-trigger constraint as the final guard.

- [x] **Step 4: Run Instagram processor and order-trigger regression suites**

Run: `pnpm --filter @autosale/worker exec vitest run src/instagram/instagram.processor.spec.ts src/instagram/instagram-normalizer.spec.ts src/orders/triggered-order.processor.spec.ts`

Expected: all tests pass and an AutoSale confirmation reply starts at most one draft.

- [x] **Step 5: Commit**

```bash
git add apps/worker/src/instagram
git commit -m "fix: reconcile Instagram reply echoes"
```

---

### Task 7: Build the optimistic reply composer

**Files:**
- Create: `apps/web/src/components/instagram-reply-composer.tsx`
- Create: `apps/web/src/components/instagram-reply-composer.spec.tsx`
- Modify: `apps/web/src/components/message-thread.tsx`
- Modify: `apps/web/src/components/message-thread.spec.tsx`
- Modify: `apps/web/src/api/conversations.ts`
- Modify: `apps/web/app/(workspace)/conversations/[id]/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 1 reply input/message/detail types; `mutatingFetch`; global `useToast`.
- Produces: `InstagramReplyComposer({ initialConversation })` owning the live message list and transient polling lifecycle.

- [ ] **Step 1: Write failing component tests**

Test:

- enabled composer submits trimmed text with a UUID and renders `Надсилається…`;
- Enter submits and Shift+Enter inserts a newline;
- blank/1,001-character values cannot submit;
- pending state polls every two seconds; `UNKNOWN` continues polling for a late echo, and polling stops after `SENT`, retryable/permanent `FAILED`, unmount, or 60 seconds;
- `FAILED` displays the safe message and retry button;
- `UNKNOWN` displays `Статус доставки невідомий`, waits for echo reconciliation, and never renders automatic retry;
- retry updates the same bubble instead of appending;
- inactive connection disables the field and renders the settings guidance appropriate to owner/manager copy;
- focus and `aria-live` behavior remain accessible.

Use fake timers for polling and return contract-valid JSON from fetch mocks.

- [ ] **Step 2: Run and verify red**

Run: `pnpm --filter @autosale/web exec vitest run src/components/instagram-reply-composer.spec.tsx src/components/message-thread.spec.tsx`

Expected: FAIL because the composer and delivery UI do not exist.

- [ ] **Step 3: Add client API mutations and composer state machine**

Implement `sendConversationMessage`, `retryConversationMessage`, and `getConversation` parsing every response with shared schemas. Generate the UUID with `crypto.randomUUID()` once per submit attempt and reuse it if the browser retries the same accepted operation.

Render the submitted response immediately. Poll by replacing messages keyed by message ID, never by appending an entire response. Show a success toast only on transition to `SENT` and a persistent error toast on `FAILED` while keeping the inline bubble status as the primary recovery control.

- [ ] **Step 4: Integrate without remounting the workspace shell**

Move the `MessageThread` and composer under the client component while the page remains a server component that supplies `initialConversation`. Replace the disabled placeholder. Style stable composer height, disabled state, character counter near the limit, delivery labels, and retry action for desktop and mobile. Respect `prefers-reduced-motion`.

- [ ] **Step 5: Run web verification**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web typecheck && pnpm --filter @autosale/web build`

Expected: all web tests, types, and production build pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src apps/web/app
git commit -m "feat: add Instagram reply composer"
```

---

### Task 8: Verify end-to-end recovery, documentation, and deployment

**Files:**
- Create: `tests/e2e/instagram-manual-replies.spec.ts`
- Modify: `tasks/todo.md`
- Modify: `README.md` or the existing operator runbook that documents Meta production checks

**Interfaces:**
- Consumes: complete API, worker, Meta adapter, and UI flow.
- Produces: executable fixture acceptance and documented real-Meta acceptance gate.

- [ ] **Step 1: Add a failing browser acceptance test**

Using authenticated fixture data and a stub Meta endpoint, verify: open conversation, send text, see pending, worker succeeds, see sent once after polling, reload and still see one message. Add a transient failure followed by retry and confirm the same message ID/bubble is reused.

- [ ] **Step 2: Run and verify red**

Run: `pnpm exec playwright test tests/e2e/instagram-manual-replies.spec.ts`

Expected: FAIL until the full stack fixture wiring supports outbound delivery.

- [ ] **Step 3: Complete fixture wiring and operational notes**

Document the required `instagram_business_manage_messages` permission, the Meta app review dependency, the customer-initiated conversation restriction, safe failure codes, and the real acceptance steps. Mark only automated criteria complete; keep real Meta checks open until the app role/permission gate is resolved.

- [ ] **Step 4: Run the full verification gate**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
docker compose --env-file .env build api worker web
```

Expected: zero test failures, zero type/build errors, no whitespace errors, and all three production images build.

- [ ] **Step 5: Deploy locally and verify health**

Run:

```bash
docker compose --env-file .env up -d --build api worker web
docker compose --env-file .env ps
```

Verify API and worker health inside their containers and `https://sales-aito.com/health/live` returns HTTP 200. Perform fixture browser acceptance on desktop and mobile widths.

- [ ] **Step 6: Commit and push**

```bash
git add tests/e2e tasks/todo.md README.md
git commit -m "test: verify Instagram manual replies"
git push origin master
```

- [ ] **Step 7: Record the external acceptance gate**

After Meta grants the required app role and messaging permission, send one real reply from AutoSale, verify it appears once in Instagram and AutoSale, then send the configured confirmation phrase and verify exactly one order-recognition run. Record sanitized IDs/statuses only—never tokens, raw payloads, or customer text.
