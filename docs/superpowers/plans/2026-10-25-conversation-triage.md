# Conversation Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers organize conversations into Active, Inactive and Closed, with a genuinely new inbound customer message returning a conversation to Active.

**Architecture:** Extend the existing tenant-scoped `Conversation` row and contracts. Reuse the current conversations API, shared social inbound ingestion and inbox components; add no provider mutation or independent queue. A versioned status update prevents a stale manager action from overwriting a newer inbound reopening.

**Tech Stack:** PostgreSQL 17, Prisma 7, NestJS 11, Zod 4, Next.js 16/React 19, Vitest/Testcontainers, Playwright.

**Spec:** [approved conversation triage design](../specs/2026-10-25-conversation-triage-design.md).

## Global Constraints

- States are `ACTIVE`, `INACTIVE` and `CLOSED`; every existing and new conversation defaults to `ACTIVE`.
- Managers move states manually. Only a newly inserted inbound message newer than the last manual move automatically returns a non-active conversation to `ACTIVE`.
- Duplicate, delayed old inbound, outbound echo, delivery status, time passage and a manager reply do not change workflow state.
- Preserve tenant RLS, existing orders/messages/drafts, provider inboxes and lifecycle export. Never implement per-chat deletion or an Instagram folder action.
- API list without a status filter stays unfiltered for existing callers. Status pages use the current bounded cursor; counts represent the whole tenant category, not merely loaded rows.
- Mutations require manager membership, CSRF, a matching status version and safe localized failures; no provider message is sent.
- Use the existing workspace tokens and shared button variants. Hover is optional; keyboard, touch, Ukrainian and English are required.
- Follow the repository's TDD, scoped-commit and browser-verification rules. Use fictional/authorized test conversations only.

## File and responsibility map

| Area | Files | Responsibility |
|---|---|---|
| Persistence | `packages/database/prisma/schema.prisma`, new additive migration, `packages/database/src/conversation-message-rls.postgres.spec.ts` | Status/version columns, index, existing forced tenant RLS |
| Export and contracts | `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts` and tests; `packages/contracts/src/conversations.ts` and tests | Export metadata and bounded HTTP shapes |
| API | `apps/api/src/conversations/conversations.service.ts`, `conversations.controller.ts` and existing specs | Filter/count/read/move under tenant context and authorization |
| Inbound | `apps/worker/src/social/social-inbound-ingestion.service.ts`; existing Instagram/Facebook/TikTok processor specs | Reopen only on genuinely new inbound |
| Workspace | `apps/web/src/api/{conversations,conversation-replies}.ts`, `apps/web/src/components/{inbox-shell,live-conversation-list,conversation-list}.tsx`, reusable status menu/context, conversation detail page, dictionaries, `apps/web/app/globals.css` | Tabs, pagination, counts, move/reopen UI |
| Acceptance | `tests/e2e/conversation-inbox.spec.ts`, new acceptance record, `docs/features/README.md`, `tasks/todo.md` | Browser evidence and current feature status |

---

