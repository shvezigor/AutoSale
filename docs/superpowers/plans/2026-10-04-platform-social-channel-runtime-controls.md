# Platform Social-Channel Runtime Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited platform-admin controls that can safely enable or pause Facebook Messenger and TikTok Business Messaging without exposing credentials, deleting tenant data, disrupting Instagram, or causing duplicate provider sends.

**Architecture:** PostgreSQL stores one fail-closed runtime flag per controlled channel. A shared `PlatformChannelGate` combines that flag with immutable deployment availability derived from existing environment configuration; API and worker boundaries read the gate immediately before durable or provider side effects. The admin API owns mutation and atomic security auditing, while the admin and tenant interfaces render strict privacy-safe state contracts.

**Tech Stack:** TypeScript, Prisma 7/PostgreSQL, NestJS 11, Next.js 16/React 19, BullMQ 5, Zod 4, Vitest/Testing Library, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-04-platform-social-channel-runtime-controls-design.md`

## Global Constraints

- The controlled keys are exactly `FACEBOOK_MESSENGER` and `TIKTOK_BUSINESS_MESSAGING`.
- Effective availability is exactly `deploymentAvailable && runtimeEnabled`; a missing database row is disabled.
- Existing `FACEBOOK_MESSENGER_ENABLED` and `TIKTOK_BUSINESS_MESSAGING_ENABLED` environment flags remain the deployment-level safety ceiling.
- Disabling preserves credentials, connections, conversations, messages and audit history.
- Facebook runtime control must never change Instagram verification, ingestion, normalization or delivery.
- Webhook signatures and provider verification handshakes remain active while runtime processing is paused.
- A paused worker must not claim a TikTok outbound message, increment its attempts, mark it failed or call the provider.
- Admin responses contain no credentials, environment-variable values, provider ids, tenant ids, connection counts or customer data.
- Use only shared `primary-button`, `secondary-button`, `danger-button`, `text-button` and `icon-button` variants; async actions use `LoadingButton`.
- All displayed copy is available in Ukrainian and English, and the 390 px layout must have no unintended horizontal overflow.
- Never commit `.env`, credentials, tokens, database dumps, runtime files, build output or production personal data; fixtures are fictional.

## File Map

### Shared contracts and persistence

- `packages/contracts/src/auth.ts` — strict admin integration schemas and inferred types.
- `packages/contracts/src/auth.spec.ts` — reject unknown keys, states and sensitive extra fields.
- `packages/contracts/src/facebook.ts` and `packages/contracts/src/tiktok.ts` — expose safe platform availability in tenant connection summaries.
- `packages/database/prisma/schema.prisma` — `PlatformFeatureFlag` model and optional updater relation.
- `packages/database/prisma/migrations/20261004150000_platform_social_channel_flags/migration.sql` — table, constraints, indexes and runtime-role grants.
- `packages/database/src/platform-channel-gate.ts` — shared fresh-read effective-state service and typed errors.
- `packages/database/src/platform-channel-gate.spec.ts` — fail-closed and deployment-ceiling unit contract.
- `packages/database/src/platform-channel-flags.postgres.spec.ts` — real migration, role access and atomic audit coverage.
- `packages/database/src/index.ts` — public exports.

### API boundaries

- `apps/api/src/admin/admin-integration.service.ts` and `.spec.ts` — list and atomically mutate platform state.
- `apps/api/src/admin/admin.controller.ts`, `.spec.ts`, `admin.module.ts` — platform-admin GET/PATCH routes.
- `apps/api/src/integrations/facebook-oauth.service.ts`, `.spec.ts`, `facebook-oauth.module.ts` — fresh OAuth start/callback/selection gates and summary state.
- `apps/api/src/integrations/tiktok-oauth.service.ts`, `.spec.ts`, `tiktok-oauth.module.ts` — fresh OAuth start/callback gates and summary state.
- `apps/api/src/meta/meta-event.service.ts`, `.spec.ts`, `meta.module.ts` — Facebook-only runtime gate after signed Meta classification.
- `apps/api/src/tiktok/tiktok-event.service.ts`, `.spec.ts`, `tiktok.module.ts` — TikTok runtime gate after signature validation.
- `apps/api/src/conversations/conversations.service.ts`, `.spec.ts`, `conversations.module.ts` — reject new TikTok sends/retries while paused.

### Worker boundaries

- `apps/worker/src/main.ts` — construct one gate and apply it to runtime processing/reconciliation.
- `apps/worker/src/instagram/instagram-event-reconciler.ts`, `.spec.ts` — skip paused Facebook/TikTok recovery while leaving Instagram unchanged.
- `apps/worker/src/tiktok/tiktok-message-delivery.service.ts`, `.spec.ts` — gate before leasing or provider calls.
- `apps/worker/src/tiktok/tiktok-message-reconciler.ts`, `.spec.ts` — preserve unknown fencing and skip paused pending wakeups.

### Web UI

- `apps/web/app/admin/integrations/page.tsx` — server-loaded admin integrations route.
- `apps/web/src/components/admin-integrations.tsx`, `.spec.tsx` — localized controls, confirmation and safe failures.
- `apps/web/src/components/admin-shell.tsx`, `.spec.tsx`, `admin-copy.ts` — Integrations navigation and copy.
- `apps/web/src/components/facebook-settings-form.tsx`, `.spec.tsx` — tenant unavailable state.
- `apps/web/src/components/tiktok-settings-form.tsx`, `.spec.tsx` — tenant unavailable state.
- `apps/web/src/i18n/messages/uk.ts`, `en.ts` — tenant-facing platform availability copy.
- `apps/web/app/globals.css` — admin control layout and responsive styling.
- `apps/web/src/components/button-style-contract.spec.ts` — protect shared button variants.

### Acceptance and documentation

- `tests/e2e/admin-integrations.spec.ts` — desktop/mobile navigation and mutation acceptance.
- `docs/features/README.md` — implementation status and source ownership.
- `docs/superpowers/specs/2026-10-04-platform-social-channel-runtime-controls-design.md` — release evidence and final status.
- `docs/integrations/meta-facebook-messenger.md` and `docs/integrations/tiktok-business-messaging.md` — operator behavior and recovery notes.

---

### Task 1: Strict contracts for admin and tenant-visible availability

**Files:**
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/auth.spec.ts`
- Modify: `packages/contracts/src/facebook.ts`
- Modify: `packages/contracts/src/facebook.spec.ts`
- Modify: `packages/contracts/src/tiktok.ts`
- Modify: `packages/contracts/src/tiktok.spec.ts`

