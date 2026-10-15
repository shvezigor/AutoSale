# Durable Demo-Lead Notification Retries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver saved public demo requests to the internal mailbox through a bounded, recoverable background process without losing leads or exposing contact data in queues and logs.

**Architecture:** PostgreSQL owns the lead and notification state. The API commits and best-effort queues only the lead ID; a BullMQ worker atomically leases due leads, sends SMTP, records success or a bounded retry time, and a reconciler restores missed jobs. Platform operations show aggregate health, while a guarded operator command can requeue one terminal failure.

**Tech Stack:** TypeScript, NestJS API, Prisma/PostgreSQL, BullMQ/Redis, Nodemailer, Vitest, Next.js platform operations UI, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-15-demo-lead-notification-retries-design.md`

## Global Constraints

- Read the spec and `docs/features/README.md` before changes; do not create a second lead table or public endpoint.
- Four total claimed SMTP attempts; retry delays are 1, 5 and 15 minutes. `SENT` is terminal and cannot be requeued.
- PostgreSQL is authoritative. Queue payloads contain only a UUID. Never log names, contact details, notes, email bodies, credentials or raw SMTP errors.
- SMTP acceptance is not exactly-once delivery. Use one stable Message-ID per lead and retain the ambiguity warning in operator documentation.
- Keep current public API response and form validation. No tenant access, customer-facing email or rate-limit change.
- Use `apply_patch` for edits, fictional fixtures, test-first cycles and scoped commits. Do not stage `artifacts/`, `.env`, dumps, tokens, `dist/` or production personal data.
- Merge verified increments to `master`, push, then delete the feature branch after proving no unique work remains. Deploy only tested master with a verified backup and real-browser acceptance.

## File map

- `packages/database/prisma/schema.prisma` and a new migration: nullable due/lease columns and an index; `packages/database/src/demo-lead-notifications.ts`: atomic claim, completion, failure and due/terminal counts; `packages/database/src/index.ts`: export this store. Regenerate tracked Prisma source after migration.
- `apps/api/src/demo-leads/demo-leads.service.ts` and module: durable enqueue after create; remove inline SMTP from this path. Keep `apps/api/src/demo-leads/demo-lead-notifier.ts` only until the worker adapter replaces it, then remove it.
- `apps/worker/src/demo-leads/demo-lead-email.ts`: one SMTP adapter moved from the API, with stable Message-ID and conservative error classification; `demo-lead-notification.processor.ts`: bounded state transitions; `demo-lead-notification.reconciler.ts`: due-row queue recovery.
- `apps/worker/src/main.ts`, `packages/config/src/worker-env.ts` and `compose.yaml`: worker wiring, SMTP configuration, metrics, graceful shutdown; `apps/worker/package.json` and `pnpm-lock.yaml`: Nodemailer dependency and types.
- `packages/contracts/src/auth.ts`, `apps/api/src/admin/{admin.module,admin.service}.ts`, `apps/web/src/components/{admin-operations.tsx,admin-operations.spec.tsx,admin-copy.ts}`: count-only queue/terminal state in platform operations. `apps/api/src/cli/requeue-demo-lead.ts`: privileged single-ID recovery command.
- `docs/features/README.md`, `docs/operations/marketing-release.md`, `docs/acceptance/marketing-site-checklist.md`, `tasks/todo.md`: final ownership, operations and acceptance status.

---

### Task 1: Durable notification state and atomic lease

**Files:**
- Modify: `packages/database/prisma/schema.prisma`, `packages/database/src/index.ts`
- Create: `packages/database/prisma/migrations/20261015_demo_lead_notification_retries/migration.sql`, `packages/database/src/demo-lead-notifications.ts`, `packages/database/src/demo-lead-notifications.spec.ts`
- Regenerate: tracked `packages/database/src/generated/prisma/**` source through the existing `pnpm --filter @autosale/database generate` command

**Interfaces:**
- Produces: `DemoLeadNotificationStore(prisma, now = () => new Date())`; `claim(id: string): Promise<DemoLeadNotificationClaim | null>`, `markSent(id: string, leaseId: string): Promise<boolean>`, `markFailed(id: string, leaseId: string, code: DemoLeadFailureCode, terminal: boolean): Promise<Date | null>`, `listDue(limit: number): Promise<string[]>`, `counts(): Promise<{ due: number; exhausted: number }>`.
- `DemoLeadNotificationClaim` contains the existing lead fields needed by email plus `leaseId` and `attempt` (1–4). The store does not know SMTP or BullMQ.

- [ ] **Step 1: Write failing state tests.** Include these exact behaviors in `demo-lead-notifications.spec.ts` with isolated PostgreSQL/Testcontainers and fictional `lead@example.test`: a due lead claims once, a concurrent claim returns `null`, success marks `SENT`, a replay of `SENT` returns `null`, and expired lease can be reclaimed. Seed directly through Prisma and assert DB fields, not mock calls. The first test should call `new DemoLeadNotificationStore(prisma).claim(id)` and expect `attempt === 1` and a nonempty `leaseId`.

  ```ts
  const store = new DemoLeadNotificationStore(prisma, () => new Date('2026-10-15T12:00:00Z'));
  const first = await store.claim(lead.id);
  expect(first).toMatchObject({ id: lead.id, attempt: 1 });
  expect(first?.leaseId).toMatch(/^[0-9a-f-]{36}$/);
  expect(await store.claim(lead.id)).toBeNull();
  expect(await store.markSent(lead.id, first!.leaseId)).toBe(true);
  expect((await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } })).notificationStatus).toBe('SENT');
  ```
- [ ] **Step 2: Verify red.** Run `pnpm --filter @autosale/database test -- demo-lead-notifications.spec.ts`. Expected: the new store is missing; after scaffolding the test, the claim assertion fails before implementation.
- [ ] **Step 3: Implement the minimal schema and store.** Add `notification_next_attempt_at`, `notification_lease_id`, `notification_lease_expires_at`; backfill existing `PENDING` and `FAILED` with attempts below 4 to `now()` and leave `SENT`/exhausted terminal. Add an index on status/due. Use one conditional Prisma `updateMany` to claim and increment attempts; keep the old due timestamp during a lease so an expired lease is recoverable. Use a two-minute lease, longer than the configured SMTP timeouts. Make `markSent`/`markFailed` conditional on matching `leaseId`, clear the lease, and ensure a stale worker cannot overwrite a newer result. Retry delay is chosen from the just-claimed attempt (`1→1m`, `2→5m`, `3→15m`, `4→terminal`).

  ```sql
  ALTER TABLE demo_leads ADD COLUMN notification_next_attempt_at timestamptz;
  ALTER TABLE demo_leads ADD COLUMN notification_lease_id uuid;
  ALTER TABLE demo_leads ADD COLUMN notification_lease_expires_at timestamptz;
  UPDATE demo_leads SET notification_next_attempt_at = now()
    WHERE notification_status IN ('PENDING', 'FAILED') AND notification_attempts < 4;
  CREATE INDEX demo_leads_notification_due_idx
    ON demo_leads(notification_status, notification_next_attempt_at);
  ```

  ```ts
  const leaseId = randomUUID();
  const updated = await prisma.demoLead.updateMany({
    where: { id, notificationStatus: { in: ['PENDING', 'FAILED'] }, notificationAttempts: { lt: 4 },
      notificationNextAttemptAt: { lte: now },
      OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: now } }] },
    data: { notificationLeaseId: leaseId, notificationLeaseExpiresAt: new Date(now.getTime() + 120_000),
      notificationAttempts: { increment: 1 } },
  });
  if (updated.count === 0) return null;
  const claimed = await prisma.demoLead.findFirst({ where: { id, notificationLeaseId: leaseId } });
  return claimed ? { ...claimed, leaseId, attempt: claimed.notificationAttempts } : null;
  ```
- [ ] **Step 4: Verify green and regression.** Run `pnpm --filter @autosale/database generate`, `pnpm --filter @autosale/database test -- demo-lead-notifications.spec.ts`, `pnpm --filter @autosale/database typecheck`, and migration tests against a fresh PostgreSQL instance. Confirm the API and worker database roles can use the added fields, the backfill is correct, and the generated source diff contains no runtime data.
- [ ] **Step 5: Commit** only schema, migration, store, its tests and required tracked Prisma source as `feat: persist recoverable demo notification state`.

### Task 2: Public API accepts independently of SMTP

**Files:**
- Modify: `apps/api/src/demo-leads/demo-leads.service.ts`, `apps/api/src/demo-leads/demo-leads.service.spec.ts`, `apps/api/src/demo-leads/demo-leads.module.ts`
- Remove after worker adapter is ready: `apps/api/src/demo-leads/demo-lead-notifier.ts`

**Interfaces:**
- Consumes: the existing `DemoLead` Prisma model with `notificationNextAttemptAt`; a queue with `add('demo-lead.notify', { leadId: string }, { jobId: string, attempts: 1, removeOnComplete: 100, removeOnFail: 250 })`.
- Produces: unchanged `create(input, idempotencyKey): Promise<{ id: string; accepted: true }>`; the API does not send email.

- [ ] **Step 1: Write failing API tests.** Replace the old inline-notifier assertions with: a successful insert is followed by one ID-only queue call; if queue insertion throws, `create()` still resolves accepted and the lead remains `PENDING`; repeating the same idempotency key returns the same ID and does not create a second lead. Assert the job data equals `{ leadId: lead.id }` and does not contain `name`, `email`, `phone`, `note` or an SMTP value.

  ```ts
  await expect(service.create(input, 'fictional-key')).resolves.toEqual({ id: lead.id, accepted: true });
  expect(queue.add).toHaveBeenCalledWith('demo-lead.notify', { leadId: lead.id }, expect.any(Object));
  expect(JSON.stringify(queue.add.mock.calls[0][1])).not.toMatch(/name|email|phone|note|smtp/i);
  queue.add.mockRejectedValueOnce(new Error('Redis unavailable'));
  await expect(service.create(input, 'second-key')).resolves.toMatchObject({ accepted: true });
  ```
- [ ] **Step 2: Verify red.** Run `pnpm --filter @autosale/api test -- demo-leads.service.spec.ts`. Expected: existing inline SMTP calls violate the new expectations.
- [ ] **Step 3: Implement the minimal API change.** Construct `Queue('demo-leads', { connection })` in the module using the established URL-to-BullMQ connection pattern; inject the queue into `DemoLeadsService`. Set the initial due time on create, enqueue after commit, catch enqueue errors without changing the accepted response, and rely on reconciliation. Keep idempotent duplicate behavior and validate no SMTP work remains in the HTTP path.

  ```ts
  lead = await prisma.demoLead.create({ data: {
    idempotencyKey, name: input.name, company: input.company, email: input.email || null,
    phone: input.phone || null, orderVolume: input.orderVolume, note: input.note || null,
    locale: input.locale, notificationNextAttemptAt: new Date(),
  } });
  try {
    await queue.add('demo-lead.notify', { leadId: lead.id }, {
      jobId: `demo-lead-${lead.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 250,
    });
  } catch { /* PostgreSQL remains authoritative; reconciler recovers this lead. */ }
  return { id: lead.id, accepted: true };
  ```
- [ ] **Step 4: Verify green.** Run focused API tests, controller tests, API typecheck and build. Verify a duplicate request does not change a `SENT` row.
- [ ] **Step 5: Commit** the scoped API change as `feat: queue demo notifications after lead persistence`.

### Task 3: SMTP worker, safe classification and bounded attempts

**Files:**
- Create: `apps/worker/src/demo-leads/demo-lead-email.ts`, `apps/worker/src/demo-leads/demo-lead-email.spec.ts`, `apps/worker/src/demo-leads/demo-lead-notification.processor.ts`, `apps/worker/src/demo-leads/demo-lead-notification.processor.spec.ts`
- Modify: `packages/config/src/worker-env.ts`, `apps/worker/package.json`, `pnpm-lock.yaml`, `compose.yaml`
- Remove: `apps/api/src/demo-leads/demo-lead-notifier.ts` once its formatting and send contract live in the worker

**Interfaces:**
- Consumes: `DemoLeadNotificationStore.claim/markSent/markFailed` from Task 1 and the lead-ID job from Task 2.
- Produces: `createDemoLeadEmailSender(env: WorkerEnv): { send(lead: DemoLeadNotification): Promise<void> }`; `DemoLeadNotificationProcessor.process({ leadId: string }): Promise<'SENT' | 'RETRY_SCHEDULED' | 'TERMINAL' | 'SKIPPED'>`. The processor schedules a delayed ID-only BullMQ job when `markFailed` returns a due time; database reconciliation remains the fallback.

- [ ] **Step 1: Write failing worker tests.** With a fake sender and real store semantics, assert: first transient failure schedules one delayed ID-only retry after 60 seconds; subsequent failures use 300 and 900 seconds; fourth leaves `FAILED` without retry; success sets `SENT`; duplicate job after success skips; missing config and SMTP 5xx rejection are terminal. For the sender, assert a stable `<demo-${lead.id}@sales-aito.com>` Message-ID and that SMTP timeouts are bounded below the two-minute lease. Simulate an ambiguous timeout and assert it remains retryable.

  ```ts
  sender.send.mockRejectedValueOnce(new DemoLeadEmailError('DELIVERY_FAILED', false));
  expect(await processor.process({ leadId: lead.id })).toBe('RETRY_SCHEDULED');
  expect(queue.add).toHaveBeenCalledWith('demo-lead.notify', { leadId: lead.id },
    expect.objectContaining({ delay: 60_000 }));
  expect((await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } })).notificationAttempts).toBe(1);
  ```
- [ ] **Step 2: Verify red.** Run `pnpm --filter @autosale/worker test -- demo-lead`. Expected: imports for the new processor/sender fail, then behavior assertions fail until implementation exists.
- [ ] **Step 3: Implement minimal worker components.** Move the existing text body/subject format into the worker sender without logging it; add optional SMTP env fields to `WorkerEnv` and forward them into the worker service in `compose.yaml`, add Nodemailer as a worker dependency, and set connection/greeting/socket timeouts below two minutes. When settings are absent, return a typed `NOT_CONFIGURED` error, not a no-op success. Map SMTP 5xx to `RECIPIENT_REJECTED`, transient 4xx/network/timeouts to `DELIVERY_FAILED`, and never persist raw errors. Processor claims before sending; on success marks `SENT`; on failure conditionally marks failed and best-effort schedules the next delayed job. Inject a clock into processor tests so due-time calculations are deterministic.

  ```ts
  const claim = await store.claim(job.leadId);
  if (!claim) return 'SKIPPED';
  try {
    await sender.send(claim);
    await store.markSent(claim.id, claim.leaseId);
    return 'SENT';
  } catch (error) {
    const failure = classifyDemoLeadEmailError(error);
    const dueAt = await store.markFailed(claim.id, claim.leaseId, failure.code, failure.terminal);
    if (!dueAt) return 'TERMINAL';
    try { await queue.add('demo-lead.notify', { leadId: claim.id }, { delay: Math.max(0, dueAt.getTime() - Date.now()), attempts: 1 }); }
    catch { /* periodic database reconciliation restores this wake-up */ }
    return 'RETRY_SCHEDULED';
  }
  ```
- [ ] **Step 4: Verify green.** Run worker focused tests, `pnpm --filter @autosale/config test`, worker typecheck/build, and a controlled SMTP sink test with fictional addresses to verify actual Message-ID and body. Confirm the sink test does not contact external SMTP.
- [ ] **Step 5: Commit** the worker sender/processor and configuration as `feat: deliver demo lead notifications with bounded retries`.

### Task 4: Reconcile dropped jobs and wire worker lifecycle

**Files:**
- Create: `apps/worker/src/demo-leads/demo-lead-notification.reconciler.ts`, `apps/worker/src/demo-leads/demo-lead-notification.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `DemoLeadNotificationStore.listDue(50)` and `DemoLeadNotificationProcessor.process`.
- Produces: `DemoLeadNotificationReconciler.reconcile(): Promise<{ attempted: number; enqueued: number; failed: number }>`; queue named `demo-leads`, job name `demo-lead.notify`, ID-only payload.

