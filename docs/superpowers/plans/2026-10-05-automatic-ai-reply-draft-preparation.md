# Automatic AI Reply Draft Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically prepare one catalogue-grounded reply draft after ten seconds of inbound-message quiet, place it in an untouched editor, and keep sending under explicit manager control.

**Architecture:** Extend the existing `AiReplyDraft` durable queue record with automatic/manual attribution and a due timestamp. The provider-neutral inbound ingestion path schedules an idempotent delayed draft for the latest inbound anchor; PostgreSQL remains authoritative and the existing reconciler recovers missed Redis dispatches. The existing composer polls the persisted draft and inserts a ready automatic draft exactly once only while the editor is untouched.

**Tech Stack:** TypeScript, Prisma/PostgreSQL with RLS, NestJS, BullMQ/Redis, React/Next.js, Vitest, Testing Library, Testcontainers, Docker Compose, Codex in-app browser.

**Spec:** `docs/superpowers/specs/2026-10-04-catalogue-grounded-ai-reply-drafts-design.md`

## Global Constraints

- The quiet period is exactly 10,000 milliseconds from durable persistence of the newest inbound message.
- Draft preparation may be automatic; sending always requires an explicit manager action.
- Only an enabled tenant reply style may schedule or generate drafts.
- Duplicate webhooks, out-of-order older events, delayed-job retries and reconciliation must not cause duplicate model calls.
- An automatic draft is system-attributed and must not impersonate a tenant owner or manager.
- Manager-entered, edited or cleared text must never be silently replaced or reinserted.
- Image-only blocks are not sent to the model because image understanding is outside this release.
- Reuse the existing `ai-replies` queue, tenant lifecycle guard, RLS, lease, grounding, stale-anchor, audit and outbound-delivery boundaries.
- Use shared button variants and `LoadingButton`; do not introduce a browser-default action button.
- Completion requires automated tests, production build, manual deployment, health checks and real-browser verification after reload.

---

### Task 1: Persist automatic scheduling and expose safe attribution

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261005170000_automatic_ai_reply_drafts/migration.sql`
- Modify: `packages/contracts/src/reply-drafts.ts`
- Modify: `packages/contracts/src/reply-drafts.spec.ts`
- Modify generated Prisma files through `pnpm --filter @autosale/database generate`
- Test: `packages/database/src/ai-reply-drafts-rls.postgres.spec.ts`

**Interfaces:**
- Produces: Prisma enum `AiReplyDraftTriggerSource = MANUAL | AUTOMATIC`.
- Produces: `AiReplyDraft.triggerSource`, nullable `createdByUserId`, and `availableAt`.
- Produces: `ReplyDraftSummary.triggerSource` and `ReplyDraftSummary.availableAt`.

- [ ] **Step 1: Rename the approved design branch for implementation**

```powershell
git branch -m codex/automatic-ai-reply-drafts
git status --short --branch
```

Expected: the current branch is `codex/automatic-ai-reply-drafts` and only the pre-existing untracked `artifacts/` remains outside the committed design and plan.

- [ ] **Step 2: Write failing contract and database tests**

Add a contract case that parses an automatic summary and rejects an unknown trigger:

```ts
const automatic = {
  ...validSummary,
  triggerSource: 'AUTOMATIC',
  availableAt: '2026-10-05T14:00:10.000Z',
};
expect(replyDraftSummarySchema.parse(automatic).triggerSource).toBe('AUTOMATIC');
expect(replyDraftSummarySchema.safeParse({ ...automatic, triggerSource: 'ROBOT' }).success).toBe(false);
```

Extend the PostgreSQL isolation test to create an automatic draft with `created_by_user_id = NULL`, prove the owning tenant can read it, and prove the other tenant cannot.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
pnpm --filter @autosale/contracts test -- reply-drafts.spec.ts
pnpm --filter @autosale/database test -- ai-reply-drafts-rls.postgres.spec.ts
```