**Interfaces:**
- Produces: `AdminIntegrationKey`, `AdminIntegrationControl`, `AdminIntegrationUpdate`; `adminIntegrationKeySchema`, `adminIntegrationControlSchema`, `adminIntegrationListSchema`, `adminIntegrationUpdateSchema`.
- Produces: `platformAvailability: 'AVAILABLE' | 'ADMIN_DISABLED' | 'DEPLOYMENT_UNAVAILABLE'` on Facebook and TikTok connection summaries.

- [ ] **Step 1: Add failing strict-schema tests**

Add contract assertions equivalent to:

```ts
const active = {
  key: 'FACEBOOK_MESSENGER',
  deploymentAvailable: true,
  runtimeEnabled: true,
  effectiveEnabled: true,
  state: 'ACTIVE',
  updatedAt: '2026-10-04T10:00:00.000Z',
};
expect(adminIntegrationControlSchema.parse(active)).toEqual(active);
expect(() => adminIntegrationControlSchema.parse({ ...active, secret: 'never-return-this' })).toThrow();
expect(() => adminIntegrationUpdateSchema.parse({ enabled: true, key: 'OTHER' })).toThrow();
```

Extend the Facebook and TikTok fixtures with `platformAvailability`, and prove unknown values and extra fields fail.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `pnpm --filter @autosale/contracts test -- src/auth.spec.ts src/facebook.spec.ts src/tiktok.spec.ts`

Expected: failure because the admin schemas and summary field do not exist.

- [ ] **Step 3: Implement the schemas and types**

Add these strict shapes:

```ts
export const adminIntegrationKeySchema = z.enum([
  'FACEBOOK_MESSENGER',
  'TIKTOK_BUSINESS_MESSAGING',
]);
export const adminIntegrationStateSchema = z.enum([
  'ACTIVE',
  'ADMIN_DISABLED',
  'DEPLOYMENT_UNAVAILABLE',
]);
export const adminIntegrationControlSchema = z.object({
  key: adminIntegrationKeySchema,
  deploymentAvailable: z.boolean(),
  runtimeEnabled: z.boolean(),
  effectiveEnabled: z.boolean(),
  state: adminIntegrationStateSchema,
  updatedAt: z.string().datetime().nullable(),
}).strict();
export const adminIntegrationListSchema = z.array(adminIntegrationControlSchema).length(2);
export const adminIntegrationUpdateSchema = z.object({ enabled: z.boolean() }).strict();
```

Add one reusable `platformIntegrationAvailabilitySchema` enum to the provider contracts and infer exported types.

- [ ] **Step 4: Run focused tests and typecheck contracts**

Run: `pnpm --filter @autosale/contracts test -- src/auth.spec.ts src/facebook.spec.ts src/tiktok.spec.ts`

Run: `pnpm --filter @autosale/contracts typecheck`

Expected: all pass.

- [ ] **Step 5: Commit the contract increment**

```bash
git add packages/contracts/src/auth.ts packages/contracts/src/auth.spec.ts packages/contracts/src/facebook.ts packages/contracts/src/facebook.spec.ts packages/contracts/src/tiktok.ts packages/contracts/src/tiktok.spec.ts
git commit -m "feat: define social channel control contracts"
```

### Task 2: Fail-closed database gate and least-privilege migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261004150000_platform_social_channel_flags/migration.sql`
- Create: `packages/database/src/platform-channel-gate.ts`
- Create: `packages/database/src/platform-channel-gate.spec.ts`
- Create: `packages/database/src/platform-channel-flags.postgres.spec.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/runtime-database-roles.postgres.spec.ts`

**Interfaces:**
- Consumes: `AdminIntegrationKey` and `AdminIntegrationControl` from Task 1.
- Produces: `PlatformChannelGate`, `PlatformChannelDeploymentAvailability`, `PlatformChannelDisabledError`, and `PlatformChannelDeploymentUnavailableError`.
- Produces methods `getControl(key)`, `listControls()`, `isEnabled(key)` and `assertEnabled(key)`; all reads are fresh PostgreSQL reads.

- [ ] **Step 1: Write failing unit and PostgreSQL tests**

Cover these exact invariants:

```ts
await expect(gate.isEnabled('FACEBOOK_MESSENGER')).resolves.toBe(false); // missing row
await expect(gate.getControl('FACEBOOK_MESSENGER')).resolves.toMatchObject({
  deploymentAvailable: true,
  runtimeEnabled: false,
  effectiveEnabled: false,
  state: 'ADMIN_DISABLED',
});
await expect(unavailableGate.assertEnabled('TIKTOK_BUSINESS_MESSAGING'))
  .rejects.toBeInstanceOf(PlatformChannelDeploymentUnavailableError);
```

The PostgreSQL test must prove `autosale_worker` can select the table but cannot insert, update, delete or truncate it; `autosale_api` can select and mutate it; `autosale_backup` is read-only.

- [ ] **Step 2: Run the database tests and verify red**

Run: `pnpm --filter @autosale/database test -- src/platform-channel-gate.spec.ts src/platform-channel-flags.postgres.spec.ts src/runtime-database-roles.postgres.spec.ts`

Expected: failure because the model, migration and gate do not exist.

- [ ] **Step 3: Add the Prisma model and SQL migration**

Create a table constrained to the two public keys:

```sql
CREATE TABLE "platform_feature_flags" (
  "key" TEXT PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_feature_flags_key_check"
    CHECK ("key" IN ('FACEBOOK_MESSENGER', 'TIKTOK_BUSINESS_MESSAGING')),
  CONSTRAINT "platform_feature_flags_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);
```

After the repository-wide default grants, explicitly revoke mutations from `autosale_worker` and all mutations from `autosale_backup`, while granting API CRUD and worker/backup SELECT. Do not seed enabled rows.

- [ ] **Step 4: Implement the shared gate**

Implement state mapping without caching:

```ts
export class PlatformChannelGate {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deployment: PlatformChannelDeploymentAvailability,
  ) {}

  async isEnabled(key: AdminIntegrationKey): Promise<boolean> {
    return (await this.getControl(key)).effectiveEnabled;
  }
}
```

