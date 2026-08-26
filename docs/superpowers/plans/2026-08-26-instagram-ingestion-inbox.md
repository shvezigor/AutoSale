# Instagram Ingestion and Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable Docker-based vertical slice that receives authenticated Instagram webhook messages, stores normalized conversations and media exactly once, and displays them in a manager inbox.

**Architecture:** A NestJS API validates and durably records Meta callbacks, then enqueues normalization work in BullMQ. A separate worker stores normalized records in PostgreSQL and copies media to MinIO through an S3-compatible adapter. A Next.js frontend reads conversations through a documented manager API.

**Tech Stack:** TypeScript, pnpm workspaces, NestJS, Next.js, PostgreSQL, Prisma, Redis, BullMQ, MinIO, Caddy, Zod, Vitest, Supertest, Playwright, Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-26-instagram-order-capture-design.md`

## Global Constraints

- The default deployment must run on a generic Linux Docker host through Docker Compose.
- PostgreSQL is the system of record; Redis and MinIO are replaceable adapters.
- Every business record carries `tenant_id`, although this plan configures one tenant.
- Only official Meta APIs are supported; no browser scraping or personal-account automation.
- Webhook handling must be signature-verified, deduplicated, durable, and fast.
- Media must be copied to controlled S3-compatible storage before source URLs expire.
- Secrets must not be committed, logged, or baked into images.
- Application containers run as non-root users.
- Each task is implemented test-first and committed independently.

## External Preconditions

Before Task 3 can pass staging verification, the owner must provide a test Instagram Professional account, Meta app ID, app secret, access token, webhook verify token, and permission to configure the callback URL. Unit and integration work uses sanitized fixtures until those resources are available.

## File Map

```text
apps/api/src/
  app.module.ts                         root API module
  main.ts                               Nest bootstrap and raw-body capture
  health/health.controller.ts           liveness/readiness endpoint
  meta/meta.controller.ts               webhook verification and callback
  meta/meta-signature.service.ts        X-Hub-Signature-256 validation
  meta/meta-event.service.ts            durable event registration
  conversations/conversations.*         manager conversation query API
apps/worker/src/
  main.ts                               worker bootstrap
  instagram/instagram.processor.ts      queued event normalization
  instagram/media-copy.service.ts       remote media to object storage
apps/web/app/
  conversations/page.tsx                inbox route
  conversations/[id]/page.tsx           conversation detail route
apps/web/src/
  api/conversations.ts                  typed API client
  components/conversation-list.tsx      inbox list
  components/message-thread.tsx         text/media timeline
packages/contracts/src/
  meta.ts                               inbound fixture-safe schemas
  conversations.ts                      manager API schemas/types
packages/database/
  prisma/schema.prisma                  tenant/event/conversation/message data
  src/client.ts                         shared Prisma client factory
packages/integrations/src/
  object-storage.ts                     storage interface
  s3-object-storage.ts                  MinIO/S3 implementation
packages/config/src/
  api-env.ts                            API environment schema
  worker-env.ts                         worker environment schema
tests/fixtures/meta/
  text-message.json                     sanitized Meta text callback
  image-message.json                    sanitized Meta image callback
tests/e2e/
  conversation-inbox.spec.ts            browser acceptance flow
compose.yaml                             portable runtime topology
Dockerfile                              targeted production images
pnpm-workspace.yaml                      workspace definition
package.json                             root scripts/tooling
```

---

### Task 1: Containerized Monorepo Health Slice

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `compose.yaml`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.controller.spec.ts`
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/main.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/app/page.tsx`
- Create: `packages/config/package.json`
- Create: `packages/config/src/api-env.ts`
- Create: `packages/config/src/worker-env.ts`
- Test: `apps/api/src/health/health.controller.spec.ts`

**Interfaces:**
- Consumes: Docker Engine and environment variables documented in `.env.example`.
- Produces: `GET /health/live -> { status: "ok" }`, typed `parseApiEnv(input)` and `parseWorkerEnv(input)`, and healthy Compose services named `proxy`, `web`, `api`, `worker`, `postgres`, `redis`, and `minio`.

- [ ] **Step 1: Write the failing health-controller test**

```ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports a live process', () => {
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the scaffold is absent**

Run: `pnpm --filter api test health.controller.spec.ts`

Expected: FAIL because the workspace and `HealthController` do not exist.

- [ ] **Step 3: Create root workspace files and package scripts**

Use these root scripts:

```json
{
  "name": "autosale",
  "private": true,
  "packageManager": "pnpm@10.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "dev": "docker compose up --build",
    "db:migrate": "pnpm --filter @autosale/database prisma migrate deploy"
  }
}
```

