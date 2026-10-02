# Facebook Messenger Inbound Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant owner connect one Facebook Page and receive its new Messenger messages in the existing Sales AITO inbox and AI order-recognition flow.

**Architecture:** Keep Facebook OAuth/Page credentials separate from Instagram credentials, route both signed callback shapes through the existing Meta webhook boundary, then convert them to a shared `NormalizedInboundMessage` and provider-neutral ingestion service. Preserve the physical BullMQ `instagram` queue during this slice for zero-downtime compatibility, while exposing it internally as the social inbound queue and accepting both `instagram.normalize` and `facebook.normalize` jobs.

**Tech Stack:** TypeScript 5.9, NestJS 11, Next.js 16/React 19, Prisma 7/PostgreSQL RLS, BullMQ/Redis, Zod 4, Vitest, Playwright, Meta Graph API.

**Spec:** `docs/superpowers/specs/2026-10-02-facebook-messenger-inbound-design.md`

## Global Constraints

- MVP is Facebook **Page Messenger inbound only**; personal chats, comments, history sync and Facebook outbound replies are excluded.
- One active Facebook Page per tenant; one Page ID may route to only one tenant.
- Existing Instagram Login, message delivery, persisted prompt versions and external event identities keep their current behavior.
- All OAuth state is hashed, single-use and consumed before provider I/O; credentials and Page candidates are encrypted server-side.
- Every tenant-owned table and lookup is protected by tenant transaction context and RLS; webhook tenant routing uses a narrow authority function.
- The browser never receives access tokens, provider error bodies or raw webhook payloads.
- Use shared button variants and `LoadingButton`; new independently invalid fields use `FormField`, `FieldError` and shared validation helpers.
- Implementation is test-first: each production step follows a failing targeted test.
- Keep `FACEBOOK_MESSENGER_ENABLED=false` by default until automated verification and live Meta acceptance pass.

---

## File map

### New focused units

- `packages/contracts/src/facebook.ts` — safe Facebook connection, Page candidate and selection schemas.
- `packages/integrations/src/meta-facebook.ts` — strict Facebook Login, Graph Page discovery and subscription client.
- `apps/api/src/integrations/facebook-oauth-state.service.ts` — single-use OAuth attempt and encrypted Page-candidate state.
- `apps/api/src/integrations/facebook-oauth.service.ts` — tenant connection lifecycle, Page selection and cleanup orchestration.
- `apps/api/src/integrations/facebook-oauth.controller.ts` — authenticated owner endpoints and public callback.
- `apps/api/src/integrations/facebook-oauth.module.ts` — configuration and dependency wiring.
- `apps/worker/src/social/normalized-inbound-message.ts` — provider-neutral normalized message contract.
- `apps/worker/src/social/social-inbound-ingestion.service.ts` — shared idempotent conversation/message/attachment persistence and order trigger.
- `apps/worker/src/facebook/facebook-normalizer.ts` — strict `object: page` Messenger payload conversion.
- `apps/worker/src/facebook/facebook.processor.ts` — event loading, normalization and shared ingestion invocation.
- `apps/web/src/components/facebook-settings-form.tsx` — connect/select/reconnect/disconnect UI.
- `docs/integrations/meta-facebook-messenger.md` — safe provider setup and live acceptance runbook.
- `tests/fixtures/meta/facebook-text-message.json` and `facebook-image-message.json` — fictional signed-payload fixtures.

### Existing units changed

- Contracts, Prisma schema/migration/RLS tests, Meta controller/event service, queue module, worker bootstrap, conversations API, order source contracts, social settings hub, translations, E2E and canonical feature/acceptance docs.

---

### Task 1: Add channel contracts, configuration and tenant-safe persistence

**Files:**
- Create: `packages/contracts/src/facebook.ts`
- Create: `packages/contracts/src/facebook.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/src/conversations.ts`
- Modify: `packages/contracts/src/conversations.spec.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Modify: `packages/config/src/worker-env.ts`
- Modify: `packages/config/src/worker-env.spec.ts`
- Modify: `.env.example`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261002210000_facebook_messenger_inbound/migration.sql`
- Create: `packages/database/src/facebook-integration-rls.postgres.spec.ts`
- Modify: `packages/database/src/final-tenant-rls.postgres.spec.ts`