`getControl` uses `findUnique`, treats a missing row as `runtimeEnabled: false`, and reports `DEPLOYMENT_UNAVAILABLE` before `ADMIN_DISABLED`. `assertEnabled` throws a typed error suitable for safe controller mapping.

- [ ] **Step 5: Generate Prisma and run tests**

Run: `pnpm --filter @autosale/database generate`

Run: `pnpm --filter @autosale/database test -- src/platform-channel-gate.spec.ts src/platform-channel-flags.postgres.spec.ts src/runtime-database-roles.postgres.spec.ts`

Run: `pnpm --filter @autosale/database typecheck`

Expected: all pass.

- [ ] **Step 6: Commit the persistence increment**

```bash
git add packages/database/prisma packages/database/src/platform-channel-gate.ts packages/database/src/platform-channel-gate.spec.ts packages/database/src/platform-channel-flags.postgres.spec.ts packages/database/src/index.ts packages/database/src/runtime-database-roles.postgres.spec.ts packages/database/src/generated
git commit -m "feat: persist platform social channel flags"
```

### Task 3: Platform-admin API with atomic audit

**Files:**
- Create: `apps/api/src/admin/admin-integration.service.ts`
- Create: `apps/api/src/admin/admin-integration.service.spec.ts`
- Modify: `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/admin/admin.controller.spec.ts`
- Modify: `apps/api/src/admin/admin.module.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 2 gate.
- Produces: `GET /api/admin/integrations` and `PATCH /api/admin/integrations/:key`.
- Produces: `AdminIntegrationService.list()` and `AdminIntegrationService.update(actorUserId, key, input)`.

- [ ] **Step 1: Write failing service and controller tests**

Test both keys, strict body parsing, `PLATFORM_ADMIN` protection, unavailable-enable conflict, successful disable, and atomic audit. The successful mutation must assert audit metadata is exactly:

```ts
{
  channel: 'TIKTOK_BUSINESS_MESSAGING',
  previousEnabled: true,
  enabled: false,
}
```

Assert serialized responses do not contain `secret`, `credential`, `tenantId`, `pageId`, or `accountId`.

- [ ] **Step 2: Run focused API tests and verify red**

Run: `pnpm --filter @autosale/api test -- src/admin/admin-integration.service.spec.ts src/admin/admin.controller.spec.ts`

Expected: missing service and routes.

- [ ] **Step 3: Implement service mutation transaction**

Use one Prisma transaction for the flag and audit:

```ts
return this.prisma.$transaction(async (transaction) => {
  const previous = await transaction.platformFeatureFlag.findUnique({ where: { key } });
  const row = await transaction.platformFeatureFlag.upsert({
    where: { key },
    create: { key, enabled: input.enabled, updatedByUserId: actorUserId },
    update: { enabled: input.enabled, updatedByUserId: actorUserId },
  });
  await appendSecurityAudit(transaction, {
    tenantId: null,
    userId: actorUserId,
    actor: 'USER',
    action: 'PLATFORM_SOCIAL_CHANNEL_STATE_CHANGED',
    result: 'SUCCESS',
    metadata: { channel: key, previousEnabled: previous?.enabled ?? false, enabled: row.enabled },
  });
  return toControl(row, deployment[key]);
});
```

When enabling an unavailable deployment, append a failure audit with stable reason `DEPLOYMENT_UNAVAILABLE`, leave the row unchanged and surface a typed conflict.

- [ ] **Step 4: Add routes and module wiring**

Use `@CurrentPrincipal`, `@Patch('integrations/:key')`, strict Zod parsing and `ConflictException('CHANNEL_DEPLOYMENT_UNAVAILABLE')`. Derive deployment availability from the existing environment flags plus credential presence inside `AdminModule.register(env)`; return no reason detail to the browser.

- [ ] **Step 5: Run focused tests and API typecheck**

Run: `pnpm --filter @autosale/api test -- src/admin/admin-integration.service.spec.ts src/admin/admin.controller.spec.ts`

Run: `pnpm --filter @autosale/api typecheck`

Expected: all pass.

- [ ] **Step 6: Commit the admin API increment**

```bash
git add apps/api/src/admin
git commit -m "feat: add audited admin channel controls"
```

### Task 4: API runtime enforcement and tenant summaries

**Files:**
- Modify: `apps/api/src/integrations/facebook-oauth.service.ts`
- Modify: `apps/api/src/integrations/facebook-oauth.service.spec.ts`
- Modify: `apps/api/src/integrations/facebook-oauth.module.ts`
- Modify: `apps/api/src/integrations/tiktok-oauth.service.ts`
- Modify: `apps/api/src/integrations/tiktok-oauth.service.spec.ts`
- Modify: `apps/api/src/integrations/tiktok-oauth.module.ts`
- Modify: `apps/api/src/meta/meta-event.service.ts`
- Modify: `apps/api/src/meta/meta-event.service.spec.ts`
- Modify: `apps/api/src/meta/meta.module.ts`
- Modify: `apps/api/src/tiktok/tiktok-event.service.ts`
- Modify: `apps/api/src/tiktok/tiktok-event.service.spec.ts`
- Modify: `apps/api/src/tiktok/tiktok-webhook.controller.spec.ts`
- Modify: `apps/api/src/tiktok/tiktok.module.ts`
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/api/src/conversations/conversations.module.ts`

