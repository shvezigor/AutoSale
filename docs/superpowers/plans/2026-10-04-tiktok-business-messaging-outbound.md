# TikTok Business Messaging Outbound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized Sales AITO manager send idempotent manual TikTok replies from the existing conversation screen when the connected account and current provider rules permit it.

**Architecture:** The conversation API accepts a provider-neutral manual reply and persists it before dispatch. A TikTok delivery adapter owns capability/window enforcement, token refresh, provider sending, typed retry classification, and reconciliation while reusing the existing message delivery state machine.

**Tech Stack:** TypeScript 5.9, NestJS 11, Prisma 7/PostgreSQL RLS, BullMQ 5, Next.js 16/React 19, Zod 4, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-10-04-tiktok-business-messaging-design.md`

## Global Constraints

- Slice A from `2026-10-04-tiktok-business-messaging-inbound.md` must be green first.
- Never hard-code Instagram's reply window for TikTok; enforce TikTok capability and current provider messaging limits.
- Persist accepted replies as `PENDING`; never show `SENT` before provider confirmation.
- Browser retry, API retry, worker redelivery, and reconciliation must not duplicate a provider send.
- Block outbound work when credentials are stale, tenant lifecycle is frozen, or the account capability does not permit the message type.
- Use the shared form-validation and button contracts and preserve typed, localized safe errors.
- Keep automatic and AI-authored replies out of this slice.

---

## File Structure

- `packages/contracts/src/conversations.ts`: provider-neutral TikTok reply reasons and delivery errors.
- `packages/integrations/src/tiktok-business-messaging.ts`: text send and provider-limit parsing.
- `apps/api/src/conversations/conversations.service.ts`: channel-aware acceptance, idempotency, and queue selection.
- `apps/worker/src/tiktok/tiktok-message-delivery.service.ts`: claim/send/settle TikTok replies.
- `apps/worker/src/tiktok/tiktok-message-reconciler.ts`: safely recover pending/unknown attempts.
- `apps/web/src/components/social-reply-composer.tsx`: Instagram/TikTok manual composer selected by conversation capability.

### Task 1: Extend reply and delivery contracts for TikTok

**Files:**
- Modify: `packages/contracts/src/conversations.ts`
- Modify: `packages/contracts/src/conversations.spec.ts`

**Interfaces:**
- Produces reply reasons `TIKTOK_CAPABILITY_UNAVAILABLE` and `TIKTOK_REPLY_NOT_PERMITTED`.
- Produces delivery errors `TIKTOK_RECONNECT_REQUIRED`, `TIKTOK_RATE_LIMITED`, `TIKTOK_SEND_FAILED`, `TIKTOK_DELIVERY_UNKNOWN`, and `TIKTOK_REPLY_NOT_PERMITTED`.

- [x] **Step 1: Write failing schema tests**

```ts
expect(replyCapabilitySchema.parse({
  enabled: false,
  reason: 'TIKTOK_CAPABILITY_UNAVAILABLE',
})).toEqual({ enabled: false, reason: 'TIKTOK_CAPABILITY_UNAVAILABLE' });
expect(outboundDeliverySchema.parse({
  status: 'FAILED', attempts: 1, errorCode: 'TIKTOK_RATE_LIMITED', retryAllowed: true,
}).errorCode).toBe('TIKTOK_RATE_LIMITED');
```

- [x] **Step 2: Run the contract test and verify failure**

Run: `pnpm --filter @autosale/contracts test -- conversations.spec.ts`
Expected: FAIL because TikTok reply codes are rejected.

- [x] **Step 3: Add the explicit union members without weakening schemas**

Do not replace enums with arbitrary strings. Preserve all Instagram error values unchanged.

- [x] **Step 4: Run the contract test**

Run: `pnpm --filter @autosale/contracts test -- conversations.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit contract changes**

```bash
git add packages/contracts/src/conversations.ts packages/contracts/src/conversations.spec.ts
git commit -m "feat: add TikTok reply delivery contracts"
```

### Task 2: Add TikTok send-message capability to the provider client

**Files:**
- Modify: `packages/integrations/src/tiktok-business-messaging.ts`
- Modify: `packages/integrations/src/tiktok-business-messaging.spec.ts`

**Interfaces:**
- Produces `sendText(input: { accessToken: string; accountId: string; conversationId: string; text: string }): Promise<{ messageId: string }>`.
- Produces typed retryability for rate limit, auth failure, permanent policy/capability rejection, timeout, and ambiguous response.

- [x] **Step 1: Write failing send tests**

```ts
await expect(client.sendText({
  accessToken: 'fictional-token',
  accountId: 'fictional-business-account',
  conversationId: 'fictional-conversation',
  text: 'Дякуємо, замовлення прийнято.',
})).resolves.toEqual({ messageId: 'fictional-provider-message' });
```

Assert authorization headers, strict response parsing, request timeout, provider request ID capture, 429 retryability, expired-token classification, permanent permission rejection, and ambiguous 5xx/network outcomes.