- [ ] **Step 1: Write failing reconciler tests.** A due `PENDING` row left by Redis outage is enqueued, an expired lease is enqueued, an active lease and `SENT` row are absent; one queue failure increments `failed` but does not modify DB state. Assert a bounded 50-row query and no contact fields in jobs.

  ```ts
  const result = await reconciler.reconcile();
  expect(result).toEqual({ attempted: 2, enqueued: 2, failed: 0 });
  expect(queue.add).toHaveBeenCalledWith('demo-lead.notify', { leadId: dueLead.id }, expect.any(Object));
  expect(JSON.stringify(queue.add.mock.calls)).not.toContain('lead@example.test');
  ```
- [ ] **Step 2: Verify red.** Run `pnpm --filter @autosale/worker test -- demo-lead-notification.reconciler.spec.ts`. Expected: reconciler missing.
- [ ] **Step 3: Implement minimal reconciliation and wiring.** Make a 5-second bounded reconciliation tick, with one in-flight invocation per process; enqueue using a time-bucketed job ID so completed jobs do not suppress later recovery. Validate each consumed job as `{ leadId: uuid }` before reaching the store. Wire a BullMQ worker with bounded concurrency, safe metrics (`demo_lead_notify` attempts/results/backlog), sanitized correlation logging, immediate startup reconciliation, and graceful timer/queue shutdown. BullMQ jobs get one queue execution; PostgreSQL schedules all retries.

  ```ts
  const ids = await store.listDue(50);
  for (const leadId of ids) {
    try {
      await queue.add('demo-lead.notify', { leadId }, {
        jobId: `demo-lead-${leadId}-${Math.floor(now.getTime() / 5_000)}`,
        attempts: 1, removeOnComplete: 100, removeOnFail: 250,
      });
    } catch { failed += 1; }
  }
  ```