**Interfaces:**
- Consumes: `PlatformChannelGate.assertEnabled` and `getControl`.
- Produces: safe provider summaries with `platformAvailability` and side-effect-free disabled behavior.

- [ ] **Step 1: Add failing OAuth and summary tests**

For both providers prove:

- connected summary data remains visible when the runtime flag is off;
- `platformAvailability` reports `ADMIN_DISABLED` or `DEPLOYMENT_UNAVAILABLE`;
- authorize, callback persistence and Facebook Page selection call a fresh gate and fail before new credentials are stored;
- disconnect and credential cleanup remain allowed so customers are never trapped by a global pause.

- [ ] **Step 2: Add failing inbound and outbound tests**

Prove signed Facebook and TikTok webhook requests return 200 while paused, create no `WebhookEvent`, enqueue no job, and emit only safe aggregate ignored telemetry. Add the critical regression: a paused Facebook gate still lets an Instagram event persist and enqueue normally. Prove `ConversationsService.send` and `.retry` reject TikTok with `TIKTOK_CHANNEL_DISABLED` before writing or queueing, while Instagram is unchanged.

- [ ] **Step 3: Run focused API tests and verify red**

Run: `pnpm --filter @autosale/api test -- src/integrations/facebook-oauth.service.spec.ts src/integrations/tiktok-oauth.service.spec.ts src/meta/meta-event.service.spec.ts src/tiktok/tiktok-event.service.spec.ts src/tiktok/tiktok-webhook.controller.spec.ts src/conversations/conversations.service.spec.ts`

Expected: disabled-state assertions fail because the services still use startup booleans.

- [ ] **Step 4: Replace startup booleans with fresh gate checks**

Inject a gate into OAuth, Meta event, TikTok event and conversation services. Keep deployment config on the webhook controllers only for hard-unavailable routing and signature material. Check runtime state only after request authenticity/provider classification, then return an acknowledged ignored result before tenant resolution or persistence.

Make callback checks twice: before consuming provider state and immediately before credential activation. Make Page selection check before reading/decrypting candidates. Map gate state into provider summaries without altering stored connection status.

- [ ] **Step 5: Run focused tests, API suite and typecheck**

Run: `pnpm --filter @autosale/api test -- src/integrations/facebook-oauth.service.spec.ts src/integrations/tiktok-oauth.service.spec.ts src/meta/meta-event.service.spec.ts src/meta/meta.controller.spec.ts src/tiktok/tiktok-event.service.spec.ts src/tiktok/tiktok-webhook.controller.spec.ts src/conversations/conversations.service.spec.ts`

Run: `pnpm --filter @autosale/api typecheck`

Expected: all pass, including Instagram regression.

- [ ] **Step 6: Commit the API gate increment**

```bash
git add apps/api/src/integrations apps/api/src/meta apps/api/src/tiktok apps/api/src/conversations
git commit -m "feat: enforce social channel runtime gates"
```

### Task 5: Recoverable worker pause without provider side effects