**Interfaces:**
- Produces `socialChannelSchema = z.enum(['INSTAGRAM', 'FACEBOOK'])`.
- Produces `facebookConnectionSummarySchema`, `facebookPageCandidateSchema`, `facebookPageSelectionInputSchema` and inferred public types.
- Produces Prisma models `FacebookConnection`, `FacebookOAuthAttempt`, `FacebookCredentialCleanup` plus authority function `public.api_facebook_tenant_for_page(text)`.

- [ ] **Step 1: Write failing public-contract tests**

```ts
it('accepts Facebook conversations without widening the channel vocabulary', () => {
  expect(conversationSummarySchema.parse({ ...summary, channel: 'FACEBOOK' }).channel).toBe('FACEBOOK');
  expect(() => conversationSummarySchema.parse({ ...summary, channel: 'WHATSAPP' })).toThrow();
});

it('never exposes a Page token in a connection summary', () => {
  const parsed = facebookConnectionSummarySchema.parse({
    status: 'ACTIVE', pageId: 'page-1', pageName: 'Fictional Shop',
    tokenExpiresAt: null, lastVerifiedAt: now, lastErrorCode: null,
    cleanupStatus: 'NONE', cleanupErrorCode: null,
  });
  expect(Object.keys(parsed)).not.toContain('accessToken');
});
```

- [ ] **Step 2: Run contracts/config tests and confirm RED**

Run: `pnpm --filter @autosale/contracts test -- facebook.spec.ts conversations.spec.ts && pnpm --filter @autosale/config test -- api-env.spec.ts worker-env.spec.ts`  
Expected: FAIL because Facebook schemas and `FACEBOOK_MESSENGER_ENABLED` do not exist.

- [ ] **Step 3: Implement additive schemas and feature-flag parsing**

```ts
export const socialChannelSchema = z.enum(['INSTAGRAM', 'FACEBOOK']);
export const facebookConnectionStatusSchema = z.enum([
  'NOT_CONNECTED', 'ACTIVE', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED',
]);
export const facebookPageSelectionInputSchema = z.object({
  attemptId: z.string().uuid(),
  pageId: z.string().min(1).max(128),
});
```

Use `socialChannelSchema` in list/detail conversation contracts. Add `CHANNEL_READ_ONLY` to `replyCapabilitySchema`; keep Instagram delivery error enums unchanged. Add optional boolean parsing for `FACEBOOK_MESSENGER_ENABLED` in API/worker env with default `false`, and document only `FACEBOOK_MESSENGER_ENABLED=false` in `.env.example`.

- [ ] **Step 4: Write the failing migration/RLS test**

```ts
it('isolates Facebook credentials and authorizes Page routing only through the authority function', async () => {
  await insertFacebookConnection(ownerClient, tenantA, 'page-a');
  await expect(readFacebookConnection(memberClient, tenantB, tenantA)).resolves.toEqual([]);
  await expect(resolveFacebookTenant(apiClient, 'page-a')).resolves.toBe(tenantA);
  await expect(resolveFacebookTenant(workerClient, 'page-a')).rejects.toThrow();
});
```

- [ ] **Step 5: Run the database test and confirm RED**

Run: `pnpm --filter @autosale/database test -- facebook-integration-rls.postgres.spec.ts`  
Expected: FAIL because the tables and authority function do not exist.

- [ ] **Step 6: Add schema and reversible migration**

Create tenant-keyed connection, attempt and cleanup tables with composite tenant FKs, unique active Page routing, credential generation fencing, indexes for expiry/cleanup leases, forced RLS, API/worker grants matching the existing Instagram integration policy, and a `SECURITY DEFINER` Page-to-tenant function available only to the API role. Candidate credential ciphertext expires with the OAuth attempt and is cleared on selection/failure.

- [ ] **Step 7: Generate Prisma and verify GREEN**

Run: `pnpm --filter @autosale/database generate && pnpm --filter @autosale/contracts test && pnpm --filter @autosale/config test && pnpm --filter @autosale/database test -- facebook-integration-rls.postgres.spec.ts final-tenant-rls.postgres.spec.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add .env.example packages/contracts packages/config packages/database
git commit -m "feat(facebook): add tenant-safe Messenger contracts"
```

---

### Task 2: Implement the strict Meta Facebook client