- [ ] **Step 4: Verify green.** Run focused and full worker tests, typecheck/build. Stop/restart the worker in an isolated PostgreSQL/Redis test and prove a due lead is recovered without an extra logical send after `SENT`.
- [ ] **Step 5: Commit** as `feat: reconcile demo notification jobs after outages`.

### Task 5: Count-only operations view and guarded terminal recovery

**Files:**
- Modify: `packages/contracts/src/auth.ts`, `apps/api/src/admin/admin.module.ts`, `apps/api/src/admin/admin.service.ts`, `apps/api/src/admin/admin.service.spec.ts`, `apps/web/src/components/admin-operations.tsx`, `apps/web/src/components/admin-operations.spec.tsx`, `apps/web/src/components/admin-copy.ts`
- Create: `apps/api/src/cli/requeue-demo-lead.ts`, `apps/api/src/cli/requeue-demo-lead.spec.ts`

**Interfaces:**
- Consumes: `DemoLeadNotificationStore.counts()` and queue monitor for `demo-leads`.
- Produces: operations summary field `demoLeadNotifications: { due: number; exhausted: number }`, with no lead fields; CLI `requeue-demo-lead <lead-uuid> --confirm-id <same-uuid>` guarded against `SENT` and active leases.

- [ ] **Step 1: Write failing privacy and recovery tests.** Admin operations returns only numeric `due/exhausted` counts, includes the new queue, and serialized JSON excludes `name`, `email`, `phone`, `note`. CLI rejects missing/mismatched confirmation and `SENT`; a terminal `FAILED` record requeues exactly once by ID after operator action and records a sanitized audit log entry. The platform operations component renders count labels in Ukrainian and English without PII.

  ```ts
  const summary = await service.getOperations();
  expect(summary.demoLeadNotifications).toEqual({ due: 2, exhausted: 1 });
  expect(JSON.stringify(summary)).not.toMatch(/lead@example.test|customerPhone|note/i);
  await expect(requeueDemoLead(prisma, sentId, sentId)).rejects.toThrow('LEAD_ALREADY_SENT');
  ```