### Task 1: Persist and contract the workflow state

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261025160000_conversation_triage/migration.sql`
- Modify: `packages/contracts/src/conversations.ts`, `packages/contracts/src/conversations.spec.ts`
- Modify: `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts` and `tenant-export-datasets.spec.ts`
- Test: `packages/database/src/conversation-message-rls.postgres.spec.ts`

**Interfaces:**
- Produces: `ConversationWorkflowStatus = 'ACTIVE' | 'INACTIVE' | 'CLOSED'`; `workflowStatus`, `statusVersion`, `statusChangedAt` and `statusChangedByUserId` on `Conversation`.
- Produces: `conversationWorkflowStatusSchema` and `ConversationWorkflowStatus`; `conversationStatusChangeInputSchema` and `ConversationStatusChangeInput` = `{ status: ConversationWorkflowStatus; expectedVersion: number }`; `conversationStatusChangeResponseSchema` and `ConversationStatusChangeResponse` = `{ status: ConversationWorkflowStatus; statusVersion: number; statusChangedAt: string | null }`; `conversationStatusCountsSchema` and `ConversationStatusCounts` = `{ ACTIVE: number; INACTIVE: number; CLOSED: number }`.
- Produces: required `workflowStatus` and `statusVersion` on list summaries and detail responses; optional `status` on `conversationQuerySchema`.

- [ ] **Step 1: Write failing contract and database tests.** Add a schema test that rejects `ARCHIVED`, negative `expectedVersion` and missing summary status/version; extend the existing PostgreSQL test to assert a pre-migration-style inserted conversation reads `ACTIVE`/`0` under its tenant and remains invisible to another tenant. Add an export-dataset assertion for all four new fields.

```ts
expect(() => conversationStatusChangeInputSchema.parse({ status: 'ARCHIVED', expectedVersion: 0 })).toThrow();
expect(() => conversationStatusChangeInputSchema.parse({ status: 'CLOSED', expectedVersion: -1 })).toThrow();
expect(conversationStatusChangeInputSchema.parse({ status: 'CLOSED', expectedVersion: 0 }))
  .toEqual({ status: 'CLOSED', expectedVersion: 0 });
expect(TENANT_EXPORT_DATASETS.find((entry) => entry.name === 'conversations')?.fields)
  .toEqual(expect.arrayContaining([
    'workflowStatus', 'statusVersion', 'statusChangedAt', 'statusChangedByUserId',
  ]));
```

- [ ] **Step 2: Run the focused tests and observe the red state.** Run `corepack pnpm --filter @autosale/contracts test -- src/conversations.spec.ts` and `corepack pnpm --filter @autosale/database test -- src/conversation-message-rls.postgres.spec.ts`. Expect missing contract fields/columns, not an unrelated Docker failure.
- [ ] **Step 3: Add the additive schema and migration.** Add this enum/field shape to the existing Prisma model; the migration must preserve existing rows and only add an index, not rewrite messages or orders:

```prisma
enum ConversationWorkflowStatus {
  ACTIVE
  INACTIVE
  CLOSED
}

// Fields inside model Conversation:
workflowStatus       ConversationWorkflowStatus @default(ACTIVE) @map("workflow_status")
statusVersion        Int                        @default(0) @map("status_version")
statusChangedAt      DateTime?                  @map("status_changed_at")
statusChangedByUserId String?                   @map("status_changed_by_user_id") @db.Uuid

// Also inside Conversation, alongside the existing indexes:
@@index([tenantId, workflowStatus, lastMessageAt(sort: Desc), id(sort: Desc)], map: "conversations_tenant_status_last_message_id_idx")
```

```sql
CREATE TYPE "ConversationWorkflowStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');
ALTER TABLE "conversations"
  ADD COLUMN "workflow_status" "ConversationWorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "status_changed_by_user_id" UUID;
CREATE INDEX "conversations_tenant_status_last_message_id_idx"
  ON "conversations" ("tenant_id", "workflow_status", "last_message_at" DESC, "id" DESC);