Set `pnpm-workspace.yaml` packages to `apps/*` and `packages/*`. Set strict TypeScript options in `tsconfig.base.json`, including `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

- [ ] **Step 4: Implement the minimal API health slice**

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

Register the controller in `AppModule`; bootstrap Nest on `0.0.0.0` using `PORT`. Create a worker bootstrap that starts and remains healthy without processing jobs. Create a minimal Next.js home page that links to `/conversations`.

- [ ] **Step 5: Add strict environment parsing**

Define Zod schemas requiring:

```ts
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  META_VERIFY_TOKEN: z.string().min(24),
  META_APP_SECRET: z.string().min(16),
});
```

The worker schema additionally requires `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Do not print parsed values.

- [ ] **Step 6: Define the Compose topology**

Expose only Caddy HTTP/HTTPS ports publicly. Keep PostgreSQL, Redis, and MinIO on an internal network. Add named volumes `postgres_data`, `redis_data`, and `minio_data`; health checks; restart policies; and non-root application image users. Mount secrets/environment at runtime rather than copying `.env` into an image.

- [ ] **Step 7: Run tests and the clean container build**

Run:

```powershell
pnpm install
pnpm --filter api test health.controller.spec.ts
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

Expected: focused test PASS, Compose config valid, all services healthy, `/health/live` returns `{"status":"ok"}` through Caddy.

- [ ] **Step 8: Commit the health slice**

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json compose.yaml Dockerfile .dockerignore .env.example apps packages/config
git commit -m "build: scaffold portable application stack"
```

---

### Task 2: Durable Webhook Event Model

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/prisma/schema.prisma`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/index.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/meta.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `apps/api/src/meta/meta-event.service.ts`
- Create: `apps/api/src/meta/meta-event.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/meta/meta-event.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaClient`, configured single `tenantId`, and `RegisterMetaEventInput`.
- Produces: `MetaEventService.register(input): Promise<{ eventId: string; duplicate: boolean }>` and durable `WebhookEvent` rows.

- [ ] **Step 1: Write the failing idempotency test**

```ts
it('returns the existing event when the same Meta event is replayed', async () => {
  const first = await service.register(fixture);
  const replay = await service.register(fixture);

  expect(replay).toEqual({ eventId: first.eventId, duplicate: true });
  expect(await prisma.webhookEvent.count()).toBe(1);
});
```

Use a disposable PostgreSQL database, not an in-memory repository, because uniqueness behavior is part of the contract.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter api test meta-event.service.spec.ts`

Expected: FAIL because schema and service are absent.

- [ ] **Step 3: Define the minimal Prisma schema**

```prisma
model Tenant {
  id        String   @id @default(uuid())
  key       String   @unique
  name      String
  createdAt DateTime @default(now())
  events    WebhookEvent[]
}

model WebhookEvent {
  id              String   @id @default(uuid())
  tenantId        String
  provider        String
  externalEventId String
  payload         Json
  status          String   @default("RECEIVED")
  receivedAt      DateTime @default(now())
  processedAt     DateTime?
  tenant          Tenant   @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, provider, externalEventId])
  @@index([status, receivedAt])
}
```

Create and commit the initial migration. Seed one tenant using an explicit `DEFAULT_TENANT_KEY`.

- [ ] **Step 4: Define a fixture-safe event contract**

```ts
export const registerMetaEventSchema = z.object({
  tenantId: z.string().uuid(),
  externalEventId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type RegisterMetaEventInput = z.infer<typeof registerMetaEventSchema>;
```

- [ ] **Step 5: Implement register with database uniqueness**

Create the row once. Catch only Prisma unique-constraint error `P2002`; query and return the existing row with `duplicate: true`. Re-throw every other database error.

- [ ] **Step 6: Run migration and tests**

Run:

```powershell
pnpm --filter @autosale/database prisma migrate dev --name init_webhook_events
pnpm --filter api test meta-event.service.spec.ts
```

Expected: migration succeeds; first call returns `duplicate: false`; replay returns `duplicate: true`; count is one.

- [ ] **Step 7: Commit the durable event model**

```powershell
git add packages/database packages/contracts apps/api/src/meta apps/api/src/app.module.ts
git commit -m "feat: persist webhook events idempotently"
```

---

### Task 3: Authenticated Meta Webhook Intake