**Files:**
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/instagram/instagram-event-reconciler.ts`
- Modify: `apps/worker/src/instagram/instagram-event-reconciler.spec.ts`
- Modify: `apps/worker/src/tiktok/tiktok-message-delivery.service.ts`
- Modify: `apps/worker/src/tiktok/tiktok-message-delivery.service.spec.ts`
- Modify: `apps/worker/src/tiktok/tiktok-message-reconciler.ts`
- Modify: `apps/worker/src/tiktok/tiktok-message-reconciler.spec.ts`

**Interfaces:**
- Consumes: one worker-process `PlatformChannelGate` with deployment availability from worker env.
- Produces: `IGNORED_DISABLED` delivery result; reconciler channel predicate `isChannelEnabled(key)`.

- [ ] **Step 1: Write failing delivery and reconciler tests**

Add tests proving a disabled gate returns `IGNORED_DISABLED` before the first message update and before `getFreshAccessToken` or `sendText`. Assert delivery attempts and status remain unchanged. Prove TikTok reconciliation still marks stale `SENDING` work `UNKNOWN`, but does not enqueue `PENDING` work while paused. Prove inbound reconciliation skips Facebook/TikTok rows while still enqueuing Instagram rows in the same batch.

- [ ] **Step 2: Run focused worker tests and verify red**

Run: `pnpm --filter @autosale/worker test -- src/tiktok/tiktok-message-delivery.service.spec.ts src/tiktok/tiktok-message-reconciler.spec.ts src/instagram/instagram-event-reconciler.spec.ts`

Expected: missing runtime-gate behavior.

- [ ] **Step 3: Gate immediately before worker side effects**

At the first line of `TikTokMessageDeliveryService.process`, perform a fresh `isEnabled` check and return `IGNORED_DISABLED` before creating a lease. In the message reconciler, retain the stale-unknown query before the gate so ambiguous prior sends never become resendable, then skip the due-message enqueue loop while disabled.

Change `InstagramEventReconciler` from the startup `tikTokEnabled` boolean to an async predicate for Facebook and TikTok; Instagram bypasses the predicate. Count skipped items separately only in safe metrics, not as failures.

- [ ] **Step 4: Wire one gate in worker main**

Construct:

```ts
const platformChannels = new PlatformChannelGate(prisma, {
  FACEBOOK_MESSENGER: env.FACEBOOK_MESSENGER_ENABLED && Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
  TIKTOK_BUSINESS_MESSAGING: env.TIKTOK_BUSINESS_MESSAGING_ENABLED && Boolean(env.TIKTOK_CLIENT_ID && env.TIKTOK_CLIENT_SECRET && env.TIKTOK_AUTHORIZATION_URL),
});
```

Pass it to delivery and reconcilers and perform fresh checks for normalize jobs. Do not create a provider client when deployment availability is false.

- [ ] **Step 5: Run focused tests, worker suite and typecheck**

Run: `pnpm --filter @autosale/worker test -- src/tiktok/tiktok-message-delivery.service.spec.ts src/tiktok/tiktok-message-reconciler.spec.ts src/instagram/instagram-event-reconciler.spec.ts`

Run: `pnpm --filter @autosale/worker typecheck`

Expected: all pass; no paused test calls a provider or increments delivery attempts.

- [ ] **Step 6: Commit the worker increment**

```bash
git add apps/worker/src
git commit -m "feat: pause disabled social channel workers"
```

### Task 6: Platform-admin Integrations page

**Files:**
- Create: `apps/web/app/admin/integrations/page.tsx`
- Create: `apps/web/src/components/admin-integrations.tsx`
- Create: `apps/web/src/components/admin-integrations.spec.tsx`
- Modify: `apps/web/src/components/admin-shell.tsx`
- Modify: `apps/web/src/components/admin-shell.spec.tsx`
- Modify: `apps/web/src/components/admin-copy.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/src/components/button-style-contract.spec.ts`

**Interfaces:**
- Consumes: `GET/PATCH /api/admin/integrations` and `AdminIntegrationControl[]`.
- Produces: `/admin/integrations` with one responsive control card per channel.

- [ ] **Step 1: Write failing route, navigation and component tests**

Cover Ukrainian/English labels, active/admin-disabled/deployment-unavailable states, no mutation button when unavailable, disable confirmation text, `LoadingButton`, duplicate-click prevention, safe form-level errors, `aria-live`, and absence of secret/provider/tenant fields. Verify the sidebar item is active on `/admin/integrations` and appears in the mobile drawer.

- [ ] **Step 2: Run focused web tests and verify red**

Run: `pnpm --filter @autosale/web test -- src/components/admin-integrations.spec.tsx src/components/admin-shell.spec.tsx src/components/button-style-contract.spec.ts`

Expected: missing component and navigation item.

- [ ] **Step 3: Implement server page and client controls**

The server page uses `authenticatedApiFetch('/api/admin/integrations')`, validates with `adminIntegrationListSchema`, and fails closed through the existing error boundary. The client component keeps local rows, calls `mutatingFetch` with `PATCH`, and replaces only the returned row after schema validation.

Use:

```tsx
<LoadingButton
  className={control.effectiveEnabled ? 'danger-button' : 'primary-button'}
  pending={pendingKey === control.key}
  type="button"
  onClick={() => requestChange(control)}