```

- [ ] **Step 4: Add Zod shapes and export fields.** Define `conversationWorkflowStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'CLOSED'])` and the input/response/count schemas and exported `z.infer` types named in Interfaces. Extend `conversationQuerySchema` with `status: conversationWorkflowStatusSchema.optional()`, require status/version in summary/detail, and select the four new fields in the existing conversation export dataset. Regenerate Prisma with `corepack pnpm --filter @autosale/database generate`. Update only fixtures affected by required fields.
- [ ] **Step 5: Prove green and commit.** Run the focused tests, `corepack pnpm --filter @autosale/contracts typecheck`, `corepack pnpm --filter @autosale/database typecheck` and `git diff --check`. Commit only the files above as `feat: persist conversation workflow state`.

### Task 2: Filter, count and read conversations through the existing API

**Files:**
- Modify: `apps/api/src/conversations/conversations.service.ts`, `conversations.controller.ts`
- Test: `apps/api/src/conversations/conversations.service.spec.ts`, `conversations.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ConversationWorkflowStatus` and query/response schemas.
- Produces: `ConversationsService.statusCounts(tenantId: string): Promise<ConversationStatusCounts>` and `GET /api/conversations/status-counts`.
- Extends: `ConversationsService.list(tenantId, query)` with optional status filtering and `detail(tenantId,id)` with persisted status/version.

- [ ] **Step 1: Write failing service/controller tests.** Seed fictional conversations across two tenants and three states. Assert `list(tenantId, { status: 'INACTIVE', limit: 1 })` pages only inactive rows; unfiltered list still returns all; counts are exactly `{ ACTIVE: 2, INACTIVE: 1, CLOSED: 1 }` for one tenant and reveal nothing about the other; detail exposes status/version. Assert HTTP rejects `status=ARCHIVED` and requires manager membership for counts.

```ts
const first = await service.list(tenantId, { status: 'INACTIVE', limit: 1 });
expect(first.items.every((item) => item.workflowStatus === 'INACTIVE')).toBe(true);
expect(await service.statusCounts(tenantId)).toEqual({ ACTIVE: 2, INACTIVE: 1, CLOSED: 1 });
expect((await service.list(tenantId, { limit: 50 })).items.length).toBe(4);
```

- [ ] **Step 2: Run `corepack pnpm --filter @autosale/api test -- src/conversations/conversations.service.spec.ts src/conversations/conversations.controller.spec.ts`.** Expect failures for missing status filtering/count method.
- [ ] **Step 3: Extend the current tenant-context queries, not a second store.** In `list` add `...(query.status ? { workflowStatus: query.status } : {})` inside the existing `where` and include `workflowStatus`/`statusVersion` in each summary. In `detail` include the same fields. Implement counts with `transaction.conversation.groupBy({ by: ['workflowStatus'], where: { tenantId }, _count: { _all: true } })` inside `withTenantTransaction`, then fill all three zero defaults. Inspect an `EXPLAIN` for representative paged/count queries; change the index only if evidence warrants it.
- [ ] **Step 4: Add the fixed counts route before `@Get(':id')`.** Validate/serialize with `conversationStatusCountsSchema`. Preserve the old unfiltered `GET /api/conversations` response for E2E and other callers; add the optional OpenAPI status query and required summary/detail fields.
- [ ] **Step 5: Prove green and commit.** Run focused API tests plus `corepack pnpm --filter @autosale/api typecheck` and `git diff --check`. Commit as `feat: expose conversation status lists and counts`.

### Task 3: Make manager status moves version-safe

**Files:**
- Modify: `packages/contracts/src/tenant-lifecycle.ts`
- Modify: `apps/api/src/conversations/conversations.service.ts`, `conversations.controller.ts`
- Test: `apps/api/src/conversations/conversations.service.spec.ts`, `conversations.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ConversationStatusChangeInput` and `ConversationStatusChangeResponse`.
- Produces: `ConversationsService.changeStatus(tenantId: string, userId: string, id: string, input: ConversationStatusChangeInput): Promise<ConversationStatusChangeResponse>` and `PATCH /api/conversations/:id/status`.
- Produces: `CONVERSATION_TRIAGE` as a tenant-lifecycle mutation surface; no new provider call or queue.

- [ ] **Step 1: Add red tests for the transition contract.** Under fictional tenant fixtures, assert ACTIVE→INACTIVE→CLOSED→ACTIVE; current-state no-op without version increment; 409 for stale version; same 404 for missing/foreign tenant; 400 for invalid state/version; frozen tenant denial; and zero queue/provider calls. Add an HTTP test proving manager authorization, CSRF rejection without token and safe JSON errors.

```ts
const moved = await service.changeStatus(tenantId, actorUserId, newestId, {
  status: 'INACTIVE', expectedVersion: 0,
});
expect(moved).toMatchObject({ status: 'INACTIVE', statusVersion: 1 });
await expect(service.changeStatus(tenantId, actorUserId, newestId, {
  status: 'CLOSED', expectedVersion: 0,
})).rejects.toBeInstanceOf(ConflictException);
expect(queue.add).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run focused API tests and observe the missing route/service failures.** Use `corepack pnpm --filter @autosale/api test -- src/conversations/conversations.service.spec.ts src/conversations/conversations.controller.spec.ts`.
- [ ] **Step 3: Add `CONVERSATION_TRIAGE` to `TenantMutationSurface` and use `assertTenantAcceptingMutations(transaction, tenantId, 'CONVERSATION_TRIAGE')` before the move.** In one `withTenantTransaction`, lock the tenant's row with a parameterized `SELECT ... FOR UPDATE`; return 404 if absent and 409 if `statusVersion !== expectedVersion`. Return the unchanged row for a same-state request with a current version. Otherwise update `workflowStatus`, increment `statusVersion`, set `statusChangedAt = new Date()` and `statusChangedByUserId = userId`, then serialize the committed row. This lock prevents the no-op path and inbound reopen from observing incompatible versions.

