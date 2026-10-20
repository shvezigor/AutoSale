# Demo Lead Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect demo requests from abuse and give platform administrators an audited, retention-bounded lead workflow.

**Architecture:** Keep `DemoLead` in PostgreSQL as the sole lead source of truth and the existing BullMQ notification path. Redis holds only expiring HMAC-keyed abuse counters. Add platform-admin-only API and UI routes; retention deletes leads after a fenced notification boundary and leaves only non-contact audit proof.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Redis/ioredis, BullMQ, Next.js/React, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-20-demo-lead-operations-and-private-conversion-design.md`

## Global Constraints

- Retention deadline is the earlier of 180 days after the last successful operator status change or 365 days after lead creation. Read access and email delivery do not extend it.
- Public body size is at most 16 KiB; Redis admits at most 10 new requests per trusted IP in 10 minutes and 3 per normalized contact HMAC in 24 hours. Accepted idempotent replays consume no new quota.
- Do not put lead name, contact, note, IP, original idempotency key or export body in logs, queue payloads, audit metadata or metrics.
- New admin routes require `PLATFORM_ADMIN`; contact export and early deletion require purpose-bound five-minute step-up. Preserve existing tenant and notification boundaries.
- Shared buttons, `LoadingButton`, localized form errors, `aria-invalid`/`aria-describedby`, first-invalid focus and entered-value preservation remain mandatory.
- Automated suites and production-equivalent browser success/error/reload/downstream checks are both required; fictional/authorized data only.

---

## File map

- `apps/api/src/demo-leads/demo-lead-abuse.service.ts`: atomic, expiring Redis quotas; no lead persistence.
- `apps/api/src/demo-leads/demo-leads.controller.ts` and `demo-leads.module.ts`: trusted request metadata, honeypot and quota before creation.
- `apps/web/src/marketing/components/demo-form.tsx`: localized 429/503 states and hidden bot field.
- `packages/contracts/src/admin-demo-leads.ts`: list/detail/status/export contracts, exported from `packages/contracts/src/index.ts`.
- `apps/api/src/admin/admin-demo-leads.controller.ts`, `admin-demo-leads.service.ts`: admin queue, audited transition, guarded contact access/export/deletion.
- `apps/web/app/admin/leads/{page.tsx,[id]/page.tsx}` and `apps/web/src/components/admin-demo-*.tsx`: responsive queue and detail.
- `packages/database/prisma/schema.prisma` and one additive migration: `lastOperatorActionAt`, version counter and minimal system purge-audit support.
- `packages/database/src/demo-lead-retention.ts`: conditional purge/claim-fencing database operations.
- `apps/worker/src/demo-leads/demo-lead-retention.reconciler.ts` and `apps/worker/src/main.ts`: bounded scheduled expiry sweep.
- `apps/web/app/privacy/page.tsx`, canonical spec/index/runbook/acceptance: truthful scope and operational recovery.

## Task 1: Distributed abuse protection and honest form errors

**Files:** Create `apps/api/src/demo-leads/demo-lead-abuse.service.ts` and `.spec.ts`; modify `apps/api/src/demo-leads/{demo-leads.controller.ts,demo-leads.controller.spec.ts,demo-leads.module.ts}` and `apps/web/src/marketing/components/{demo-form.tsx,demo-form.spec.tsx}`.

**Interfaces:** Produce `DemoLeadAbuseService.check(input: { ipPrefix: string; contact: string; idempotencyKey: string }): Promise<void>`; it throws safe 429 or 503. `DemoLeadsService.create` remains the durable acceptance method.

- [x] **Step 1: Write red tests** for independent IP and contact quotas, simultaneous calls, expired windows, ignored spoofed `x-forwarded-for`, repeat accepted idempotency, honeypot no-write, and localized 429/503 with preserved form values. Example test assertions:

```ts
await expect(abuse.check({ ipPrefix: '192.0.2.0/24', contact: 'a@example.test', idempotencyKey: 'same' })).resolves.toBeUndefined();
await expect(abuse.check({ ipPrefix: '192.0.2.0/24', contact: 'b@example.test', idempotencyKey: 'new' })).rejects.toMatchObject({ status: 429 });
expect(prisma.demoLead.create).not.toHaveBeenCalled(); // honeypot request
```

- [x] **Step 2: Run failing focused tests.** `pnpm --filter @autosale/api test -- demo-lead-abuse demo-leads.controller` and `pnpm --filter @autosale/web test -- demo-form`; verify failures point to the new contract, not missing Docker.
- [x] **Step 3: Implement** an atomic Redis Lua `INCR` plus first-key `EXPIRE` operation for two HMAC keys derived with `AUTH_TOKEN_PEPPER`; take the trusted request IP from Nest/Express `request.ip`, never a raw forwarded header. Check the existing idempotency key in PostgreSQL before consuming a new quota; enforce the 16 KiB JSON body limit at the application adapter. Use a visually hidden, `aria-hidden`/`tabIndex=-1` `companyWebsite` honeypot that is stripped before the strict `demoLeadInputSchema`. Return generic accepted-looking output with no new row on honeypot hits. Represent `429` with `Retry-After`; map Redis failure to safe `503`. Example key derivation:

```ts
const digest = createHmac('sha256', pepper).update(`${kind}\0${value}`).digest('hex');
const redisKey = `demo-rate:${kind}:${digest}`;
```

- [x] **Step 4: Run focused tests and typecheck.** `pnpm --filter @autosale/api test -- demo-lead-abuse demo-leads.controller demo-leads.service`; `pnpm --filter @autosale/web test -- demo-form`; `pnpm --filter @autosale/api typecheck`; `pnpm --filter @autosale/web typecheck`. Record exact rate defaults and error copy in the canonical spec and marketing release runbook.
- [x] **Step 5: Commit only this increment.** Stage the named source, tests and docs; inspect `git diff --cached --check` and `git diff --cached --name-only`; commit `feat: protect public demo requests`.

## Task 2: Admin queue, contact detail and audited status changes

**Files:** Create `packages/contracts/src/admin-demo-leads.ts`, `apps/api/src/admin/admin-demo-leads.{controller,service}.ts` and tests, `apps/web/app/admin/leads/page.tsx`, `apps/web/app/admin/leads/[id]/page.tsx`, `apps/web/src/components/admin-demo-{leads-table,lead-detail}.tsx` and tests; modify `packages/contracts/src/index.ts`, `apps/api/src/admin/admin.module.ts`, `apps/web/src/components/{admin-shell.tsx,admin-copy.ts}` and database schema/migration.

**Interfaces:** `GET /api/admin/demo-leads?status=&cursor=&limit=` returns a bounded page with masked contact. `GET /api/admin/demo-leads/:id` returns one detail and audits access. `PATCH /api/admin/demo-leads/:id/status` accepts `{ status, expectedVersion }`, returns `{ id, status, version }`, and rejects stale versions with safe `409`.

- [ ] **Step 1: Write failing API, contract and UI tests** for `PLATFORM_ADMIN` only, pagination cap, no note/full contact in list, detail access audit, `NEW→CONTACTED→QUALIFIED→CLOSED`, explicit reopen `CLOSED→CONTACTED`, invalid transition, stale version, and audit failure rollback. Example transition test:

```ts
await expect(service.changeStatus(leadId, 'CONTACTED', 0, adminId)).resolves.toMatchObject({ status: 'CONTACTED', version: 1 });
await expect(service.changeStatus(leadId, 'QUALIFIED', 0, adminId)).rejects.toMatchObject({ status: 409 });
```

- [ ] **Step 2: Run red tests.** `pnpm --filter @autosale/api test -- admin-demo-leads`; `pnpm --filter @autosale/web test -- admin-demo`.
- [ ] **Step 3: Implement** the new contract and migration (`last_operator_action_at TIMESTAMPTZ NULL`, `version INTEGER NOT NULL DEFAULT 0`). In a single Prisma transaction, conditionally update `{ id, version }`, increment version, set `lastOperatorActionAt`, and append platform audit containing lead UUID and old/new enum only. Implement cursor pagination with `createdAt,id` stable ordering. Return a masked list projection; detail route uses `Cache-Control: no-store`. Reuse `@RequirePlatformAdmin`, the existing admin auth/CSRF guard and admin shell. Use shared buttons and `LoadingButton` for status mutations.

```ts
const changed = await tx.demoLead.updateMany({
  where: { id: leadId, version: expectedVersion, lifecycleStatus: currentStatus },
  data: { lifecycleStatus: nextStatus, version: { increment: 1 }, lastOperatorActionAt: now },
});
if (changed.count !== 1) throw new ConflictException('DEMO_LEAD_CHANGED');
```

- [ ] **Step 4: Run focused tests, database-backed transaction test, typecheck and build.** `pnpm --filter @autosale/api test -- admin-demo-leads`; `pnpm --filter @autosale/web test -- admin-demo`; `pnpm typecheck`; `pnpm build`. Add an admin browser test using a fictional lead, including direct-URL tenant denial and reload persistence.
- [ ] **Step 5: Update the canonical spec/index and commit** `feat: add audited admin demo lead queue` after inspecting staged file list and checking that `artifacts/` and runtime files are absent.

## Task 3: Protected export and early deletion

**Files:** Modify `packages/contracts/src/auth.ts` step-up purpose schema, `apps/api/src/admin/admin-step-up.service.ts`, `apps/api/src/admin/admin-demo-leads.{controller,service}.ts`, `apps/web/src/components/admin-demo-lead-detail.tsx`, `apps/web/app/privacy/page.tsx`; add focused tests and `docs/operations/demo-lead-lifecycle.md`.

**Interfaces:** `POST /api/admin/reauth` accepts the new purpose `DEMO_LEAD_EXPORT` or `DEMO_LEAD_DELETE`. `GET /api/admin/demo-leads/:id/export` requires a current-session purpose token and sends same-origin `application/json` attachment. `POST /api/admin/demo-leads/:id/delete` requires `{ confirmId: leadId }` plus delete-purpose token; a busy notification claim returns safe `409` and no deletion.

- [ ] **Step 1: Write failing tests** for wrong-purpose/expired tokens, tenant denial, export with no public object URL, spreadsheet-safe bounded bulk CSV, audit-only metadata, cancellation/no deletion on in-flight notification, and confirmed early deletion. Example authorization assertion:

```ts
expect(stepUp.verify(token, adminId, sessionId, 'DEMO_LEAD_DELETE')).toBe(false); // export token
expect(exportResponse.headers['cache-control']).toBe('no-store');
expect(exportResponse.headers['content-disposition']).toContain('attachment');
```

- [ ] **Step 2: Run red tests.** `pnpm --filter @autosale/api test -- admin-demo-leads admin-step-up`; `pnpm --filter @autosale/web test -- admin-demo-lead-detail`.
- [ ] **Step 3: Implement** purpose-bound reauthentication, safe same-origin JSON/CSV attachment headers, capped and cursor-streamed export, formula-prefix escaping for CSV (`=`, `+`, `-`, `@`, tab, carriage return), atomic deletion-plus-audit and localized confirm/error UI. Do not use MinIO or public signed URLs for these small exports. Add privacy notice text for purpose, retention and deletion contact. Audit contains UUID/reason/result only.

```ts
const safeCsvCell = (value: string) => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
if (confirmId !== leadId) throw new BadRequestException('DEMO_LEAD_CONFIRM_ID');
```

- [ ] **Step 4: Run focused suites plus a browser export/download and deletion scenario** with a fresh fictional lead. Verify export contents locally without printing contact to logs; verify row absence after reload and no notification sent after deletion. Run `pnpm typecheck` and `pnpm build`.
- [ ] **Step 5: Update canonical docs/index and commit** `feat: add guarded demo lead export and deletion` with no secrets or personal data staged.

## Task 4: Scheduled retention with notification fencing

**Files:** Create `packages/database/src/demo-lead-retention.ts` and PostgreSQL tests, `apps/worker/src/demo-leads/demo-lead-retention.reconciler.ts` and tests; modify `apps/worker/src/main.ts`, `packages/database/src/demo-lead-notifications.ts`, `packages/database/src/security-audit.ts` and scoped tests, `docs/operations/demo-lead-lifecycle.md`.

**Interfaces:** `DemoLeadRetentionStore.purgeDue(now: Date, limit: number): Promise<{ purged: number; busy: number }>` atomically chooses at most 100 expired leads and deletes only those with no active notification lease; reconciler calls it on a bounded schedule. Notification `claim(id)` returns `null` if the row was purged.

- [ ] **Step 1: Write failing PostgreSQL tests** for exactly 180/365-day boundary, read/email not extending expiry, status change extending only within absolute cap, active lease refusing purge, expired lease allowing purge, system audit with no contact, double-sweep idempotency, and notification replay after purge. Example clock assertion:

```ts
expect(await store.purgeDue(new Date('2027-04-18T00:00:00Z'), 100)).toEqual({ purged: 1, busy: 0 });
expect(await prisma.demoLead.findUnique({ where: { id: leadId } })).toBeNull();
```

- [ ] **Step 2: Run red database and worker tests.** `pnpm --filter @autosale/database test -- demo-lead-retention`; `pnpm --filter @autosale/worker test -- demo-lead-retention`.
- [ ] **Step 3: Implement** `FOR UPDATE SKIP LOCKED` bounded selection with the earliest deadline, conditional delete, and transaction-local minimal platform audit; extend the security-audit helper to represent a system actor without fake human ID. Ensure notification claim and purge serialize on the same row, and an in-flight lease is never removed. Wire reconciler only after a dry-run count and opt-in rollout flag until migration/backup/browser verification pass.

```sql
SELECT id FROM demo_leads
WHERE LEAST(COALESCE(last_operator_action_at, created_at) + INTERVAL '180 days', created_at + INTERVAL '365 days') <= $1
  AND (notification_lease_expires_at IS NULL OR notification_lease_expires_at < $1)
