# TikTok Business Messaging Inbound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner connect one eligible TikTok Business Account and receive TikTok direct messages, media, and order candidates in the existing Sales AITO inbox.

**Architecture:** A dedicated TikTok OAuth/client/webhook adapter validates provider traffic and normalizes it into the existing provider-neutral social ingestion service. Tenant resolution, durable webhook registration, conversation persistence, attachment copying, and order triggering reuse existing boundaries rather than copying the Instagram pipeline.

**Tech Stack:** TypeScript 5.9, NestJS 11, Prisma 7/PostgreSQL RLS, BullMQ 5, Next.js 16/React 19, Zod 4, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-10-04-tiktok-business-messaging-design.md`

## Global Constraints

- Ship behind disabled-by-default `TIKTOK_BUSINESS_MESSAGING_ENABLED`.
- Never request or store a merchant TikTok password or expose access/refresh tokens to the browser.
- Keep TikTok OAuth, webhook verification, capabilities, and API parsing separate from Meta adapters.
- Route a webhook tenant only from an active external TikTok account mapping.
- Use the shared `NormalizedInboundMessage` and social ingestion service after provider normalization.
- Preserve links and visible unsupported-attachment fallbacks; never create an unexplained empty message.
- Use shared button variants and `LoadingButton`; follow the repository field-validation contract.
- Use only fictional provider fixtures and never commit credentials or production personal data.
- Do not claim provider availability before TikTok access, review, region eligibility, and live acceptance pass.

---

## File Structure

- `packages/contracts/src/tiktok.ts`: public connection, capability, status, and webhook-safe schemas.
- `packages/integrations/src/tiktok-business-messaging.ts`: strict TikTok HTTP client and typed failures.
- `packages/database/prisma/schema.prisma`: tenant-owned TikTok connection, OAuth attempt, and cleanup state.
- `apps/api/src/integrations/tiktok-*`: OAuth state, connection lifecycle, controllers, and dependency wiring.
- `apps/api/src/tiktok/tiktok-webhook.*`: raw-body verification, tenant resolution, durable event registration, and queue dispatch.
- `apps/worker/src/tiktok/tiktok-normalizer.ts`: provider payload to `NormalizedInboundMessage` conversion.
- `apps/worker/src/tiktok/tiktok.processor.ts`: TikTok event processing through shared ingestion.
- `apps/web/src/components/tiktok-settings-form.tsx`: owner actions and manager-safe summary.
- `apps/web/src/components/social-channel-hub.tsx`: collapsed TikTok channel row.
- `docs/integrations/tiktok-business-messaging.md`: operator setup, rollout, recovery, and live acceptance.

### Task 1: Add contracts and guarded configuration

**Files:**
- Create: `packages/contracts/src/tiktok.ts`
- Create: `packages/contracts/src/tiktok.spec.ts`
- Modify: `packages/contracts/src/conversations.ts`
- Modify: `packages/contracts/src/conversations.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Modify: `packages/config/src/worker-env.ts`
- Modify: `packages/config/src/worker-env.spec.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Modify: `packages/config/src/deployment-env.spec.ts`

**Interfaces:**
- Produces: `TikTokConnectionSummary`, `TikTokCapabilities`, and `socialChannelSchema` containing `TIKTOK`.
- Produces environment fields `TIKTOK_BUSINESS_MESSAGING_ENABLED`, `TIKTOK_CLIENT_ID`, and `TIKTOK_CLIENT_SECRET` in API and worker configuration, plus the provider-generated `TIKTOK_AUTHORIZATION_URL` in API configuration only.

- [ ] **Step 1: Write failing contract and environment tests**

```ts
expect(tikTokConnectionSummarySchema.parse({
  status: 'ACTIVE',
  accountId: 'fictional-tiktok-account',
  displayName: 'Fictional Shop',
  capabilities: { receiveMessages: true, sendText: false, sendImage: false },
  tokenExpiresAt: '2026-10-05T09:00:00.000Z',
  lastVerifiedAt: '2026-10-04T09:00:00.000Z',
  lastErrorCode: null,
  cleanupStatus: 'NONE',
})).toMatchObject({ status: 'ACTIVE' });
expect(socialChannelSchema.parse('TIKTOK')).toBe('TIKTOK');
expect(() => parseApiEnv({ ...baseEnv, TIKTOK_BUSINESS_MESSAGING_ENABLED: 'true' }))
  .toThrow(/TikTok Business Messaging requires/);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @autosale/contracts test -- tiktok.spec.ts conversations.spec.ts && pnpm --filter @autosale/config test -- api-env.spec.ts worker-env.spec.ts deployment-env.spec.ts`
Expected: FAIL because the TikTok schemas and environment fields do not exist.

- [ ] **Step 3: Implement the schemas and all-or-none environment validation**

```ts
export const tikTokCapabilitiesSchema = z.object({
  receiveMessages: z.boolean(),
  sendText: z.boolean(),
  sendImage: z.boolean(),
}).strict();