Expected: the contract rejects missing new fields and PostgreSQL lacks the new columns/enum.

- [ ] **Step 4: Add the Prisma model and additive migration**

Add:

```prisma
enum AiReplyDraftTriggerSource {
  MANUAL
  AUTOMATIC
}

model AiReplyDraft {
  // existing identifiers
  createdByUserId String?                    @map("created_by_user_id") @db.Uuid
  triggerSource   AiReplyDraftTriggerSource  @default(MANUAL) @map("trigger_source")
  availableAt     DateTime                   @default(now()) @map("available_at")
  createdBy       User?                      @relation("AiReplyDraftCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)

  @@index([status, availableAt])
}
```

The migration must use additive SQL:

```sql
CREATE TYPE "AiReplyDraftTriggerSource" AS ENUM ('MANUAL', 'AUTOMATIC');
ALTER TABLE "ai_reply_drafts"
  ALTER COLUMN "created_by_user_id" DROP NOT NULL,
  ADD COLUMN "trigger_source" "AiReplyDraftTriggerSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "ai_reply_drafts_status_available_at_idx"
  ON "ai_reply_drafts"("status", "available_at");
```

Replace `worker_due_ai_reply_drafts` so `QUEUED` rows are returned only when `available_at <= p_now`; retain lifecycle, enabled-style, attempt and expired-lease conditions and grants exactly as in the existing migration.

The replacement function must return the deadline needed by reconciliation:

```sql
RETURNS TABLE (tenant_id uuid, draft_id uuid, available_at timestamptz)
-- ...
SELECT draft."tenant_id", draft."id", draft."available_at"
```

- [ ] **Step 5: Extend the public safe contract and mapper inputs**

Add:

```ts
export const replyDraftTriggerSourceSchema = z.enum(['MANUAL', 'AUTOMATIC']);

// replyDraftSummarySchema
triggerSource: replyDraftTriggerSourceSchema,
availableAt: z.iso.datetime(),
```

Regenerate Prisma and update `toReplyDraftSummary` to return only these safe metadata fields, never creator identity.

- [ ] **Step 6: Run focused verification and make GREEN**

Run:

```powershell
pnpm --filter @autosale/database generate
pnpm --filter @autosale/contracts test -- reply-drafts.spec.ts
pnpm --filter @autosale/database test -- ai-reply-drafts-rls.postgres.spec.ts
pnpm --filter @autosale/database typecheck
```

Expected: all commands pass.

- [ ] **Step 7: Commit the persistence contract**

```powershell
git add packages/database packages/contracts
git commit -m "feat(ai): persist automatic reply draft scheduling"
```

---

### Task 2: Schedule one durable draft after inbound quiet

**Files:**
- Create: `apps/worker/src/reply-drafts/automatic-reply-draft.scheduler.ts`
- Create: `apps/worker/src/reply-drafts/automatic-reply-draft.scheduler.spec.ts`
- Modify: `apps/worker/src/social/social-inbound-ingestion.service.ts`
- Modify: `apps/worker/src/instagram/instagram.processor.ts`
- Modify: `apps/worker/src/facebook/facebook.processor.ts`
- Modify: `apps/worker/src/tiktok/tiktok.processor.ts`
- Test: `apps/worker/src/instagram/instagram.processor.spec.ts`
- Test: `apps/worker/src/facebook/facebook.processor.spec.ts`
- Test: `apps/worker/src/tiktok/tiktok.processor.spec.ts`

**Interfaces:**
- Produces: `AutomaticReplyDraftScheduler.schedule(tenantId: string, messageId: string): Promise<'SCHEDULED' | 'REPLAYED' | 'SKIPPED'>`.
- Consumes: queue `add('ai-replies.generate', { tenantId, draftId }, { jobId, delay, attempts: 1, removeOnComplete: true, removeOnFail: true })`.
- Produces: `SocialReplyDraftScheduler` boundary used by provider-neutral ingestion.

- [ ] **Step 1: Write scheduler tests before implementation**