ORDER BY created_at, id LIMIT 100 FOR UPDATE SKIP LOCKED;
```

- [ ] **Step 4: Run focused suites and an interrupted-run recovery test;** perform dry-run count, verified backup/test restore, then deploy and enable the sweep manually. Verify worker/API health, no expired contact in admin after reload, and an already accepted lead's notification state remains correct. Record exact evidence in `docs/operations/demo-lead-lifecycle.md` and marketing acceptance.
- [ ] **Step 5: Commit scoped code/docs** `feat: enforce demo lead retention` and verify no contact fixtures or generated data are staged.

## Task 5: Integrated acceptance and branch finish

**Files:** Modify `docs/features/README.md`, `docs/superpowers/specs/2026-10-20-demo-lead-operations-and-private-conversion-design.md`, `docs/acceptance/marketing-site-checklist.md`, `docs/operations/marketing-release.md`; add `tests/e2e/admin-demo-leads.spec.ts`.

- [ ] **Step 1: Add the Playwright acceptance case** for valid submission, validation error, 429, saved admin row after reload, status change, export and early deletion; fixtures use `@example.test` only and mock any provider side effect.

```ts
await expect(page.getByRole('heading', { name: /demo leads|демозаявки/i })).toBeVisible();
await page.reload();
await expect(page.getByText('Fictional Demo Shop')).toBeVisible();
```

- [ ] **Step 2: Run `pnpm test`, `pnpm typecheck`, `pnpm build` and relevant Playwright tests.** Fix only failures attributable to this change; preserve unrelated user work.
- [ ] **Step 3: Deploy manually** using the repository production runbook after verified backup; migrate additively before enabling retention; verify public `/health/live`, API/web/worker, primary browser flow, failed form states, persisted admin status and downstream notification visibility. Capture material UI screenshots and annotate any unavailable admin/SMTP gate instead of claiming completion.
- [ ] **Step 4: Update canonical status and commit acceptance evidence.** Merge the verified task branch into current `master`, push `master`, then prove no unique tracked/untracked work remains in the branch before deleting it. Never delete the pre-existing `artifacts/` folder.