- [x] **Step 2: Run the client test and verify failure**

Run: `pnpm --filter @autosale/integrations test -- tiktok-business-messaging.spec.ts`
Expected: FAIL because `sendText` does not exist.

- [x] **Step 3: Implement the send boundary**

Use the official `POST /business/message/send/` conversation request shape available to the approved app. Send only text in this slice, cap input at the public contract's 1000 characters, and never log the token or message body. TikTok does not accept the Sales AITO idempotency key; keep that key at the API/persistence boundary and never automatically repeat an ambiguous provider send. Return only the provider message ID.

- [x] **Step 4: Run the client test**

Run: `pnpm --filter @autosale/integrations test -- tiktok-business-messaging.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit provider sending**

```bash
git add packages/integrations/src/tiktok-business-messaging.ts packages/integrations/src/tiktok-business-messaging.spec.ts
git commit -m "feat: send TikTok conversation replies"
```

### Task 3: Accept channel-aware manual replies in the conversation API

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/*_tiktok_outbound_generation/migration.sql`
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/api/src/conversations/conversations.module.ts`
- Modify: `apps/api/src/conversations/conversations.controller.spec.ts`

**Interfaces:**
- Consumes existing `POST /api/conversations/:id/messages` and retry route without adding a TikTok-only controller.
- Produces queue job `tiktok.message.send` for TikTok conversations and retains `instagram.message.send` for Instagram.

- [x] **Step 1: Write failing API tests for capability, idempotency, and routing**

```ts
const reply = await service.send(tenantId, managerId, tikTokConversationId, {
  text: 'Ваше замовлення прийнято.',
  idempotencyKey,
});
expect(reply.delivery?.status).toBe('PENDING');
expect(queue.add).toHaveBeenCalledWith(
  'tiktok.message.send',
  { tenantId, messageId: reply.id },
  expect.objectContaining({ jobId: reply.id }),
);
```

Test inbound-only disabled capability, missing/non-refreshable credentials, forbidden tenant, lifecycle freeze, duplicate same input returning one message, idempotency-key conflict, per-actor acceptance rate limit, and TikTok-specific retry eligibility.

- [x] **Step 2: Run focused API tests and verify failure**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts conversations.controller.spec.ts`
Expected: FAIL because send/retry currently accepts only Instagram.

- [x] **Step 3: Implement exhaustive channel strategy selection**

Load the connection appropriate to `conversation.channel`. For TikTok require `status = ACTIVE`, encrypted access and refresh credentials, a non-expired refresh token, a current credential generation, and capability `sendText = true`; the worker refreshes a short-lived access token when necessary. Persist `channel: 'TIKTOK'`, sender external account ID, credential generation, local external message ID, idempotency key, actor, `PENDING`, and next attempt in the same tenant transaction. Enqueue only after commit.

- [x] **Step 4: Run focused API tests**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts conversations.controller.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit API acceptance**

```bash
git add apps/api/src/conversations
git commit -m "feat: accept idempotent TikTok manual replies"
```

### Task 4: Deliver and reconcile TikTok replies durably

**Files:**
- Create: `apps/worker/src/tiktok/tiktok-message-delivery.service.ts`
- Create: `apps/worker/src/tiktok/tiktok-message-delivery.service.spec.ts`
- Create: `apps/worker/src/tiktok/tiktok-message-reconciler.ts`
- Create: `apps/worker/src/tiktok/tiktok-message-reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes `tiktok.message.send` jobs `{ tenantId, messageId }`.
- Produces delivery transitions `PENDING -> SENDING -> SENT|FAILED|UNKNOWN` and provider message ID.
- Produces reconciliation wakeups with the original `messageId` job ID.

- [ ] **Step 1: Write failing delivery state-machine tests**

```ts
await delivery.process({ tenantId, messageId });
expect(client.sendText).toHaveBeenCalledTimes(1);
expect(await prisma.message.findUnique({ where: { id: messageId } })).toMatchObject({
  deliveryStatus: 'SENT',
  providerMessageId: 'fictional-provider-message',
  deliveryErrorCode: null,
});
```

Cover duplicate worker delivery, active lease exclusion, stale credential generation, token refresh serialization, 429 safe retry, permanent permission failure, ambiguous timeout to `UNKNOWN`, tenant freeze, crash after provider acceptance, and reconciliation without duplicate send.

- [ ] **Step 2: Run focused worker tests and verify failure**

Run: `pnpm --filter @autosale/worker test -- tiktok-message-delivery.service.spec.ts tiktok-message-reconciler.spec.ts`
Expected: FAIL because the delivery service is missing.

- [ ] **Step 3: Implement claim/send/settle and reconciliation**

Claim by tenant, message ID, `channel = TIKTOK`, current status, and expired/no lease. Decrypt only inside the worker operation. Recheck connection generation and capability immediately before sending. Map typed client failures to the contract error enum. Retry only when another send cannot duplicate an unknown provider result; otherwise reconcile or require manager action.

- [ ] **Step 4: Run focused worker tests**

Run: `pnpm --filter @autosale/worker test -- tiktok-message-delivery.service.spec.ts tiktok-message-reconciler.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit durable outbound delivery**