```sql
SELECT workflow_status, status_version, status_changed_at
FROM conversations
WHERE tenant_id = $1::uuid AND id = $2::uuid
FOR UPDATE;
```

- [ ] **Step 4: Add the controller route and safe validation.** Parse the body with `conversationStatusChangeInputSchema.safeParse`, use `BadRequestException('CONVERSATION_STATUS_INVALID')` on invalid input, and map stale versions to `ConflictException('CONVERSATION_STATUS_CHANGED')`. Keep `@RequireMembership('MANAGER')` and the existing CSRF guard; document the bounded response in OpenAPI.

```ts
@Patch(':id/status')
changeStatus(
  @CurrentPrincipal() principal: AuthPrincipal,
  @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  @Body() raw: unknown,
): Promise<ConversationStatusChangeResponse> {
  const parsed = conversationStatusChangeInputSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('CONVERSATION_STATUS_INVALID');
  return this.conversations.changeStatus(principal.tenantId!, principal.userId, id, parsed.data);
}
```

- [ ] **Step 5: Prove green and commit.** Run focused API tests, `corepack pnpm --filter @autosale/api typecheck` and `git diff --check`. Commit as `feat: move conversation status with version checks`.

### Task 4: Reopen on new inbound, not on replay

**Files:**
- Modify: `apps/worker/src/social/social-inbound-ingestion.service.ts`
- Test: `apps/worker/src/instagram/instagram.processor.spec.ts`, `apps/worker/src/facebook/facebook.processor.spec.ts`, `apps/worker/src/tiktok/tiktok.processor.spec.ts`

**Interfaces:**
- Consumes: Task 1 `Conversation.workflowStatus/statusVersion/statusChangedAt`.
- Produces: no new public interface; the existing `process(tenantId, eventId, normalize)` remains the only inbound entry point.

- [ ] **Step 1: Write red fictional provider tests.** For each channel, manually mark a seeded conversation INACTIVE or CLOSED, then ingest one message with a unique external message ID and source timestamp later than `statusChangedAt`. Assert ACTIVE/version+1 and one stored message. Repeat the same event, ingest an older delayed event, an outbound echo and attachment repair; assert no second version change. Race a manager's stale expected version against the new inbound and assert 409 at the API boundary.

```ts
expect(afterFirst.workflowStatus).toBe('ACTIVE');
expect(afterFirst.statusVersion).toBe(before.statusVersion + 1);
await processor.process(tenantId, eventId);
expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).statusVersion)
  .toBe(afterFirst.statusVersion);
```

- [ ] **Step 2: Run the three focused worker specs to verify failure.** Use `corepack pnpm --filter @autosale/worker test -- src/instagram/instagram.processor.spec.ts src/facebook/facebook.processor.spec.ts src/tiktok/tiktok.processor.spec.ts`.
- [ ] **Step 3: Update inside the existing message-insertion tenant transaction.** After `createMany` establishes `wasCreated`, and before returning from the transaction, apply this conditional update. Keep the existing order/draft scheduling path unchanged; media-only new inbound also reopens because it is a customer message.