export const tikTokConnectionSummarySchema = z.object({
  status: z.enum(['NOT_CONNECTED', 'ACTIVE', 'INBOUND_ONLY', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED']),
  accountId: z.string().nullable(),
  displayName: z.string().nullable(),
  capabilities: tikTokCapabilitiesSchema.nullable(),
  tokenExpiresAt: z.string().datetime().nullable(),
  lastVerifiedAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(),
  cleanupStatus: z.enum(['NONE', 'PENDING', 'FAILED']),
}).strict();
```

Require client ID and secret together, and require both when the flag is true. Pass all three fields to API and worker in `compose.yaml`: API owns OAuth/connection activation, while the worker needs the same app identity for serialized token refresh before authenticated media calls.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @autosale/contracts test -- tiktok.spec.ts conversations.spec.ts && pnpm --filter @autosale/config test -- api-env.spec.ts worker-env.spec.ts deployment-env.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit the contracts/config increment**

```bash
git add packages/contracts packages/config .env.example compose.yaml
git commit -m "feat: add TikTok messaging contracts and config"
```

### Task 2: Add tenant-safe connection persistence

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261004100000_tiktok_business_messaging/migration.sql`
- Modify: `packages/database/src/tenant-rls.integration.spec.ts`
- Modify: `packages/database/src/tenant-relation-guards.integration.spec.ts`

**Interfaces:**
- Consumes: TikTok statuses and capability JSON defined in Task 1.
- Produces: Prisma delegates `tikTokConnection`, `tikTokOAuthAttempt`, and `tikTokCredentialCleanup`.
- Produces: SQL function `api_tiktok_tenant_for_account(text)` returning only an active/inbound-only tenant.

- [ ] **Step 1: Add failing RLS and relation-guard tests**

```ts
await tenantA.tikTokConnection.create({ data: {
  tenantId: tenantAId,
  externalAccountId: 'fictional-account-a',
  displayName: 'Fictional A',
  status: 'ACTIVE',
  capabilities: { receiveMessages: true, sendText: false, sendImage: false },
} });
await expect(tenantB.tikTokConnection.findMany()).resolves.toEqual([]);
await expect(tenantB.tikTokConnection.updateMany({
  where: { externalAccountId: 'fictional-account-a' },
  data: { displayName: 'Cross tenant' },
})).resolves.toMatchObject({ count: 0 });
```

- [ ] **Step 2: Run database tests and verify failure**

Run: `pnpm --filter @autosale/database test -- tenant-rls.integration.spec.ts tenant-relation-guards.integration.spec.ts`
Expected: FAIL because the new Prisma models do not exist.

- [ ] **Step 3: Add models, foreign keys, uniqueness, indexes, RLS, and routing function**

Create one connection per tenant and one active tenant per external account. Store `encryptedAccessToken`, `encryptedRefreshToken`, `tokenExpiresAt`, `refreshTokenExpiresAt`, `grantedScopes`, `capabilities Json`, `credentialGenerationId`, health fields, and connected actor. OAuth attempts store only `tokenHash`, tenant/user binding, return path, expiry, and consumption. Cleanup rows store encrypted credentials, webhook/revoke operation states, leases, and terminal state.

The SQL routing function must return a tenant only for `status IN ('ACTIVE', 'INBOUND_ONLY')` and must be executable by the API role without bypassing tenant RLS elsewhere.

- [ ] **Step 4: Generate Prisma client and run database tests**

Run: `pnpm --filter @autosale/database generate && pnpm --filter @autosale/database test -- tenant-rls.integration.spec.ts tenant-relation-guards.integration.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit the migration**

```bash
git add packages/database/prisma packages/database/src
git commit -m "feat: persist tenant-scoped TikTok connections"
```

### Task 3: Build the strict TikTok provider client

**Files:**
- Create: `packages/integrations/src/tiktok-business-messaging.ts`
- Create: `packages/integrations/src/tiktok-business-messaging.spec.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Produces: `TikTokBusinessMessagingClient` with `getAuthorizationUrl`, `exchangeCode`, `refreshToken`, `revokeToken`, `getAccount`, scope-derived `getCapabilities`, and `downloadMedia`. Conversation-specific send capability is checked later by the outbound adapter and is not treated as an account-wide OAuth property.
- Produces a separate deployment-scoped webhook configuration boundary. It is reconciled once for the Sales AITO developer app and is never created or deleted during merchant connect/disconnect.
- Produces: `TikTokBusinessMessagingError` with `stage`, HTTP status, provider code, request ID, and retryability.

- [ ] **Step 1: Write failing client tests with fictional responses**

```ts
const client = new TikTokBusinessMessagingClient({
  clientId: 'fictional-client-id',
  clientSecret: 'fictional-client-secret-value',
  fetch: fetchMock,
});
expect(client.getAuthorizationUrl({ state: 'opaque-state', redirectUri: 'https://sales-aito.test/api/integrations/tiktok/callback' }))
  .toContain('state=opaque-state');
await expect(client.getCapabilities('token', 'fictional-account')).resolves.toEqual({
  receiveMessages: true,
  sendText: false,
  sendImage: false,
});
```

Cover malformed success bodies, non-JSON failures, timeouts, redacted errors, refresh parsing, account identity mismatch, and media content-type/size limits.

- [ ] **Step 2: Run the client test and verify failure**

Run: `pnpm --filter @autosale/integrations test -- tiktok-business-messaging.spec.ts`
Expected: FAIL because the client is missing.

- [ ] **Step 3: Implement one strict boundary client**

Use `https://business-api.tiktok.com/` as the API origin, `AbortSignal.timeout(10_000)`, the documented `Access-Token: <token>` header for authorized API for Business requests, and Zod/explicit guards for every response. OAuth token endpoints remain unauthenticated requests carrying app credentials in the JSON body. Keep endpoint construction private so a provider version update changes one file. Never include response bodies or tokens in thrown error messages.

- [ ] **Step 4: Run the integration package tests**

Run: `pnpm --filter @autosale/integrations test -- tiktok-business-messaging.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit the provider client**

```bash
git add packages/integrations/src
git commit -m "feat: add TikTok business messaging client"
```

### Task 4: Implement OAuth, capability activation, and cleanup

**Files:**
- Create: `apps/api/src/integrations/tiktok-oauth-state.service.ts`
- Create: `apps/api/src/integrations/tiktok-oauth-state.service.spec.ts`
- Create: `apps/api/src/integrations/tiktok-oauth.service.ts`
- Create: `apps/api/src/integrations/tiktok-oauth.service.spec.ts`
- Create: `apps/api/src/integrations/tiktok-oauth.controller.ts`
- Create: `apps/api/src/integrations/tiktok-oauth.controller.spec.ts`
- Create: `apps/api/src/integrations/tiktok-oauth.module.ts`
- Create: `apps/api/src/integrations/tiktok-oauth.module.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces routes `GET /api/integrations/tiktok`, `POST /authorize`, `GET /callback`, `DELETE /connection`, and `POST /cleanup/retry`.
- Produces `TikTokOAuthService.getSummary(tenantId)`, `authorize(tenantId,userId,returnPath)`, `completeCallback(code,state)`, and `disconnect(tenantId,userId)`.

- [x] **Step 1: Write failing state, authorization, callback, and controller tests**

```ts
await expect(service.authorize(tenantId, ownerId, '/settings?tab=social')).resolves.toEqual({
  authorizationUrl: expect.stringContaining('state='),
});
await expect(service.completeCallback('fictional-code', state)).resolves.toMatchObject({
  redirectPath: '/settings?tab=social&tiktok=connected',
});
expect(appWebhookHealth.assertHealthy).toHaveBeenCalledTimes(1);
expect(await prisma.tikTokConnection.findUnique({ where: { tenantId } }))
  .toMatchObject({ externalAccountId: 'fictional-account', status: 'INBOUND_ONLY' });
```

Also cover manager denial, replayed/expired state, missing inbound capability, account already owned by another tenant, callback race, encrypted credentials, unhealthy deployment-level webhook configuration, and merchant credential cleanup. Assert that disconnect never mutates the shared webhook subscription.

- [x] **Step 2: Run focused API tests and verify failure**

Run: `pnpm --filter @autosale/api test -- tiktok-oauth-state.service.spec.ts tiktok-oauth.service.spec.ts tiktok-oauth.controller.spec.ts tiktok-oauth.module.spec.ts`
Expected: FAIL because the module is missing.

- [x] **Step 3: Implement owner-only OAuth and activation**

Reuse `CredentialCipher`, `assertTenantAcceptingMutations`, authenticated principal/role guards, safe return-path rules, cleanup leasing, and transaction patterns from Facebook without sharing provider credentials or Page-selection logic. Inspect the token and bind its `creator_id` to the returned `open_id`; use granted `message.list.read/manage/send` scopes for account-level readiness. Set `ACTIVE` when inbound scopes and the send scope are available; set `INBOUND_ONLY` when inbound scopes are available but send is not. Actual send eligibility is conversation-specific and is checked only when sending. Do not persist an active connection unless the deployment-level webhook health check succeeds. Merchant disconnect revokes only merchant credentials and must not delete the shared webhook subscription.

- [x] **Step 4: Run focused API tests**

Run: `pnpm --filter @autosale/api test -- tiktok-oauth-state.service.spec.ts tiktok-oauth.service.spec.ts tiktok-oauth.controller.spec.ts tiktok-oauth.module.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit OAuth lifecycle**

```bash
git add apps/api/src/integrations apps/api/src/app.module.ts
git commit -m "feat: connect TikTok business accounts"
```

### Task 5: Register authentic webhooks durably

**Files:**
- Create: `apps/api/src/tiktok/tiktok-signature.service.ts`
- Create: `apps/api/src/tiktok/tiktok-signature.service.spec.ts`
- Create: `apps/api/src/tiktok/tiktok-event.service.ts`
- Create: `apps/api/src/tiktok/tiktok-event.service.spec.ts`
- Create: `apps/api/src/tiktok/tiktok-webhook.controller.ts`
- Create: `apps/api/src/tiktok/tiktok-webhook.controller.spec.ts`
- Create: `apps/api/src/tiktok/tiktok.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `tests/fixtures/tiktok/text-message.json`
- Create: `tests/fixtures/tiktok/image-message.json`
- Create: `tests/fixtures/tiktok/video-message.json`
- Create: `tests/fixtures/tiktok/link-message.json`

**Interfaces:**
- Produces the public signed POST callback route from `TikTokModule`; the current API for Business configuration contract has no Meta-style GET challenge.
- Produces BullMQ job `tiktok.normalize` with `{ tenantId, eventId, correlationId }` and `jobId = eventId`.
- Produces webhook event keys `tiktok:<provider-event-id>` or `tiktok:sha256:<digest>`.

- [x] **Step 1: Add failing signature, routing, and duplicate tests**

```ts
await request(app.getHttpServer())
  .post('/webhooks/tiktok')
  .set(validTikTokSignatureHeaders(rawBody))
  .send(rawBody)
  .expect(200);
expect(queue.add).toHaveBeenCalledWith(
  'tiktok.normalize',
  expect.objectContaining({ tenantId, correlationId: expect.any(String) }),
  expect.objectContaining({ jobId: expect.any(String) }),
);
expect(await prisma.webhookEvent.count({ where: { tenantId, provider: 'TIKTOK' } })).toBe(1);
```

Test invalid signature before persistence, unknown account acknowledgment, duplicate callback exactly once, frozen tenant no-op, malformed supported event, and broker failure leaving `RECEIVED` for reconciliation.

- [x] **Step 2: Run focused webhook tests and verify failure**

Run: `pnpm --filter @autosale/api test -- tiktok-signature.service.spec.ts tiktok-event.service.spec.ts tiktok-webhook.controller.spec.ts`
Expected: FAIL because the TikTok webhook boundary is missing.

- [x] **Step 3: Implement exact raw-body verification and durable registration**

Follow the current API for Business signature contract: there is no Meta-style GET challenge. Verify `TikTok-Signature` against the exact raw body before JSON parsing, resolve tenant with `api_tiktok_tenant_for_account`, sanitize the stored payload, insert under the unique tenant/provider/external-event key, then enqueue. Return a successful provider acknowledgment for authentic duplicates and lifecycle-frozen tenants.

- [x] **Step 4: Run focused webhook tests**

Run: `pnpm --filter @autosale/api test -- tiktok-signature.service.spec.ts tiktok-event.service.spec.ts tiktok-webhook.controller.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit webhook ingestion**

```bash
git add apps/api/src/tiktok apps/api/src/app.module.ts tests/fixtures/tiktok
git commit -m "feat: ingest signed TikTok messaging webhooks"
```

### Task 6: Normalize and process TikTok messages through shared ingestion

**Files:**
- Modify: `apps/worker/src/social/normalized-inbound-message.ts`
- Modify: `apps/worker/src/social/social-inbound-ingestion.service.ts`
- Modify: `apps/worker/src/social/social-inbound-ingestion.service.spec.ts`
- Create: `apps/worker/src/tiktok/tiktok-normalizer.ts`
- Create: `apps/worker/src/tiktok/tiktok-normalizer.spec.ts`
- Create: `apps/worker/src/tiktok/tiktok-token.service.ts`
- Create: `apps/worker/src/tiktok/tiktok-token.service.spec.ts`
- Create: `apps/worker/src/tiktok/tiktok-media-copy.service.ts`
- Create: `apps/worker/src/tiktok/tiktok-media-copy.service.spec.ts`
- Create: `apps/worker/src/tiktok/tiktok.processor.ts`
- Create: `apps/worker/src/tiktok/tiktok.processor.spec.ts`
- Modify: `apps/worker/src/instagram/media-copy.service.ts`
- Modify: `apps/worker/src/instagram/media-copy.service.spec.ts`
- Modify: `apps/worker/src/instagram/instagram-event-reconciler.ts`
- Modify: `apps/worker/src/instagram/instagram-event-reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `packages/database/prisma/migrations/20261004101500_tiktok_event_recovery/migration.sql`
- Modify: `packages/database/src/instagram-assets-rls.postgres.spec.ts`

**Interfaces:**
- Consumes: queue job `tiktok.normalize` and durable `WebhookEvent`.
- Produces: `NormalizedInboundMessage` with `channel: 'TIKTOK'`.
- Produces controlled media keys under `tenants/<tenantId>/tiktok/sha256/<checksum>.<ext>`.
- Produces `TikTokTokenService.getFreshAccessToken(tenantId, credentialGenerationId, now)` with a database lease so concurrent media jobs perform at most one refresh.

- [x] **Step 1: Write failing normalizer, processor, and duplicate-delivery tests**

```ts
expect(normalizeTikTokEvent(fixture)).toEqual([expect.objectContaining({
  channel: 'TIKTOK',
  externalMessageId: 'fictional-message-001',
  externalConversationId: 'fictional-conversation-001',
  direction: 'INBOUND',
  attachments: [{ type: 'IMAGE', sourceUrl: 'https://provider.invalid/temporary-image' }],
})]);
await processor.process({ tenantId, eventId });
await processor.process({ tenantId, eventId });
expect(await prisma.message.count({ where: { tenantId, channel: 'TIKTOK' } })).toBe(1);
expect(orderProcessor.process).toHaveBeenCalledTimes(1);
```

Cover text, image, video, link, mixed content, unsupported payload, missing media URL, outbound echo ignored by inbound processing, malformed supported event, media copy failure, and reconciliation.

Add token tests proving that a valid token is reused, a near-expiry token is refreshed once under concurrency, the new access/refresh tokens are encrypted atomically, a superseded credential generation cannot be updated, and permanent refresh rejection marks the connection `REAUTH_REQUIRED`.

- [x] **Step 2: Run focused worker tests and verify failure**

Run: `pnpm --filter @autosale/worker test -- tiktok-normalizer.spec.ts tiktok-token.service.spec.ts tiktok.processor.spec.ts social-inbound-ingestion.service.spec.ts media-copy.service.spec.ts instagram-event-reconciler.spec.ts`
Expected: FAIL because the TikTok channel and processor are missing.

- [x] **Step 3: Implement TikTok normalization and shared processing**

Keep provider field interpretation inside `tiktok-normalizer.ts`. Extend shared channel unions and provider storage naming without changing existing Instagram/Facebook semantics. Obtain a fresh token through `TikTokTokenService` before authenticated media download instead of trusting temporary URLs blindly. Register `tiktok.normalize` in worker dispatch and reconciliation only when the feature flag is enabled.

- [x] **Step 4: Run focused worker tests**

Run: `pnpm --filter @autosale/worker test -- tiktok-normalizer.spec.ts tiktok-token.service.spec.ts tiktok.processor.spec.ts social-inbound-ingestion.service.spec.ts media-copy.service.spec.ts instagram-event-reconciler.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit worker ingestion**

```bash
git add apps/worker/src
git commit -m "feat: process TikTok messages and order triggers"
```

### Task 7: Extend conversation and order recognition semantics

**Files:**
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/worker/src/orders/openai-order-recognizer.ts`
- Modify: `apps/worker/src/orders/openai-order-recognizer.spec.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.spec.ts`

**Interfaces:**
- Consumes: stored `Conversation.channel = 'TIKTOK'`.
- Produces: list/detail DTOs with TikTok, attachment previews, and inbound-slice reply capability `{ enabled: false, reason: 'CHANNEL_READ_ONLY' }`.
- Produces: provider-neutral prompt label `TikTok` while preserving prior prompt versions for historical Instagram events.

- [x] **Step 1: Add failing TikTok list/detail and order tests**

```ts
expect((await service.list(tenantId, { limit: 20 })).items[0]).toMatchObject({
  channel: 'TIKTOK',
  lastMessagePreview: '📷 TikTok',
});
expect((await service.detail(tenantId, conversationId)).replyCapability)
  .toEqual({ enabled: false, reason: 'CHANNEL_READ_ONLY' });
expect(recognizer).toHaveBeenCalledWith(expect.objectContaining({ channel: 'TIKTOK' }));
```

- [x] **Step 2: Run focused conversation/order tests and verify failure**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts && pnpm --filter @autosale/worker test -- openai-order-recognizer.spec.ts triggered-order.processor.spec.ts`
Expected: FAIL because the social channel coercion defaults TikTok to Instagram.

- [x] **Step 3: Replace binary channel branching with exhaustive helpers**

Use an exhaustive `SocialChannel` mapping for preview labels, prompt labels, and reply capability. Do not attach an `InstagramCustomerProfile` to TikTok; use `Conversation.displayName` until a provider-neutral profile model is intentionally designed.

- [x] **Step 4: Run focused tests**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts && pnpm --filter @autosale/worker test -- openai-order-recognizer.spec.ts triggered-order.processor.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit conversation/order support**

```bash
git add apps/api/src/conversations apps/worker/src/orders
git commit -m "feat: expose TikTok conversations to order recognition"
```

### Task 8: Add settings, inbox presentation, onboarding, and localization

**Files:**
- Create: `apps/web/src/components/tiktok-settings-form.tsx`
- Create: `apps/web/src/components/tiktok-settings-form.spec.tsx`
- Modify: `apps/web/src/components/social-channel-hub.tsx`
- Modify: `apps/web/src/components/social-channel-hub.spec.tsx`
- Modify: `apps/web/src/components/conversation-list.tsx`
- Modify: `apps/web/src/components/conversation-list.spec.tsx`
- Modify: `apps/web/src/components/message-thread.tsx`
- Modify: `apps/web/src/components/message-thread.spec.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.spec.tsx`
- Modify: `apps/web/app/(workspace)/onboarding/page.tsx`
- Modify: `apps/web/app/(workspace)/onboarding/page.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/src/i18n/completeness.spec.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `GET /api/integrations/tiktok` summary and owner mutation routes.
- Produces: third collapsed social-channel row and TikTok-labelled conversations.

- [x] **Step 1: Add failing UI tests**

```tsx
expect(screen.getByRole('button', { name: /TikTok/i })).toHaveAttribute('aria-expanded', 'false');
await user.click(screen.getByRole('button', { name: /TikTok/i }));
expect(screen.getByRole('button', { name: /Підключити TikTok/i })).toHaveClass('primary-button');
expect(screen.getByText(/Лише отримання повідомлень/i)).toBeVisible();
```

Test owner/manager differences, connected count `0 із 3`, inbound-only status, reconnect/disconnect loading states, mobile no-overflow, channel badge, and localized errors.

- [x] **Step 2: Run focused web tests and verify failure**

Run: `pnpm --filter @autosale/web test -- tiktok-settings-form.spec.tsx social-channel-hub.spec.tsx conversation-list.spec.tsx message-thread.spec.tsx page.spec.tsx completeness.spec.ts`
Expected: FAIL because the TikTok row and translations do not exist.

- [x] **Step 3: Implement the collapsed settings row and inbox badge**

Use `LoadingButton` for authorize/disconnect, `primary-button` for connect, `danger-button` for confirmed disconnect, and text-based capability/status descriptions. Preserve all rows collapsed on initial render. Update onboarding readiness so any active Instagram, Facebook, or TikTok inbound connection satisfies the sales-channel step.

- [x] **Step 4: Run focused web tests**

Run: `pnpm --filter @autosale/web test -- tiktok-settings-form.spec.tsx social-channel-hub.spec.tsx conversation-list.spec.tsx message-thread.spec.tsx page.spec.tsx completeness.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit the UI increment**

```bash
git add apps/web
git commit -m "feat: add TikTok connection and inbox UI"
```

### Task 9: Document, exercise end-to-end behavior, and close Slice A

**Files:**
- Create: `docs/integrations/tiktok-business-messaging.md`
- Create: `docs/acceptance/tiktok-business-messaging-checklist.md`
- Create: `tests/e2e/tiktok-business-messaging-inbound.spec.ts`
- Modify: `docs/features/README.md`
- Modify: `docs/superpowers/specs/2026-10-04-tiktok-business-messaging-design.md`
- Modify: `docs/acceptance/mvp-checklist.md`

**Interfaces:**
- Produces: operator setup/recovery contract and automated acceptance evidence.
- Changes feature status from `Planned` to `Validation pending` only after all automated checks pass.

- [ ] **Step 1: Write failing E2E acceptance with a fictional provider harness**

```ts
test('owner connects TikTok and one duplicate webhook creates one message and order trigger', async ({ page, request }) => {
  await connectFictionalTikTokAccount(page);
  await postSignedTikTokFixture(request, 'text-message.json');
  await postSignedTikTokFixture(request, 'text-message.json');
  await expect(page.getByText('TikTok')).toBeVisible();
  await expect(page.getByText('Хочу замовити Fictional Product')).toHaveCount(1);
});
```

- [ ] **Step 2: Run E2E and verify failure before final wiring**

Run: `pnpm exec playwright test tests/e2e/tiktok-business-messaging-inbound.spec.ts`
Expected: FAIL until the full route/UI/worker test harness is wired.

- [ ] **Step 3: Add runbook, safe evidence checklist, and complete test harness**

Document developer app creation, callback/webhook URLs, environment fields, enable/disable procedure, health checks, token refresh/reconnect, cleanup retry, rollback, exact live tests, and the fact that FOP/Ukraine/provider approval remain TikTok decisions. Mark outbound live acceptance separately from inbound.

- [ ] **Step 4: Run complete verification**

Run: `pnpm --filter @autosale/database generate && pnpm typecheck && pnpm test && pnpm build && pnpm exec playwright test tests/e2e/tiktok-business-messaging-inbound.spec.ts tests/e2e/conversation-inbox.spec.ts tests/e2e/facebook-messenger-inbound.spec.ts && git diff --check`
Expected: all commands PASS; only documented live provider checks remain pending.

- [ ] **Step 5: Commit Slice A completion**

```bash
git add docs tests/e2e
git commit -m "docs: add TikTok inbound rollout and acceptance"
```