Cover these cases with a Testcontainers database and a fake queue:

```ts
expect(await scheduler.schedule(tenantId, newestInbound.id)).toBe('SCHEDULED');
expect(await prisma.aiReplyDraft.findFirstOrThrow()).toMatchObject({
  anchorMessageId: newestInbound.id,
  triggerSource: 'AUTOMATIC',
  createdByUserId: null,
  status: 'QUEUED',
});
expect(queue.add).toHaveBeenCalledWith(
  'ai-replies.generate',
  expect.objectContaining({ tenantId }),
  expect.objectContaining({ delay: 10_000, attempts: 1 }),
);
```

Also assert: disabled style skips; empty-text/image-only anchor skips; an older out-of-order anchor skips; a second message stales the first scheduled draft; replaying the same message returns `REPLAYED` with one row and one deterministic job identity; queue failure leaves the PostgreSQL row queued.

- [ ] **Step 2: Run scheduler tests and verify RED**

Run:

```powershell
pnpm --filter @autosale/worker test -- automatic-reply-draft.scheduler.spec.ts
```

Expected: FAIL because the scheduler does not exist.

- [ ] **Step 3: Implement the scheduler at the durable boundary**

Define:

```ts
export const AUTO_REPLY_QUIET_PERIOD_MS = 10_000;

export interface ReplyDraftDelayedQueue {
  add(
    name: 'ai-replies.generate',
    data: { tenantId: string; draftId: string },
    options: { jobId: string; delay: number; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export class AutomaticReplyDraftScheduler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: ReplyDraftDelayedQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async schedule(tenantId: string, messageId: string): Promise<'SCHEDULED' | 'REPLAYED' | 'SKIPPED'>;
}
```

Inside one tenant transaction: assert `CONVERSATION_REPLY`; load the inbound message, conversation and enabled style; confirm this message is the latest inbound ordered by `sourceTimestamp DESC, id DESC`; require non-empty normalized text; stale older `QUEUED`, `PROCESSING` and `READY` rows; replay an existing automatic row for the same anchor; otherwise create a system-attributed row with `idempotencyKey = anchorMessageId`, `triggerSource = AUTOMATIC`, and `availableAt = now + 10 seconds`. After commit, enqueue with `delay = max(0, availableAt - now)` and `jobId = ai-reply-${draft.id}`. Log only IDs and controlled result codes.

- [ ] **Step 4: Write failing ingestion integration tests**

Add a `schedule` spy to each provider processor test. For one new inbound event, assert the persisted `messageId` is passed once. Reprocess the same event and assert the idempotent scheduler may be called but no second draft/model job is produced. Assert outbound Instagram echoes never schedule.

- [ ] **Step 5: Run provider tests and verify RED**

Run:

```powershell
pnpm --filter @autosale/worker test -- instagram.processor.spec.ts facebook.processor.spec.ts tiktok.processor.spec.ts
```

Expected: FAIL because processors do not accept or call the scheduling boundary.

- [ ] **Step 6: Wire the provider-neutral ingestion boundary**

Add:

```ts
export interface SocialReplyDraftScheduler {
  schedule(tenantId: string, messageId: string): Promise<unknown>;
}
```

Pass it through the three thin provider processors. After the message transaction commits, call it only for `normalized.direction === 'INBOUND'`. Call it even when `createMany` reports a duplicate so an earlier queue outage can be recovered idempotently. Perform scheduling before media copying so a retryable media-copy failure cannot permanently suppress draft preparation.

- [ ] **Step 7: Run worker scheduler and provider tests**