>
  {control.effectiveEnabled ? text.disable : text.enable}
</LoadingButton>
```

Route disabling through `ConfirmProvider`; the confirmation explicitly says existing data remains, new messages/replies stop, and paused inbound messages may not be recoverable.

- [ ] **Step 4: Add responsive styles and enforce button contract**

Use a two-column desktop card layout only when it remains readable; at 760 px stack cards, and at 390 px place action beneath status and description. Add no fixed width that can overflow. Update the button contract test to scan the new component.

- [ ] **Step 5: Run focused web tests and typecheck**

Run: `pnpm --filter @autosale/web test -- src/components/admin-integrations.spec.tsx src/components/admin-shell.spec.tsx src/components/button-style-contract.spec.ts`

Run: `pnpm --filter @autosale/web typecheck`

Expected: all pass.

- [ ] **Step 6: Commit the admin UI increment**

```bash
git add apps/web/app/admin/integrations apps/web/src/components/admin-integrations.tsx apps/web/src/components/admin-integrations.spec.tsx apps/web/src/components/admin-shell.tsx apps/web/src/components/admin-shell.spec.tsx apps/web/src/components/admin-copy.ts apps/web/app/globals.css apps/web/src/components/button-style-contract.spec.ts
git commit -m "feat: add admin social channel controls"
```

### Task 7: Tenant settings unavailable states

**Files:**
- Modify: `apps/web/src/components/facebook-settings-form.tsx`
- Modify: `apps/web/src/components/facebook-settings-form.spec.tsx`
- Modify: `apps/web/src/components/tiktok-settings-form.tsx`
- Modify: `apps/web/src/components/tiktok-settings-form.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/(workspace)/settings/page.spec.tsx`

**Interfaces:**
- Consumes: provider summary `platformAvailability` from Task 4.
- Produces: truthful tenant-facing unavailable hints while retaining connection identity and disconnect/cleanup actions.

- [ ] **Step 1: Write failing settings tests**

For each provider render an existing active fictional connection with `ADMIN_DISABLED` and assert:

- account/Page and stored connection status remain visible;
- connect/reconnect/selection actions are unavailable;
- disconnect and cleanup actions remain possible for an owner;
- localized text explains a temporary platform pause without mentioning environment variables or credentials.

Also test `DEPLOYMENT_UNAVAILABLE` for a not-connected account and manager read-only rendering.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @autosale/web test -- src/components/facebook-settings-form.spec.tsx src/components/tiktok-settings-form.spec.tsx "app/(workspace)/settings/page.spec.tsx"`

Expected: tests fail because the forms ignore platform availability.

- [ ] **Step 3: Implement safe availability rendering**