**Files:**
- Create: `apps/api/src/meta/meta-signature.service.ts`
- Create: `apps/api/src/meta/meta-signature.service.spec.ts`
- Create: `apps/api/src/meta/meta.controller.ts`
- Create: `apps/api/src/meta/meta.controller.spec.ts`
- Create: `apps/api/src/meta/meta.module.ts`
- Create: `apps/api/src/queue/queue.module.ts`
- Create: `tests/fixtures/meta/text-message.json`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/meta/meta-signature.service.spec.ts`
- Test: `apps/api/src/meta/meta.controller.spec.ts`

**Interfaces:**
- Consumes: raw request bytes, `X-Hub-Signature-256`, `hub.mode`, `hub.verify_token`, `hub.challenge`, and `MetaEventService.register`.
- Produces: `MetaSignatureService.verify(rawBody: Buffer, header: string): boolean`, `GET /webhooks/meta`, `POST /webhooks/meta`, and BullMQ jobs named `instagram.normalize` with `{ eventId: string }`.

- [ ] **Step 1: Write signature tests**

```ts
it('accepts the matching sha256 signature', () => {
  const body = Buffer.from('{"object":"instagram"}');
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  expect(service.verify(body, signature)).toBe(true);
});

it('rejects a malformed or mismatched signature', () => {
  expect(service.verify(Buffer.from('{}'), 'sha256=00')).toBe(false);
});
```

- [ ] **Step 2: Run signature tests and verify failure**

Run: `pnpm --filter api test meta-signature.service.spec.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement timing-safe signature verification**

Compute the HMAC over the untouched raw bytes. Require the exact `sha256=` prefix, equal digest lengths, and compare with `timingSafeEqual`. Return `false` for malformed headers without throwing.

- [ ] **Step 4: Write controller tests**

Cover these exact cases:

```ts
await request(app.getHttpServer())
  .get('/webhooks/meta')
  .query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '1234' })
  .expect(200, '1234');

await request(app.getHttpServer())
  .post('/webhooks/meta')
  .set('X-Hub-Signature-256', validSignature)
  .send(fixture)
  .expect(200, { received: true });
```

Also assert invalid verify token returns 403, invalid signature returns 401, replay returns 200, and only the first delivery enqueues a job.

- [ ] **Step 5: Enable raw-body capture and implement the controller**

Bootstrap Nest with raw-body support. Derive a stable event identity from the message `mid` when present; otherwise hash the canonical provider payload plus tenant and event timestamp. Register durably before enqueueing. Enqueue only when `duplicate` is false.

- [ ] **Step 6: Run focused and API tests**

Run:

```powershell
pnpm --filter api test meta-signature.service.spec.ts
pnpm --filter api test meta.controller.spec.ts
pnpm --filter api test
```

Expected: all PASS; invalid callbacks never create a database row or job.

- [ ] **Step 7: Perform the staging webhook check**

Expose the Caddy HTTPS endpoint, configure the Meta callback, complete the challenge, and send a message from a test Instagram user. Save only event IDs, timestamps, and redacted evidence in `docs/integrations/meta-access.md`.

- [ ] **Step 8: Commit authenticated intake**

```powershell
git add apps/api tests/fixtures/meta docs/integrations/meta-access.md
git commit -m "feat: receive authenticated Meta webhooks"
```

---

### Task 4: Instagram Normalization and Media Copy

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/integrations/package.json`
- Create: `packages/integrations/src/object-storage.ts`
- Create: `packages/integrations/src/s3-object-storage.ts`
- Create: `packages/integrations/src/index.ts`
- Create: `apps/worker/src/instagram/instagram-normalizer.ts`
- Create: `apps/worker/src/instagram/instagram-normalizer.spec.ts`
- Create: `apps/worker/src/instagram/media-copy.service.ts`
- Create: `apps/worker/src/instagram/media-copy.service.spec.ts`
- Create: `apps/worker/src/instagram/instagram.processor.ts`
- Create: `tests/fixtures/meta/image-message.json`
- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/src/instagram/instagram-normalizer.spec.ts`
- Test: `apps/worker/src/instagram/media-copy.service.spec.ts`

**Interfaces:**
- Consumes: stored `WebhookEvent`, fixture-compatible Meta payload, `ObjectStorage.put`, and HTTP media responses.
- Produces: `normalizeInstagramEvent(payload): NormalizedInstagramMessage[]`, durable `Conversation`, `Message`, and `Attachment` records, and `ObjectStorage.put(input): Promise<{ key: string; etag: string }>`.

- [ ] **Step 1: Write normalizer tests for text and image fixtures**

```ts
expect(normalizeInstagramEvent(textFixture)).toEqual([
  expect.objectContaining({
    externalMessageId: 'm_text_001',
    externalConversationId: 'ig-user-100',
    direction: 'INBOUND',
    text: 'Хочу чорну модель 38 розміру',
    attachments: [],
  }),
]);
```