```powershell
pnpm --filter @autosale/worker test -- automatic-reply-draft.scheduler.spec.ts instagram.processor.spec.ts facebook.processor.spec.ts tiktok.processor.spec.ts
pnpm --filter @autosale/worker typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit automatic inbound scheduling**

```powershell
git add apps/worker/src/reply-drafts apps/worker/src/social apps/worker/src/instagram apps/worker/src/facebook apps/worker/src/tiktok
git commit -m "feat(ai): schedule drafts after inbound quiet"
```

---

### Task 3: Enforce due time, recovery and queue wiring

**Files:**
- Modify: `apps/worker/src/reply-drafts/reply-draft.processor.ts`
- Modify: `apps/worker/src/reply-drafts/reply-draft.processor.spec.ts`
- Modify: `apps/worker/src/reply-drafts/reply-draft.reconciler.ts`
- Modify: `apps/worker/src/reply-drafts/reply-draft.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: `AiReplyDraft.availableAt` and existing `ai-replies.generate` job.
- Produces: processor outcome `DEFERRED` in addition to existing terminal outcomes.
- Produces: reconciler queue options with a bounded delay derived from `availableAt`.

- [ ] **Step 1: Add failing processor and reconciler tests**

Processor assertions:

```ts
expect(await processor.process({ tenantId, draftId })).toBe('DEFERRED');
expect(generate).not.toHaveBeenCalled();
expect((await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: draftId } })).status).toBe('QUEUED');
```

Advance the injected clock past `availableAt`, process again, and assert one model call. Add a second inbound anchor before processing and assert the old job returns `STALE`/`SKIPPED` without model spend.