Keep provider connection status separate from platform availability. Add an unavailable badge/hint and disable only the operations that create or activate provider access. Do not hide or rewrite the persisted connection status. Continue to use shared button variants and existing form-level error presentation.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @autosale/web test -- src/components/facebook-settings-form.spec.tsx src/components/tiktok-settings-form.spec.tsx "app/(workspace)/settings/page.spec.tsx"`

Run: `pnpm --filter @autosale/web typecheck`

Expected: all pass.

- [ ] **Step 5: Commit the tenant UI increment**

```bash
git add apps/web/src/components/facebook-settings-form.tsx apps/web/src/components/facebook-settings-form.spec.tsx apps/web/src/components/tiktok-settings-form.tsx apps/web/src/components/tiktok-settings-form.spec.tsx apps/web/src/i18n/messages apps/web/app/\(workspace\)/settings/page.spec.tsx
git commit -m "feat: show paused social channels in settings"
```

### Task 8: Cross-layer acceptance and canonical documentation

**Files:**
- Create: `tests/e2e/admin-integrations.spec.ts`
- Modify: `docs/features/README.md`
- Modify: `docs/superpowers/specs/2026-10-04-platform-social-channel-runtime-controls-design.md`
- Modify: `docs/integrations/meta-facebook-messenger.md`
- Modify: `docs/integrations/tiktok-business-messaging.md`

**Interfaces:**
- Consumes: complete feature from Tasks 1–7.
- Produces: executable acceptance and operator instructions.

- [ ] **Step 1: Add browser acceptance**

Use only fictional/test identities. Cover desktop and 390 × 844 mobile navigation, unavailable control rendering, admin enable/disable against an available test deployment, confirmation cancellation, successful state refresh, keyboard focus and no horizontal overflow. Restore the original runtime flags in `afterEach` so the test is isolated.

- [ ] **Step 2: Run the focused browser test against the rebuilt local stack**

Run the repository's documented Docker rebuild/start command, apply migrations, then run: `pnpm exec playwright test tests/e2e/admin-integrations.spec.ts`

Expected: all scenarios pass and the browser console has no error.

- [ ] **Step 3: Update canonical feature and integration docs**

Change the design status to implemented after tests pass. Document:

- environment ceiling versus admin runtime state;
- retained connections/data on pause;
- no guaranteed replay for events received while paused;
- TikTok pending/unknown delivery safety;
- Facebook/Instagram shared webhook isolation;
- exact operator recovery order.

Record commands and counts from the real verification run; do not invent evidence.

- [ ] **Step 4: Run repository-wide verification**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `git diff --check`

Expected: all pass with no whitespace errors.

- [ ] **Step 5: Commit acceptance and docs**

```bash
git add tests/e2e/admin-integrations.spec.ts docs/features/README.md docs/superpowers/specs/2026-10-04-platform-social-channel-runtime-controls-design.md docs/integrations/meta-facebook-messenger.md docs/integrations/tiktok-business-messaging.md
git commit -m "test: verify admin social channel controls"
```

### Task 9: Review, merge, push and manual deployment

**Files:**
- Read: `.codex/skills/production-deployment/SKILL.md`
- Read: `docs/operations/hetzner-production.md`
- Read: repository deployment scripts referenced by the runbook

**Interfaces:**
- Consumes: a clean verified `codex/admin-social-channel-flags` branch.
- Produces: pushed `master`, deleted feature branch, manually updated current site and recorded deployment evidence.

- [ ] **Step 1: Review the complete branch diff**

Run: `git diff master...HEAD --check`

Run: `git diff --stat master...HEAD`

Review specifically for secret leakage, cross-tenant reads, missing gates, Facebook/Instagram coupling, queue attempt mutation while paused, browser-default buttons and unlocalized copy.

- [ ] **Step 2: Re-run final verification after review fixes**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all commands exit zero.

- [ ] **Step 3: Merge and push master**

```bash
git checkout master
git pull --ff-only origin master
git merge --ff-only codex/admin-social-channel-flags
git push origin master
```

If fast-forward is impossible, stop and resolve using the repository's merge-conflict workflow; never force-push.

- [ ] **Step 4: Perform the documented manual production deployment**

Follow `production-deployment` and the current environment's canonical runbook exactly. Deploy the pushed master commit, apply the migration before application traffic uses the new table, keep both database runtime rows disabled initially, and do not edit or print secrets.

- [ ] **Step 5: Verify production safely**

Verify public site/auth health, API and worker health, migration status, `/admin/integrations`, Instagram regression, and that unavailable providers cannot be enabled. Enable a provider only if its deployment prerequisites and controlled acceptance are already valid. Record commit SHA and non-sensitive health evidence.

- [ ] **Step 6: Delete the merged branch and prove cleanup**

```bash
git branch -d codex/admin-social-channel-flags
git status --short --branch
```

Leave the pre-existing untracked `artifacts/` directory untouched. Delete the remote feature branch only if it was pushed. Confirm no unique tracked or untracked feature work remains before cleanup.