For the image fixture, assert one `IMAGE` attachment with its source URL and no invented text.

- [ ] **Step 2: Run normalizer tests and verify failure**

Run: `pnpm --filter worker test instagram-normalizer.spec.ts`

Expected: FAIL because the normalizer is absent.

- [ ] **Step 3: Extend the database schema**

Add `Conversation`, `Message`, and `Attachment` models. Enforce:

```prisma
@@unique([tenantId, channel, externalConversationId])
@@unique([tenantId, channel, externalMessageId])
```

Store message direction, sender identity, text, source timestamp, raw-event relation, attachment type, original URL, storage key, checksum, copy status, and failure summary.

- [ ] **Step 4: Implement pure payload normalization**

Parse supported messaging entries into channel-neutral values. Ignore unsupported event types without treating the webhook as failed. Throw a typed `MalformedSupportedEventError` when a supported message lacks its required identity.

- [ ] **Step 5: Write object-storage and media-copy tests**

Use a fake `ObjectStorage` and mocked HTTP client. Assert:

```ts
expect(storage.put).toHaveBeenCalledWith({
  key: expect.stringMatching(/^tenants\/[^/]+\/instagram\/sha256\//),
  body: expect.any(Uint8Array),
  contentType: 'image/jpeg',
});
```

Also assert maximum response size, allowed MIME types, request timeout, checksum reuse, and retryable failure classification.

- [ ] **Step 6: Implement the storage boundary and media copy**

Define:

```ts
export interface ObjectStorage {
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<{ key: string; etag: string }>;
}
```

The S3 implementation uses path-style access when configured for MinIO. Media copy streams with a byte ceiling, checks `Content-Type`, computes SHA-256, and records success only after storage confirms the object.

- [ ] **Step 7: Implement the BullMQ processor transaction boundaries**

For each normalized message: upsert the conversation, create the message under its unique external ID, and create pending attachments in a database transaction. Copy each attachment after the transaction, then update its copy status. Mark the source event `PROCESSED` only after every supported message is durable; failed media remains separately retryable.

- [ ] **Step 8: Run migration, tests, and duplicate replay check**

Run:

```powershell
pnpm --filter @autosale/database prisma migrate dev --name conversations_messages
pnpm --filter worker test instagram-normalizer.spec.ts
pnpm --filter worker test media-copy.service.spec.ts
pnpm --filter worker test
```

Process the same event twice and query PostgreSQL: one message and one controlled media object must exist.

- [ ] **Step 9: Commit normalization and media storage**

```powershell
git add packages/database packages/integrations apps/worker tests/fixtures/meta/image-message.json
git commit -m "feat: normalize Instagram messages and media"
```

---

### Task 5: Manager Conversation API

**Files:**
- Create: `packages/contracts/src/conversations.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/conversations/conversations.service.ts`
- Create: `apps/api/src/conversations/conversations.service.spec.ts`
- Create: `apps/api/src/conversations/conversations.controller.ts`
- Create: `apps/api/src/conversations/conversations.controller.spec.ts`
- Create: `apps/api/src/conversations/conversations.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/conversations/conversations.service.spec.ts`
- Test: `apps/api/src/conversations/conversations.controller.spec.ts`

**Interfaces:**
- Consumes: authenticated configured tenant and normalized database records.
- Produces: `GET /api/conversations?cursor=&limit=`, `GET /api/conversations/:id`, `ConversationListResponse`, and `ConversationDetailResponse` validated by shared Zod schemas.

- [ ] **Step 1: Define response contracts and write query tests**

```ts
export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  channel: z.literal('INSTAGRAM'),
  participantName: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().datetime(),
});
```

Test stable descending ordering, tenant isolation, cursor pagination, a 50-item maximum, and not-found behavior.

- [ ] **Step 2: Run service tests and verify failure**

Run: `pnpm --filter api test conversations.service.spec.ts`

Expected: FAIL because service and schemas are absent.

- [ ] **Step 3: Implement cursor-based query service**

Use `(lastMessageAt, id)` as the stable cursor. Always filter by `tenantId`. Detail output includes ordered messages and attachments; it exposes an application media URL, never raw MinIO credentials.

- [ ] **Step 4: Write and implement controller contract tests**

Test:

```ts
await request(app.getHttpServer())
  .get('/api/conversations?limit=20')
  .expect(200)
  .expect(({ body }) => conversationListResponseSchema.parse(body));
```

Assert malformed cursors return 400, unknown IDs return 404, and no data from another tenant is returned.

- [ ] **Step 5: Publish OpenAPI and run API tests**

Run:

```powershell
pnpm --filter api test conversations
pnpm --filter api build
```

Expected: tests PASS; generated OpenAPI includes both conversation endpoints and documented response models.

- [ ] **Step 6: Commit manager conversation API**

```powershell
git add packages/contracts apps/api/src/conversations apps/api/src/app.module.ts
git commit -m "feat: expose manager conversation API"
```

---

### Task 6: Manager Inbox Web Interface

**Files:**
- Create: `apps/web/src/api/conversations.ts`
- Create: `apps/web/src/components/conversation-list.tsx`
- Create: `apps/web/src/components/message-thread.tsx`
- Create: `apps/web/app/conversations/page.tsx`
- Create: `apps/web/app/conversations/loading.tsx`
- Create: `apps/web/app/conversations/error.tsx`
- Create: `apps/web/app/conversations/[id]/page.tsx`
- Create: `apps/web/src/components/conversation-list.spec.tsx`
- Create: `apps/web/src/components/message-thread.spec.tsx`
- Create: `tests/e2e/conversation-inbox.spec.ts`
- Modify: `apps/web/app/page.tsx`
- Test: `apps/web/src/components/conversation-list.spec.tsx`
- Test: `apps/web/src/components/message-thread.spec.tsx`
- Test: `tests/e2e/conversation-inbox.spec.ts`

**Interfaces:**
- Consumes: `ConversationListResponse` and `ConversationDetailResponse` from `@autosale/contracts` and the manager conversation API.
- Produces: accessible `/conversations` list and `/conversations/[id]` message timeline with controlled media rendering.

- [ ] **Step 1: Write component tests**

```tsx
render(<ConversationList conversations={[fixtureSummary]} />);
expect(screen.getByRole('link', { name: /Олена/i })).toHaveAttribute(
  'href',
  `/conversations/${fixtureSummary.id}`,
);
```

For `MessageThread`, assert inbound/outbound labels, localized timestamp, text, image alt text, and a visible attachment failure state.

- [ ] **Step 2: Run component tests and verify failure**

Run: `pnpm --filter web test conversation-list.spec.tsx message-thread.spec.tsx`

Expected: FAIL because components are absent.

- [ ] **Step 3: Implement the schema-validating API client**

Fetch with a server-side base URL, disable accidental static caching for the operational inbox, parse every response with the shared Zod schema, and convert non-2xx or invalid data into typed errors.

- [ ] **Step 4: Implement list and detail pages**

Use semantic headings, links, ordered message content, keyboard-accessible navigation, explicit loading/error/empty states, and responsive layouts. Render media through the controlled application URL with constrained dimensions. Do not expose provider IDs as the main user-facing label.

- [ ] **Step 5: Run component tests and production build**

Run:

```powershell
pnpm --filter web test
pnpm --filter web build
```

Expected: tests PASS and Next.js production build succeeds without hydration or type errors.

- [ ] **Step 6: Write the browser acceptance test**

```ts
test('manager opens an Instagram conversation with a photo', async ({ page }) => {
  await page.goto('/conversations');
  await page.getByRole('link', { name: /Олена/i }).click();
  await expect(page.getByText('Хочу чорну модель 38 розміру')).toBeVisible();
  await expect(page.getByRole('img', { name: /вкладення з Instagram/i })).toBeVisible();
});
```

Seed the fixture conversation through the webhook HTTP boundary, not direct database insertion, so the test covers the vertical slice.

- [ ] **Step 7: Run full vertical-slice verification**

Run:

```powershell
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/conversation-inbox.spec.ts
docker compose build
docker compose up -d
docker compose ps
```

Expected: all tests and builds PASS; every container is healthy; the seeded text/photo is visible exactly once.

- [ ] **Step 8: Commit the manager inbox**

```powershell
git add apps/web tests/e2e
git commit -m "feat: display Instagram conversation inbox"
```

---

## Plan Completion Checkpoint

- [ ] `git status --short` shows no unintended changes.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] `docker compose build` passes.
- [ ] All Compose services become healthy from a clean start.
- [ ] Meta challenge and a real test message succeed when credentials are available.
- [ ] Duplicate fixture delivery creates one event, one message, and one media object.
- [ ] Playwright demonstrates webhook-to-inbox behavior.
- [ ] No secret appears in Git history, application logs, or image layers.

## Follow-on Plans

After this plan is accepted and verified, create separate implementation plans for:

1. Catalogue import, order trigger, AI extraction, matching, and manager approval.
2. Google service-account configuration, header mapping, idempotent row synchronization, reconciliation, and retry UI.
3. Observability, backup/restore, deployment hardening, and full MVP acceptance.