Reconciler assertions: a future row is not returned; a due row is queued; its queue delay is `0`; a missed delayed wake-up is recovered exactly once.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --filter @autosale/worker test -- reply-draft.processor.spec.ts reply-draft.reconciler.spec.ts
```

Expected: future scheduled rows are currently claimable or the new outcome is unsupported.

- [ ] **Step 3: Add the due-time guard before leasing/model spend**

Before the existing lease transition, load `availableAt`. If `availableAt > now`, leave the row `QUEUED` and return `DEFERRED`. Keep the existing latest-anchor, tenant-switch, tenant-lifecycle, lease and post-generation source checks unchanged. Treat `DEFERRED` as a non-failure metric result without counting a model attempt.

- [ ] **Step 4: Make reconciliation deadline-aware**

Select `available_at` from `worker_due_ai_reply_drafts` and enqueue with:

```ts
const delay = Math.max(0, row.available_at.getTime() - now.getTime());
```

The SQL function already excludes future queued rows; the calculation protects against clock skew and preserves the queue interface. A worker that still observes an early row returns `DEFERRED`; the five-second PostgreSQL reconciler recovers it after the deadline.

- [ ] **Step 5: Reorder worker startup and inject one queue/scheduler**

In `apps/worker/src/main.ts`, construct Redis connection and the single `Queue('ai-replies')` before Instagram/Facebook/TikTok processors. Create one `AutomaticReplyDraftScheduler(prisma, replyDraftQueue)` and pass it to all available processors. Do not create a second Redis connection or queue. Preserve feature-flag behavior and shutdown handling.

- [ ] **Step 6: Run worker tests and typecheck**

```powershell
pnpm --filter @autosale/worker test
pnpm --filter @autosale/worker typecheck
```

Expected: all worker tests pass with no unhandled timers or open handles.

- [ ] **Step 7: Commit recovery and runtime wiring**

```powershell
git add apps/worker/src
git commit -m "feat(ai): recover delayed automatic drafts"
```

---

### Task 4: Preserve manual retry semantics and system attribution

**Files:**
- Modify: `apps/api/src/conversations/reply-drafts.service.ts`
- Modify: `apps/api/src/conversations/reply-drafts.service.spec.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/worker/src/tenant-lifecycle/tenant-export-datasets.spec.ts`

**Interfaces:**
- Consumes: nullable `createdByUserId`, `triggerSource`, `availableAt`.
- Preserves: `POST /api/conversations/:id/reply-drafts` as an authenticated immediate manual retry.
- Preserves: safe `ReplyDraftSummary` without exposing user identity.

- [ ] **Step 1: Add failing API tests**

Assert a manual request writes:

```ts
expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
  createdByUserId: actorId,
  triggerSource: 'MANUAL',
  availableAt: expect.any(Date),
}) });
```

When an automatic `FAILED` or `BLOCKED` draft exists for the latest anchor, a new manual idempotency key must create a separate immediate manual row. When an automatic `QUEUED` or `PROCESSING` draft exists, return it rather than spending twice. Verify conversation detail serializes `triggerSource` and `availableAt` but not `createdByUserId`.

- [ ] **Step 2: Run API tests and verify RED**

```powershell
pnpm --filter @autosale/api test -- reply-drafts.service.spec.ts conversations.service.spec.ts
```

Expected: creation metadata and safe summary fields are missing.

- [ ] **Step 3: Update manual creation and mapping**

Set `triggerSource: 'MANUAL'`, `createdByUserId: actorUserId`, and `availableAt: new Date()` for explicit API requests. Keep actor and tenant rate limits for manual requests. Automatic tenant ceilings remain in the scheduler. Update all summary mapper fixtures and lifecycle export expectations for nullable creator/system attribution.

- [ ] **Step 4: Run API and lifecycle tests**

```powershell
pnpm --filter @autosale/api test -- reply-drafts.service.spec.ts conversations.service.spec.ts
pnpm --filter @autosale/worker test -- tenant-export-datasets.spec.ts
pnpm --filter @autosale/api typecheck
```

Expected: all pass and no creator identity is added to browser contracts.

- [ ] **Step 5: Commit API compatibility**

```powershell
git add apps/api apps/worker/src/tenant-lifecycle
git commit -m "feat(ai): preserve manual draft retries"
```

---

### Task 5: Automatically fill only an untouched reply editor

**Files:**
- Modify: `apps/web/src/components/social-reply-composer.tsx`
- Modify: `apps/web/src/components/social-reply-composer.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/src/components/reply-style-settings.tsx`
- Test: `apps/web/src/components/button-style-contract.spec.ts`

**Interfaces:**
- Consumes: `ReplyDraftSummary.triggerSource` and `availableAt`.
- Produces: automatic editor selection through existing `selectedDraftId`; sending continues through existing `draftId` linkage.
- Preserves: manual editor content, copy-only Facebook behavior and explicit send.

- [ ] **Step 1: Replace the old manual-flow test with failing automatic UX tests**

Test these independent cases:

```ts
it('inserts a ready automatic draft into an untouched editor without sending', async () => {
  renderComposer(conversationWithQueuedAutomaticDraft, false, 'uk', true);
  api.refreshConversation.mockResolvedValue(conversationWithReadyAutomaticDraft);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Відповідь' }))
    .toHaveValue('Готова безпечна відповідь'));
  expect(api.sendConversationMessage).not.toHaveBeenCalled();
});
```

Add cases for: visible ten-second/preparing status; manager types before ready so text is preserved and **Use in editor** remains; manager clears an auto-inserted draft and polling does not insert it again; reload with a ready automatic draft fills an initially untouched editor; explicit send includes `draftId` exactly once; Facebook fills the editor but exposes **Copy text**, never API send; failed/blocked current draft exposes a shared-style retry button.

- [ ] **Step 2: Run component tests and verify RED**

```powershell
pnpm --filter @autosale/web test -- social-reply-composer.spec.tsx
```

Expected: the component still requires **Create draft** and does not auto-fill.

- [ ] **Step 3: Implement one-time automatic insertion**

Track manager interaction and offered automatic IDs without persisting customer text:

```ts
const editorTouched = useRef(false);
const offeredAutomaticDraftIds = useRef(new Set<string>());