- [ ] **Step 2: Verify red.** Run focused contracts, API admin/CLI, and web operations tests. Expected: new fields/queue/CLI do not exist.
- [ ] **Step 3: Implement minimal visibility and recovery.** Extend the existing admin operations contract and UI rather than a new admin page; register `demo-leads` with existing queue monitor. Implement the CLI as an operator-only command using the configured database role and guarded conditional update; require exact UUID confirmation, refuse `SENT` and an active lease, reset terminal attempts and due time, and log only action/ID/result. Do not expose a public recovery endpoint.

  ```ts
  export const adminQueueNameSchema = z.enum([
    'instagram', 'catalogue', 'delivery', 'telegram', 'tenant-lifecycle', 'ai-replies', 'demo-leads',
  ]);
  export const demoLeadNotificationCountsSchema = z.object({
    due: z.number().int().nonnegative(), exhausted: z.number().int().nonnegative(),
  }).strict();
  export const adminOperationsSummarySchema = z.object({
    status: z.enum(['HEALTHY', 'DEGRADED']), database: z.enum(['HEALTHY', 'ATTENTION']),
    updatedAt: z.string().datetime(), queues: z.array(adminQueueSummarySchema),
    demoLeadNotifications: demoLeadNotificationCountsSchema,
  }).strict();
  const changed = await prisma.demoLead.updateMany({
    where: { id, notificationStatus: 'FAILED', notifiedAt: null, notificationNextAttemptAt: null,
      OR: [{ notificationLeaseId: null }, { notificationLeaseExpiresAt: { lte: now } }] },
    data: { notificationStatus: 'PENDING', notificationAttempts: 0,
      notificationNextAttemptAt: now, notificationLeaseId: null, notificationLeaseExpiresAt: null,
      lastNotificationError: null },
  });
  ```