**Files:**
- Create: `packages/integrations/src/meta-facebook.ts`
- Create: `packages/integrations/src/meta-facebook.spec.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Consumes `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_API_VERSION`.
- Produces `MetaFacebookClient.getAuthorizationUrl`, `exchangeCode`, `listEligiblePages`, `verifyPage`, `subscribePage`, `unsubscribePage`.

- [ ] **Step 1: Write failing client tests**

```ts
it('requests only the approved Messenger Page scopes', () => {
  const url = new URL(client.getAuthorizationUrl({ state: 'state', redirectUri }));
  expect(url.origin + url.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth');
  expect(url.searchParams.get('scope')?.split(',').sort()).toEqual([
    'pages_manage_metadata', 'pages_messaging', 'pages_read_engagement', 'pages_show_list',
  ]);
});

it('rejects a malformed Page list without leaking its body', async () => {
  fetchMock.mockResolvedValue(response({ data: [{ id: 7, access_token: 'secret' }] }));
  await expect(client.listEligiblePages('user-token')).rejects.toMatchObject({
    name: 'MetaFacebookError', responseStage: 'PAGES',
  });
});
```

- [ ] **Step 2: Run client tests and confirm RED**

Run: `pnpm --filter @autosale/integrations test -- meta-facebook.spec.ts`  
Expected: FAIL because `MetaFacebookClient` does not exist.

- [ ] **Step 3: Implement typed provider boundaries**

```ts
export interface MetaFacebookPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  tasks: string[];
}

export class MetaFacebookClient {
  getAuthorizationUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<MetaFacebookUserToken>;
  listEligiblePages(userAccessToken: string): Promise<MetaFacebookPage[]>;
  verifyPage(pageId: string, pageAccessToken: string): Promise<{ pageId: string; pageName: string }>;
  subscribePage(pageId: string, pageAccessToken: string): Promise<void>;
  unsubscribePage(pageId: string, pageAccessToken: string): Promise<void>;
}
```

Every request uses the configured Graph version, ten-second timeout, bearer token header and strict response parsing. `listEligiblePages` retains only Pages with a messaging-capable task. `subscribePage` posts `subscribed_fields=messages` to `/{pageId}/subscribed_apps`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @autosale/integrations test -- meta-facebook.spec.ts && pnpm --filter @autosale/integrations typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/integrations/src/meta-facebook.ts packages/integrations/src/meta-facebook.spec.ts packages/integrations/src/index.ts
git commit -m "feat(facebook): add Messenger Graph client"
```

---

### Task 3: Add owner OAuth, Page selection and fenced cleanup

**Files:**
- Create: `apps/api/src/integrations/facebook-oauth-state.service.ts`
- Create: `apps/api/src/integrations/facebook-oauth-state.service.spec.ts`
- Create: `apps/api/src/integrations/facebook-oauth.service.ts`
- Create: `apps/api/src/integrations/facebook-oauth.service.spec.ts`
- Create: `apps/api/src/integrations/facebook-oauth.controller.ts`
- Create: `apps/api/src/integrations/facebook-oauth.controller.spec.ts`
- Create: `apps/api/src/integrations/facebook-oauth.module.ts`
- Create: `apps/api/src/integrations/facebook-oauth.module.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `GET /api/integrations/facebook`, `POST /authorize`, public `GET /callback`, `POST /selection`, `DELETE /`, `POST /cleanup/retry`.
- Consumes `MetaFacebookClient`, existing `CredentialCipher`, authenticated principal, CSRF guard, audit log and tenant lifecycle guard.

- [ ] **Step 1: Write failing state and service tests**

```ts
it('consumes state before external I/O and exposes multiple Pages without tokens', async () => {
  const result = await service.completeCallback('code', rawState);
  expect(state.consume).toHaveBeenCalledBefore(meta.exchangeCode);
  expect(result).toEqual({ kind: 'PAGE_SELECTION_REQUIRED', attemptId, pages: [
    { pageId: 'page-1', pageName: 'Fictional One' },
    { pageId: 'page-2', pageName: 'Fictional Two' },
  ] });
  expect(JSON.stringify(result)).not.toContain('page-token');
});