useEffect(() => {
  if (!draftReady || currentDraft.triggerSource !== 'AUTOMATIC') return;
  if (offeredAutomaticDraftIds.current.has(currentDraft.id)) return;
  offeredAutomaticDraftIds.current.add(currentDraft.id);
  if (editorTouched.current || text.trim()) return;
  setText(currentDraft.generatedText ?? '');
  setSelectedDraftId(currentDraft.id);
}, [currentDraft, draftReady, text]);
```

Set `editorTouched.current = true` on user input, including clearing. Reset it only after a confirmed successful send or when the route changes to another conversation. Remove the normal **Create draft** button. Keep a `LoadingButton className="secondary-button"` only for explicit retry after `FAILED`/`BLOCKED`; keep **Use in editor** when existing text prevented insertion.

- [ ] **Step 4: Update localized explanations and settings copy**

Ukrainian copy must state: `Чернетка готується автоматично після 10 секунд без нових повідомлень і ніколи не надсилається без вашого підтвердження.` English must state the same behavior. Replace the generic stale warning with safe, actionable states: waiting, preparing, stale because a newer message arrived, validation blocked, and retryable provider failure. Do not expose raw provider codes.

- [ ] **Step 5: Run web verification**

```powershell
pnpm --filter @autosale/web test -- social-reply-composer.spec.tsx button-style-contract.spec.ts
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
```

Expected: tests, typecheck and production build pass.

- [ ] **Step 6: Commit the automatic editor UX**

```powershell
git add apps/web
git commit -m "feat(web): prepare AI replies automatically"
```

---

### Task 6: Close documentation, regression and live-browser acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-10-04-catalogue-grounded-ai-reply-drafts-design.md`
- Modify: `docs/acceptance/ai-reply-drafts-checklist.md`
- Modify: `docs/features/README.md`
- Modify if operational behavior changes: `docs/operations/deployment.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: evidence-backed status and a deployable `master` commit.

- [ ] **Step 1: Run repository-wide automated verification**

```powershell
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all workspaces pass; no warnings from application/test code and no whitespace errors.

- [ ] **Step 2: Update canonical status without overstating live coverage**

Mark the automatic slice implemented only after automated evidence passes. Keep the overall capability `Validation pending` until the controlled provider pilot passes. Record exact remaining provider/account limitations and do not claim image understanding or automatic sending.

- [ ] **Step 3: Commit final documentation evidence**

```powershell
git add docs
git commit -m "docs: record automatic reply draft acceptance"
```

- [ ] **Step 4: Merge and push the verified branch**

Confirm only intended files and existing `artifacts/` are present, then:

```powershell
git switch master
git merge --ff-only codex/automatic-ai-reply-drafts
git push origin master
```

- [ ] **Step 5: Deploy the exact tested master commit**

Record `git rev-parse HEAD`, confirm a fresh verified backup, then run:

```powershell
& .\scripts\deploy-local.ps1 -EnvFile .\.env
docker compose ps
```

Require API, web and worker to be healthy and verify `https://sales-aito.com/health/live` plus `/login` return HTTP 200.

- [ ] **Step 6: Verify the complete browser scenario with fictional/test-account data**

Using the real browser and the existing explicitly authorized test account:

1. Enable AI reply style and open an Instagram test conversation.
2. Send two inbound test messages less than ten seconds apart.
3. Verify no draft becomes ready before ten seconds after the second message.
4. Verify one draft appears and fills an untouched editor; reload and confirm persisted state is still correct.
5. Type manager text before another draft becomes ready; verify it is preserved and **Use in editor** remains available.
6. Clear an automatically inserted draft; poll/reload and verify the same draft is not silently reinserted in the active session.
7. Explicitly send an approved fictional response and verify one outbound message and one `USED` draft.
8. Confirm buttons use shared styles, keyboard focus is visible, the 390 px layout works, and browser console has zero errors or warnings.

Capture a screenshot of the ready draft in the editor and a screenshot of preserved manager text. Do not test with real customer data or uncontrolled provider messages.

- [ ] **Step 7: Clean the merged branch**

```powershell
git branch -d codex/automatic-ai-reply-drafts
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
```

Expected: `master` equals `origin/master`; only the pre-existing untracked `artifacts/` remains.