```ts
if (wasCreated && normalized.direction === 'INBOUND') {
  await transaction.conversation.updateMany({
    where: {
      id: conversation.id,
      tenantId: event.tenantId,
      workflowStatus: { not: 'ACTIVE' },
      statusChangedAt: { lt: normalized.sourceTimestamp },
    },
    data: {
      workflowStatus: 'ACTIVE',
      statusVersion: { increment: 1 },
      statusChangedAt: new Date(),
      statusChangedByUserId: null,
    },
  });
}
```

- [ ] **Step 4: Prove cross-channel green and commit.** Run all three focused specs, `corepack pnpm --filter @autosale/worker typecheck`, and the existing reply-draft/order-trigger regression specs. Commit as `feat: reopen conversations on new inbound messages`.

### Task 5: Add status tabs, counts and complete paged lists

**Files:**
- Modify: `apps/web/app/(workspace)/conversations/layout.tsx`
- Modify: `apps/web/src/api/conversations.ts`, `conversation-replies.ts`
- Create: `apps/web/src/components/conversation-triage-context.tsx`
- Modify: `apps/web/src/components/inbox-shell.tsx`, `live-conversation-list.tsx`
- Test: `apps/web/src/components/inbox-shell.spec.tsx`, `live-conversation-list.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`, `en.ts`; `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Task 2 filtered list/counts; Task 3 mutation.
- Produces: `useConversationTriage(): { status: ConversationWorkflowStatus; counts: ConversationStatusCounts; items: ConversationListResponse['items']; hasMore: boolean; loadMore(): Promise<void>; refresh(): Promise<void>; moveConversation(input: { id: string; status: ConversationWorkflowStatus; expectedVersion: number }): Promise<void> }` for the list and Task 6 status menu. `moveConversation` owns the CSRF-protected PATCH, confirmed-state update, counts/list/detail refresh, localized announcement and 409 recovery.
- Produces: `InboxShell({ initialPage, initialCounts, children }: { initialPage: ConversationListResponse; initialCounts: ConversationStatusCounts; children: ReactNode })`; the server layout fetches Active's page and counts concurrently.
- Produces: URL query `?status=active|inactive|closed`; absent/invalid value displays Active without leaking another status's cursor.

- [ ] **Step 1: Write failing component tests.** At all three URL values, assert the matching localized tab is selected, its full count is shown, and switching tab changes URL and fetches the server-filtered list. Assert a returned `nextCursor` makes **Load more** available and appends a second page without duplicates. After two pages are loaded, a 3-second newest-page poll updates a preview but preserves older rows and keyboard focus; a count refresh does not infer totals from `items.length`. Reload on `?status=closed` must not briefly display Active rows.

```ts
expect(screen.getByRole('tab', { name: /Закриті/ })).toHaveAttribute('aria-selected', 'true');
await user.click(screen.getByRole('button', { name: 'Завантажити ще' }));
expect(api.refreshConversationList).toHaveBeenCalledWith({ status: 'CLOSED', cursor: nextCursor });
expect(screen.getAllByRole('link', { name: /Клієнт/ })).toHaveLength(51);
```

- [ ] **Step 2: Run focused web tests and observe the absent tabs/pagination.** Use `corepack pnpm --filter @autosale/web test -- src/components/inbox-shell.spec.tsx src/components/live-conversation-list.spec.tsx`.
- [ ] **Step 3: Wire bounded API fetches.** Keep `GET /api/conversations` unfiltered by default, but make the server `getConversations({ status: 'ACTIVE' })` explicit in layout and fetch it alongside `getConversationStatusCounts()` via `Promise.all`. Add `refreshConversationList({ status, cursor })` / `refreshConversationStatusCounts()` on the client. URL-encode the cursor with `URLSearchParams`; validate all responses with Task 1 Zod schemas. Keep the existing server-side `request`/`authenticatedApiFetch` and client-side `parseResponse`/same-origin `fetch` patterns.

```ts
const query = new URLSearchParams({ limit: '50', status: input.status });
if (input.cursor) query.set('cursor', input.cursor);
return parseResponse(
  await fetch(`/api/conversations?${query.toString()}`, { cache: 'no-store' }),
  conversationListResponseSchema.parse,
);
```

- [ ] **Step 4: Add one client state owner.** `ConversationTriageProvider` in `InboxShell` owns tab URL state, separate pages per status, full counts, 3-second first-page refresh and 15-second counts refresh while visible. On a non-Active reload, show that tab's localized loading state until its first response arrives rather than rendering the SSR Active rows. `loadMore` appends de-duplicated IDs and advances only that tab's cursor. Keep the existing viewport-bound list scroll. Switching tabs uses `router.replace` with the current path and updated `status` query, preserving a selected detail URL; conversation row links carry the active `status` query.
- [ ] **Step 5: Render accessible tabs and totals.** Use semantic tablist/tab/tabpanel labels and the existing shared styles; make each empty state name its category. Remove the old footer's misleading `conversations.length` total in favor of Task 2 aggregate counts. Preserve the separate existing search input without claiming loaded-page-only search is global. Add matching UK/EN dictionary entries.
- [ ] **Step 6: Prove green and commit.** Run focused web tests, `corepack pnpm --filter @autosale/web typecheck`, the inbox viewport contract test, and `git diff --check`. Commit as `feat: add paged conversation status tabs`.

### Task 6: Add keyboard/touch-safe move actions in row and detail

**Files:**
- Create: `apps/web/src/components/conversation-status-menu.tsx` and `conversation-status-menu.spec.tsx`
- Modify: `apps/web/src/components/conversation-list.tsx`, `conversation-list.spec.tsx`
- Modify: `apps/web/app/(workspace)/conversations/[id]/page.tsx`
- Modify: `apps/web/src/components/conversation-triage-context.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`, `en.ts`; `apps/web/app/globals.css`
- Test: `apps/web/src/components/button-style-contract.spec.ts`, `conversation-viewport-contract.spec.ts`

**Interfaces:**
- Consumes: Task 5 `useConversationTriage()` and Task 3 `PATCH /api/conversations/:id/status`.
- Produces: reusable `ConversationStatusMenu({ id, name, workflowStatus, statusVersion })` for both surfaces.

- [ ] **Step 1: Write failing menu/list tests.** Assert the row `Link` and action button are siblings, menu actions contain only the two other states, opening moves focus to the first action, ArrowDown/ArrowUp change focus, Escape restores trigger focus, touch displays the trigger, and UK/EN names are meaningful. Assert pending disables mutation, success removes the row from the current tab without unmounting selected detail, and a 409 refreshes state/counts instead of showing success. Assert a non-409 failure keeps the last confirmed state and exposes retry guidance.

```ts
await user.click(screen.getByRole('button', { name: /Перемістити діалог Олена/ }));
expect(screen.getByRole('menuitem', { name: 'До неактивних' })).toHaveFocus();
await user.keyboard('{Escape}');
expect(screen.getByRole('button', { name: /Перемістити діалог Олена/ })).toHaveFocus();
expect(screen.getByRole('link', { name: /Олена/ }).contains(
  screen.getByRole('button', { name: /Перемістити діалог Олена/ }),
)).toBe(false);
```

- [ ] **Step 2: Run focused web tests to see the missing menu/action.** Use `corepack pnpm --filter @autosale/web test -- src/components/conversation-status-menu.spec.tsx src/components/conversation-list.spec.tsx`.
- [ ] **Step 3: Implement the shared menu and mutation.** Place an `icon-button` trigger beside—not inside—the conversation `Link`, with `aria-haspopup="menu"` and `aria-expanded`. Use `LoadingButton className="text-button"` for network-backed menu actions; the chosen target and `expectedVersion` come from the current row/detail. On success update the provider's confirmed item/counts, announce the move, and keep the detail pane visible. On 409 refetch row/detail/counts and announce the changed state; on another failure preserve old state. Use `router.refresh()` only after successful/conflicted fetch, not to fake persistence.

```ts
await moveConversation({
  id,
  status: target,
  expectedVersion: statusVersion,
});
```

- [ ] **Step 4: Add the same menu and visible state label to the detail header.** Keep it usable when the selected row disappears from the current tab; its initial status/version comes from the server detail, then provider updates override it. At mobile width, the header action stays visible without relying on row hover. Preserve message scroll position, reply editor and order rail when the status changes.
- [ ] **Step 5: Apply existing visual/validation contracts and commit.** Use only shared button variants, visible focus, 44px touch target where space allows, and no hover-only control. Run menu/list/button/viewport tests, `corepack pnpm --filter @autosale/web typecheck` and `git diff --check`. Commit as `feat: move conversations from inbox rows and detail`.

### Task 7: Acceptance, documentation and controlled release

**Files:**
- Test: `tests/e2e/conversation-inbox.spec.ts`
- Create: `docs/acceptance/conversation-triage-checklist.md`
- Modify: `docs/features/README.md`, `tasks/todo.md`

**Interfaces:**
- Consumes: Tasks 1–6; no new application interface.
- Produces: documented evidence for source, local browser and post-deployment test-account behavior.

- [ ] **Step 1: Add red Playwright acceptance with fictional fixtures.** Cover move→reload→correct tab/detail, reverse move, validation/conflict error, selected-detail preservation, URL tab persistence and one verified inbound reopening without an outbound provider call. Use the existing signed fictional webhook fixture and isolated test account, not a real customer.

```ts
await page.getByRole('tab', { name: /Неактивні/ }).click();
await page.reload();
await expect(page.getByRole('tab', { name: /Неактивні/ })).toHaveAttribute('aria-selected', 'true');
await expect(page.getByRole('link', { name: /Клієнт Instagram/ })).toBeVisible();
```

- [ ] **Step 2: Run the affected full suites.** Execute `corepack pnpm --filter @autosale/contracts test`, `corepack pnpm --filter @autosale/database test`, `corepack pnpm --filter @autosale/api test`, `corepack pnpm --filter @autosale/worker test`, `corepack pnpm --filter @autosale/web test`, `corepack pnpm build`, `corepack pnpm typecheck`, and `corepack pnpm exec playwright test tests/e2e/conversation-inbox.spec.ts`. Diagnose any red result before release; skipped external-provider tests are not a pass claim.
- [ ] **Step 3: Review privacy, migration and runtime blast radius.** Check the staged diff contains no secrets, production personal data, generated output or unrelated `artifacts/`. Verify the tenant export metadata, forced RLS and new query plan; use a fictional tenant for category counts and a replay race. Record exact test commands/results and any remaining gaps in the acceptance checklist. Update the feature index to evidence-based status and mark only genuinely completed `tasks/todo.md` items.
- [ ] **Step 4: Commit the acceptance increment.** Stage only the scoped test/docs files and commit as `test: verify conversation triage acceptance`. Merge the reviewed short-lived `codex/*` branch into current `master` only after merged-result tests pass; push `master`, verify the remote SHA, and delete the merged branch after proving no unique files remain. Preserve unrelated `artifacts/` and pre-existing worktrees.
- [ ] **Step 5: Manually deploy and verify the expected environment.** Follow `docs/operations/deployment.md` and `docs/operations/backup-restore.md`: inspect health and deployment mode, take/verify a backup, apply the additive migration, release API/worker/web, confirm health and rollback reference. In the real browser, exercise the authorized test account at 320/768/1024/1440 px, keyboard, touch, 200% zoom, UK/EN, success/error/reload and visible downstream tabs/detail. Capture screenshots in ignored `artifacts/`. Record the actual release SHA/environment/outcome in the acceptance checklist; if that record needs a post-deploy commit, create a new short `codex/conversation-triage-release-evidence` branch from current `master`, verify/commit its scoped documentation, merge/push `master` and remove the branch. Never claim full browser acceptance when credentials or an eligible test conversation are unavailable.