```bash
git add apps/worker/src/tiktok apps/worker/src/main.ts
git commit -m "feat: deliver and reconcile TikTok replies"
```

### Task 5: Generalize the conversation reply UI

**Files:**
- Create: `apps/web/src/components/social-reply-composer.tsx`
- Create: `apps/web/src/components/social-reply-composer.spec.tsx`
- Modify: `apps/web/src/components/instagram-reply-composer.tsx`
- Modify: `apps/web/src/components/message-thread.tsx`
- Modify: `apps/web/src/components/message-thread.spec.tsx`
- Modify: `apps/web/app/(workspace)/conversations/[id]/page.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/src/i18n/completeness.spec.ts`

**Interfaces:**
- Consumes `ConversationDetailResponse.replyCapability` and existing send/retry API.
- Produces one channel-aware composer for Instagram and TikTok while Facebook remains read-only.

- [ ] **Step 1: Write failing TikTok composer tests**

```tsx
render(<SocialReplyComposer conversation={tikTokConversation} />);
await user.type(screen.getByRole('textbox'), 'Ваше замовлення прийнято.');
await user.click(screen.getByRole('button', { name: /Надіслати/i }));
expect(fetchMock).toHaveBeenCalledWith(
  `/api/conversations/${tikTokConversation.id}/messages`,
  expect.objectContaining({ method: 'POST' }),
);
```

Test `LoadingButton`, generated UUID idempotency key reused after uncertain browser failure, disabled inbound-only reason, reconnect reason, pending/sent/failed rendering, safe retry visibility, Ukrainian/English copy, keyboard submission, and 390 px layout.

- [ ] **Step 2: Run focused web tests and verify failure**

Run: `pnpm --filter @autosale/web test -- social-reply-composer.spec.tsx message-thread.spec.tsx completeness.spec.ts`
Expected: FAIL because TikTok is rendered read-only.

- [ ] **Step 3: Extract the shared composer and add TikTok copy**

Retain `instagram-reply-composer.tsx` as a compatibility export or migrate all imports in the same commit. Use shared button classes only. Keep form-level provider/permission/outage errors and preserve typed text after a failed send.

- [ ] **Step 4: Run focused web tests**

Run: `pnpm --filter @autosale/web test -- social-reply-composer.spec.tsx message-thread.spec.tsx completeness.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit reply UI**

```bash
git add apps/web
git commit -m "feat: reply to TikTok conversations"
```

### Task 6: Verify outbound acceptance and update canonical status

**Files:**
- Create: `tests/e2e/tiktok-business-messaging-outbound.spec.ts`
- Modify: `docs/integrations/tiktok-business-messaging.md`
- Modify: `docs/acceptance/tiktok-business-messaging-checklist.md`
- Modify: `docs/features/README.md`
- Modify: `docs/superpowers/specs/2026-10-04-tiktok-business-messaging-design.md`
- Modify: `docs/acceptance/mvp-checklist.md`

**Interfaces:**
- Produces automated evidence for exactly-once manual text replies.
- Keeps feature status `Validation pending` until a real eligible account delivers one reply.

- [ ] **Step 1: Write failing outbound E2E**

```ts
test('manager sends one TikTok reply despite browser retry', async ({ page }) => {
  await openFictionalTikTokConversation(page);
  await page.getByRole('textbox').fill('Ваше замовлення прийнято.');
  await page.getByRole('button', { name: 'Надіслати' }).dblclick();
  await expect(page.getByText('Надіслано')).toHaveCount(1);
  expect(await fictionalTikTokProvider.sentMessageCount()).toBe(1);
});
```

- [ ] **Step 2: Run the E2E and verify failure before final wiring**

Run: `pnpm exec playwright test tests/e2e/tiktok-business-messaging-outbound.spec.ts`
Expected: FAIL until the provider harness and delivery polling are complete.

- [ ] **Step 3: Complete the harness and document live acceptance**

Document the controlled live test: incoming customer DM, enabled composer, one manual text reply, provider receipt, delivery state, retry behavior, token redaction, and account capability evidence. Document rollback by disabling `TIKTOK_BUSINESS_MESSAGING_ENABLED` in API and worker.

- [ ] **Step 4: Run complete verification**

Run: `pnpm --filter @autosale/database generate && pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test tests/e2e/tiktok-business-messaging-inbound.spec.ts tests/e2e/tiktok-business-messaging-outbound.spec.ts tests/e2e/instagram-manual-replies.spec.ts tests/e2e/conversation-inbox.spec.ts && git diff --check`
Expected: all commands PASS; real TikTok delivery remains the only provider acceptance gate.

- [ ] **Step 5: Commit Slice B completion**

```bash
git add docs tests/e2e
git commit -m "docs: add TikTok reply rollout and acceptance"
```