it('rejects a Page ID that is not in the encrypted candidate set', async () => {
  await expect(service.selectPage(owner, { attemptId, pageId: 'foreign-page' }))
    .rejects.toMatchObject({ response: { code: 'FACEBOOK_PAGE_NOT_ELIGIBLE' } });
});
```

- [ ] **Step 2: Run service tests and confirm RED**

Run: `pnpm --filter @autosale/api test -- facebook-oauth-state.service.spec.ts facebook-oauth.service.spec.ts`  
Expected: FAIL because the services do not exist.

- [ ] **Step 3: Implement state, callback, Page selection and activation**

Implement `FacebookOAuthStateService.issue()` and `.consume()` using a random raw state returned once and a SHA-256 hash stored in the database. `FacebookOAuthService.completeCallback()` stores only encrypted, ten-minute Page candidates; zero/one/multiple Page branches follow the spec. `selectPage()` decrypts server-side candidates, validates exact membership, calls `verifyPage()` and `subscribePage()`, then atomically activates the fenced credential generation.

- [ ] **Step 4: Add failing controller authorization tests**

```ts
it('allows only an active owner to start or mutate Facebook connection', async () => {
  await manager.post('/api/integrations/facebook/authorize').expect(403);
  await owner.post('/api/integrations/facebook/authorize').expect(201);
  await anonymous.get('/api/integrations/facebook/callback?code=x&state=y').expect(302);
});
```

- [ ] **Step 5: Run controller test and confirm RED**

Run: `pnpm --filter @autosale/api test -- facebook-oauth.controller.spec.ts facebook-oauth.module.spec.ts`  
Expected: FAIL because the module/routes are not registered.

- [ ] **Step 6: Implement safe routes and cleanup fencing**

Return safe summaries only. Redirect callback outcomes to `/settings?tab=social&facebook=connected|select-page|error`; do not reflect Meta descriptions. Disconnect fences the generation locally before unsubscribe. Unknown unsubscribe outcomes create/update a cleanup row; retry continues only incomplete operations and reconnect remains blocked until terminal cleanup.

- [ ] **Step 7: Verify GREEN and tenant-scope regression**

Run: `pnpm --filter @autosale/api test -- facebook-oauth-state.service.spec.ts facebook-oauth.service.spec.ts facebook-oauth.controller.spec.ts facebook-oauth.module.spec.ts settings-tenant-scope.spec.ts`  
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/api/src/integrations apps/api/src/app.module.ts
git commit -m "feat(facebook): add Page connection lifecycle"
```

---

### Task 4: Route signed Facebook Page webhook events durably

**Files:**
- Modify: `packages/contracts/src/meta.ts`
- Modify: `packages/contracts/src/meta.spec.ts`
- Modify: `apps/api/src/meta/meta.controller.ts`
- Modify: `apps/api/src/meta/meta.controller.spec.ts`
- Modify: `apps/api/src/meta/meta-event.service.ts`
- Modify: `apps/api/src/meta/meta-event.service.spec.ts`
- Modify: `apps/api/src/queue/queue.module.ts`
- Modify: `apps/api/src/admin/admin-queue-monitor.ts`
- Modify: `apps/api/src/admin/admin-queue-monitor.spec.ts`
- Create: `tests/fixtures/meta/facebook-text-message.json`
- Create: `tests/fixtures/meta/facebook-image-message.json`

**Interfaces:**
- `MetaEventService.resolveTenant(channel, externalAccountId)` returns an active tenant or `null`.
- Physical queue remains `instagram`; exported injection token becomes `SOCIAL_INBOUND_QUEUE`, with legacy aliases preserved.
- Jobs are `{ tenantId, eventId, correlationId }` named `instagram.normalize` or `facebook.normalize`.

- [ ] **Step 1: Write failing Page webhook tests**

```ts
it('registers each signed Page entry with a namespaced identity and queues Facebook normalization', async () => {
  await request(app.getHttpServer())
    .post('/webhooks/meta')
    .set('x-hub-signature-256', sign(rawBody))
    .send(facebookFixture)
    .expect(200);
  expect(register).toHaveBeenCalledWith(expect.objectContaining({
    externalEventId: 'facebook:mid.facebook.1',
  }));
  expect(add).toHaveBeenCalledWith('facebook.normalize', expect.any(Object), expect.any(Object));
});
```

- [ ] **Step 2: Run webhook tests and confirm RED**