- [ ] **Step 4: Verify green.** Run focused contracts/API/web tests and typecheck/build; manually inspect a fictional aggregate view and confirm no lead data in response or logs.
- [ ] **Step 5: Commit** as `feat: expose safe demo delivery health and recovery`.

### Task 6: Acceptance, documentation, merge and release

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-demo-lead-notification-retries-design.md`, `docs/features/README.md`, `docs/operations/marketing-release.md`, `docs/acceptance/marketing-site-checklist.md`, `tasks/todo.md`
- Add tests only where Task 1–5 acceptance finds a concrete uncovered behavior.

**Interfaces:**
- Consumes: API/worker/DB/admin deliverables above.
- Produces: evidence-backed capability status, an operator runbook, a tested master commit and a documented rollout result.

- [ ] **Step 1: Run complete automated checks.** `pnpm test`, `pnpm typecheck`, `pnpm build`, focused demo E2E, `docker compose config`, migration check and `git diff --check`. Document exact results; fix discovered defects test-first.
- [ ] **Step 2: Run isolated SMTP/Redis failure acceptance.** With fictional leads and local SMTP sink, prove accepted submission, one email after transient recovery, four-attempt terminal stop, recovery after Redis/worker outage, duplicate-job no-op after `SENT`, and guarded operator requeue. Capture no real contact or credentials.
- [ ] **Step 3: Complete browser acceptance.** In a real browser against the intended environment, submit one approved fictional demo lead, check localized success/validation/error, reload, and inspect count-only platform operations. Capture a screenshot of the final state. Do not claim production email delivery if internal SMTP is not configured.
- [ ] **Step 4: Update canonical docs and commit.** Record exact retry/status behavior, worker SMTP secret setup, safe requeue command, ambiguous-delivery caveat, test evidence and remaining production SMTP gate; mark the backlog checkbox only if fully implemented, and keep capability `Validation pending` where live mailbox acceptance remains open. Commit only scoped docs and tests.
- [ ] **Step 5: Merge and push.** Check status (preserve user-owned `artifacts/`), merge feature branch into current `master` non-destructively, run final checks, push master, prove no unique tracked/untracked branch work, then delete merged branch.
- [ ] **Step 6: Deploy safely if authorized and feasible.** Read `docs/operations/deployment.md` and `docs/operations/backup-restore.md`, verify current live phase/auto-deploy/backup, make and verify the required fresh backup, deploy tested master API first then worker, verify services/health/queue/admin/browser, record SHA and backup ID. If the SMTP recipient/configuration is unavailable, report the exact live-email acceptance gap and leave status pending.