Run: `pnpm --filter @autosale/api test -- meta.controller.spec.ts meta-event.service.spec.ts`  
Expected: FAIL because `object: page` is rejected.

- [ ] **Step 3: Implement object-aware validation and dispatch**

Parse `instagram` and `page` into a discriminated union, verify every Page entry has an ID, prefix Facebook event IDs, resolve tenant through `api_facebook_tenant_for_page`, persist sanitized provider `META` payload, and enqueue only after durable registration. Invalid signatures remain 401; unsupported/malformed objects remain 400; frozen tenants return 200 without queueing.

- [ ] **Step 4: Add queue monitoring expectations and verify GREEN**

Run: `pnpm --filter @autosale/api test -- meta.controller.spec.ts meta-event.service.spec.ts admin-queue-monitor.spec.ts && pnpm --filter @autosale/api typecheck`  
Expected: PASS and existing Instagram webhook tests unchanged.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src/meta* apps/api/src/meta apps/api/src/queue apps/api/src/admin tests/fixtures/meta
git commit -m "feat(facebook): accept signed Page webhooks"
```

---

### Task 5: Extract shared ingestion and process Facebook messages

**Files:**
- Create: `apps/worker/src/social/normalized-inbound-message.ts`
- Create: `apps/worker/src/social/social-inbound-ingestion.service.ts`
- Create: `apps/worker/src/social/social-inbound-ingestion.service.spec.ts`
- Create: `apps/worker/src/facebook/facebook-normalizer.ts`
- Create: `apps/worker/src/facebook/facebook-normalizer.spec.ts`
- Create: `apps/worker/src/facebook/facebook.processor.ts`
- Create: `apps/worker/src/facebook/facebook.processor.spec.ts`
- Modify: `apps/worker/src/instagram/instagram-normalizer.ts`
- Modify: `apps/worker/src/instagram/instagram-normalizer.spec.ts`
- Modify: `apps/worker/src/instagram/instagram.processor.ts`
- Modify: `apps/worker/src/instagram/instagram.processor.spec.ts`
- Modify: `apps/worker/src/instagram/media-copy.service.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Produces `normalizeFacebookEvent(payload): NormalizedInboundMessage[]`.
- Produces `SocialInboundIngestionService.ingest(tenantId, rawEventId, message): Promise<{ messageId: string; created: boolean }>`.
- Existing `InstagramProcessor.process()` delegates persistence to the shared service without changing output.

- [ ] **Step 1: Write failing Facebook normalizer tests**

```ts
it('normalizes Page-scoped text and image messages', () => {
  expect(normalizeFacebookEvent(fixture)).toEqual([expect.objectContaining({
    channel: 'FACEBOOK', externalMessageId: 'mid.facebook.1',
    externalConversationId: 'psid-fictional-1', participantId: 'psid-fictional-1',
    direction: 'INBOUND', text: 'Хочу замовити двері',
    attachments: [{ type: 'IMAGE', sourceUrl: 'https://cdn.example.test/photo.jpg' }],
  })]);
});
```

- [ ] **Step 2: Run normalizer tests and confirm RED**

Run: `pnpm --filter @autosale/worker test -- facebook-normalizer.spec.ts`  
Expected: FAIL because the normalizer does not exist.

- [ ] **Step 3: Implement strict Facebook normalization**

Support text plus `image`, `video` and safe `fallback`/URL attachment payloads. Convert every other attachment into `UNSUPPORTED` with a safe `facebook:<type>` marker. Ignore delivery/read/postback/non-message events. Throw `MalformedSupportedEventError` only when a message event lacks MID, sender, recipient or finite timestamp.

- [ ] **Step 4: Write failing shared-ingestion idempotency tests**

```ts
it('creates one message and triggers one order evaluation across duplicate delivery', async () => {
  const first = await ingestion.ingest(tenantId, eventId, normalized);
  const second = await ingestion.ingest(tenantId, eventId, normalized);
  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(orderTrigger.processIfTriggered).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Run ingestion tests and confirm RED**

Run: `pnpm --filter @autosale/worker test -- social-inbound-ingestion.service.spec.ts facebook.processor.spec.ts instagram.processor.spec.ts`  
Expected: FAIL because shared ingestion is absent.

- [ ] **Step 6: Extract and implement shared persistence**

Move channel-neutral transaction logic from `InstagramProcessor` into `SocialInboundIngestionService`: upsert `(tenantId, channel, externalConversationId)`, create unique `(tenantId, channel, externalMessageId)`, create attachments, copy supported media and invoke the order trigger only after a newly persisted inbound message. Keep provider-specific profile enrichment outside this service.

Wire `FacebookProcessor` and the worker job switch:

```ts
if (job.name === 'instagram.normalize') return instagramProcessor.process(job.data.tenantId, job.data.eventId);
if (job.name === 'facebook.normalize') return facebookProcessor.process(job.data.tenantId, job.data.eventId);
```

Both processors honor lifecycle freeze and mark the durable raw event processed only after ingestion succeeds.

- [ ] **Step 7: Verify GREEN and Instagram regression**

Run: `pnpm --filter @autosale/worker test -- facebook-normalizer.spec.ts facebook.processor.spec.ts social-inbound-ingestion.service.spec.ts instagram-normalizer.spec.ts instagram.processor.spec.ts order-trigger.spec.ts && pnpm --filter @autosale/worker typecheck`  
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/worker/src/social apps/worker/src/facebook apps/worker/src/instagram apps/worker/src/main.ts
git commit -m "feat(facebook): ingest Messenger messages"
```

---

### Task 6: Make inbox and order recognition channel-aware

**Files:**
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/api/src/conversations/conversations.controller.ts`
- Modify: `apps/api/src/conversations/conversations.controller.spec.ts`
- Modify: `apps/worker/src/orders/order-trigger.ts`
- Modify: `apps/worker/src/orders/order-trigger.spec.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.spec.ts`
- Modify: `apps/worker/src/orders/openai-order-recognizer.ts`
- Modify: `apps/worker/src/orders/openai-order-recognizer.spec.ts`
- Modify: `apps/web/src/api/conversations.ts`
- Modify: `apps/web/src/components/conversation-list.tsx`
- Modify: `apps/web/src/components/conversation-list.spec.tsx`
- Modify: `apps/web/src/components/live-conversation-list.tsx`
- Modify: `apps/web/src/components/live-conversation-list.spec.tsx`
- Modify: `apps/web/src/components/message-thread.tsx`
- Modify: `apps/web/src/components/message-thread.spec.tsx`
- Modify: `apps/web/app/(workspace)/conversations/[id]/page.tsx`

**Interfaces:**
- Conversation list/detail returns `channel: 'INSTAGRAM' | 'FACEBOOK'`.
- Facebook detail returns `{ enabled: false, reason: 'CHANNEL_READ_ONLY' }` and never exposes the Instagram reply mutation.
- Order evaluation retains source channel and uses `social-order-v3` for new Facebook-triggered recognition while preserving stored Instagram versions.

- [ ] **Step 1: Write failing API/inbox tests**

```ts
it('lists Facebook conversations and keeps their reply capability read-only', async () => {
  const detail = await service.getConversation(tenantId, facebookConversationId);
  expect(detail.channel).toBe('FACEBOOK');
  expect(detail.replyCapability).toEqual({ enabled: false, reason: 'CHANNEL_READ_ONLY' });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts conversations.controller.spec.ts && pnpm --filter @autosale/web test -- conversation-list.spec.tsx live-conversation-list.spec.tsx message-thread.spec.tsx`  
Expected: FAIL because API filters and schemas are Instagram-only.

- [ ] **Step 3: Generalize read paths without widening write paths**

Remove `channel: 'INSTAGRAM'` from tenant-scoped list/detail reads, serialize the stored channel through the closed contract, calculate Facebook read-only capability, display `Instagram` or `Facebook` badges, and render the reply composer only when the detail capability and channel permit it.

- [ ] **Step 4: Write failing order-source test**

```ts
it('recognizes a Facebook inbound message without changing Instagram audit versions', async () => {
  await trigger.processIfTriggered(tenantId, facebookMessageId);
  expect(queue.add).toHaveBeenCalledWith('orders.recognize', expect.objectContaining({
    channel: 'FACEBOOK', promptVersion: 'social-order-v3',
  }), expect.any(Object));
});
```

- [ ] **Step 5: Run order tests and confirm RED**

Run: `pnpm --filter @autosale/worker test -- order-trigger.spec.ts triggered-order.processor.spec.ts openai-order-recognizer.spec.ts`  
Expected: FAIL because order input accepts only Instagram.

- [ ] **Step 6: Add provider-neutral source input**

Pass the closed social channel through trigger/evaluation/order creation. Use channel-neutral prompt wording for Facebook and new social evaluations; do not rewrite historical `instagram-order-v2` records or remove the exported legacy constant.

- [ ] **Step 7: Verify GREEN**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts conversations.controller.spec.ts && pnpm --filter @autosale/worker test -- order-trigger.spec.ts triggered-order.processor.spec.ts openai-order-recognizer.spec.ts && pnpm --filter @autosale/web test -- conversation-list.spec.tsx live-conversation-list.spec.tsx message-thread.spec.tsx`  
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/api/src/conversations apps/worker/src/orders apps/web/src/api/conversations.ts apps/web/src/components apps/web/app/'(workspace)'/conversations
git commit -m "feat(facebook): expose Messenger inbox conversations"
```

---

### Task 7: Add Facebook settings and localized onboarding state

**Files:**
- Create: `apps/web/src/components/facebook-settings-form.tsx`
- Create: `apps/web/src/components/facebook-settings-form.spec.tsx`
- Modify: `apps/web/src/components/social-channel-hub.tsx`
- Create: `apps/web/src/components/social-channel-hub.spec.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.spec.tsx`
- Modify: `apps/web/app/(workspace)/onboarding/page.tsx`
- Modify: `apps/web/app/(workspace)/onboarding/page.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- `FacebookSettingsForm` consumes safe `FacebookConnectionSummary`, role and optional Page candidates.
- `SocialChannelHub` consumes both Instagram and Facebook state; both rows start collapsed.

- [ ] **Step 1: Write failing component tests**

```tsx
it('keeps both channels collapsed and opens only Facebook on click', async () => {
  render(<SocialChannelHub instagram={instagram} facebook={facebook} membershipRole="OWNER" />);
  expect(screen.getByRole('button', { name: /Instagram/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: /Facebook/ })).toHaveAttribute('aria-expanded', 'false');
  await user.click(screen.getByRole('button', { name: /Facebook/ }));
  expect(screen.getByRole('button', { name: /Facebook/ })).toHaveAttribute('aria-expanded', 'true');
});

it('shows Page selection errors next to the selector and keeps the selected value', async () => {
  render(<FacebookSettingsForm initial={selectionRequired} membershipRole="OWNER" />);
  await user.click(screen.getByRole('button', { name: 'Підключити сторінку' }));
  expect(screen.getByLabelText('Сторінка Facebook')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Оберіть сторінку Facebook')).toBeVisible();
});
```

- [ ] **Step 2: Run web tests and confirm RED**

Run: `pnpm --filter @autosale/web test -- facebook-settings-form.spec.tsx social-channel-hub.spec.tsx page.spec.tsx`  
Expected: FAIL because Facebook settings UI does not exist.

- [ ] **Step 3: Implement settings UI with shared controls**

Load `/api/integrations/facebook` alongside Instagram. Show count `0..2 / 2`, Facebook mark `FB`, safe status, Page name and owner-only mutations. Use `LoadingButton` with explicit shared variants. The Page selector uses `FormField`, `FieldError`, `aria-invalid`, `aria-describedby`, first-invalid focus and edited-field error clearing. Return provider/outage failures at form level.

- [ ] **Step 4: Add translations and onboarding readiness**

Add exact Ukrainian/English channel, status, action and safe-error strings. Mark the onboarding sales-channel step ready when either Instagram or Facebook is active; Facebook stays optional and does not regress existing Instagram readiness.

- [ ] **Step 5: Verify GREEN, accessibility and mobile layout**

Run: `pnpm --filter @autosale/web test -- facebook-settings-form.spec.tsx social-channel-hub.spec.tsx page.spec.tsx && pnpm --filter @autosale/web typecheck`  
Expected: PASS with no default `<button>` styling exceptions or validation contract failures.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/components apps/web/app/'(workspace)'/settings apps/web/app/'(workspace)'/onboarding apps/web/src/i18n apps/web/app/globals.css
git commit -m "feat(facebook): add Page connection settings"
```

---

### Task 8: Complete acceptance, documentation, deployment and branch cleanup

**Files:**
- Create: `docs/integrations/meta-facebook-messenger.md`
- Modify: `docs/features/README.md`
- Modify: `docs/acceptance/mvp-checklist.md`
- Modify: `docs/integrations/meta-access.md`
- Modify: `docs/operations/deployment.md`
- Modify: `README.md`
- Create: `tests/e2e/facebook-messenger-inbound.spec.ts`
- Modify: `tests/e2e/conversation-inbox.spec.ts`
- Modify: `apps/web/src/marketing/components/home-page.tsx`
- Modify: `apps/web/src/marketing/content/integrations.ts`

**Interfaces:**
- Documents exact Meta app redirect/callback URLs, permissions, Page subscription, feature flag, test evidence and recovery.
- Changes public capability status only to **Validation pending**, never **Available**, until live acceptance passes.

- [ ] **Step 1: Write failing E2E scenarios**

```ts
test('owner sees Facebook settings and a signed Page message exactly once', async ({ page, request }) => {
  await connectFictionalFacebookPage(request);
  await postSignedMetaFixture(request, 'facebook-text-message.json');
  await postSignedMetaFixture(request, 'facebook-text-message.json');
  await page.goto('/conversations');
  await expect(page.getByText('Facebook')).toBeVisible();
  await expect(page.getByText('Хочу замовити тестовий товар')).toHaveCount(1);
});
```

Add 1440 px and 390x844 settings/inbox checks, keyboard accordion/Page selector flow, manager read-only state, invalid signature, frozen tenant and duplicate order-trigger scenarios. Fixtures use only fictional Pages, PSIDs, messages and media URLs.

- [ ] **Step 2: Run E2E and confirm RED before final wiring**

Run: `pnpm test:e2e --grep "Facebook Messenger"`  
Expected: FAIL at the first unavailable Facebook flow assertion.

- [ ] **Step 3: Finish wiring and canonical documentation**

Document:

- callback `${APP_PUBLIC_URL}/webhooks/meta`;
- redirect `${APP_PUBLIC_URL}/api/integrations/facebook/callback`;
- requested permissions and Page role requirement;
- `FACEBOOK_MESSENGER_ENABLED` rollback;
- safe reconnect/disconnect/cleanup steps;
- live acceptance evidence rules excluding tokens, message text and provider IDs.

Update the feature map to **Validation pending** with actual source/test entry points. Change marketing Facebook status from “in development” only to wording that explicitly says connection is in controlled validation; do not claim general availability.

- [ ] **Step 4: Run targeted and complete verification**

Run:

```powershell
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/config test
pnpm --filter @autosale/integrations test
pnpm --filter @autosale/database test
pnpm --filter @autosale/api test
pnpm --filter @autosale/worker test
pnpm --filter @autosale/web test
pnpm typecheck
pnpm build
pnpm test:e2e --grep "Facebook Messenger|conversation inbox"
git diff --check
```

Expected: all commands PASS; no staged `.env`, credential, build output, dump, runtime token/PID or production personal data.

- [ ] **Step 5: Apply migration and deploy manually with the flag disabled**

Follow `docs/operations/deployment.md`: back up, build images, run migrations, start services, verify API/web/worker health and existing Instagram callback, then inspect sanitized logs. Leave `FACEBOOK_MESSENGER_ENABLED=false` until the Meta app configuration and controlled Page are ready.

- [ ] **Step 6: Commit implementation evidence**

```powershell
git add docs README.md tests/e2e apps/web/src/marketing
git commit -m "docs(facebook): add Messenger rollout runbook"
```

- [ ] **Step 7: Merge, push and clean the short-lived branch**

```powershell
git status --short
git switch master
git merge --ff-only codex/facebook-messenger-inbound
git push origin master
git branch -d codex/facebook-messenger-inbound
git status --short --branch
```

Before deleting the branch, prove that all intended tracked changes are reachable from `master` and that `artifacts/` or any other pre-existing untracked user files remain untouched.

- [ ] **Step 8: Run live Meta acceptance when external approval is ready**

Enable the flag only for the controlled test window, connect one test Page, receive one text and one image once, verify one eligible order trigger, reconnect, disconnect and inspect sanitized evidence. Mark the feature **Available** only after permissions/Advanced Access and all live checks in the spec pass.
