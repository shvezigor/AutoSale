# Internal AI Provider Usage Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each actual worker-side OpenAI invocation once and produce a private, coverage-aware monthly AI and shared-infrastructure cost-per-order report without starting billing.

**Architecture:** A tenant-owned PostgreSQL attempt ledger sits below the five existing OpenAI adapters. A shared worker boundary writes `STARTED`, makes exactly one SDK transport attempt, then stores returned usage before business parsing; bounded reconciliation handles interrupted calls and 90-day expiry. A local operator CLI prices ledger rows from explicit, versioned external tariff/invoice inputs and counts distinct canonical orders; it never exposes tenant usage through customer or platform-admin APIs.

**Tech Stack:** TypeScript, Prisma 7/PostgreSQL 17 with forced RLS, OpenAI Responses SDK 6.22.0, Vitest/Testcontainers, Docker Compose, PowerShell deployment tooling.

**Spec:** `docs/superpowers/specs/2026-10-24-ai-provider-usage-ledger-design.md`

## Global Constraints

- This is internal measurement only: no tenant billing, trial start, entitlement enforcement, customer UI, public endpoint, or automated customer reply.
- Keep prompts, answers, customer fields, provider errors and secrets out of the ledger, report artifacts, metrics and logs. Use fictional test fixtures.
- `NULL` usage means unavailable; `0` is valid only when explicitly returned by the provider. An unknown charge or unpriced dimension makes the month provisional.
- Keep `withTenantTransaction` and forced RLS for row access; cross-tenant worker discovery returns only bounded IDs. A frozen tenant cannot start a new provider call, but an already-dispatched attempt can finalize.
- Disable the OpenAI SDK's hidden retries (`maxRetries: 0`); an application retry must have a fresh attempt UUID.
- Do not backfill historical token metadata into authoritative spend. A pre-rollout period is incomplete.
- Raw attempt retention is proposed at 90 days. Do not activate production collection until privacy/accounting review approves this period and the bounded sweep and export/restore checks pass.
- Keep pricing, invoice and cohort inputs outside Git and outside ordinary application logs. Do not claim a complete cost-per-order result without account/project attribution and invoice reconciliation.
- Work on a short-lived `codex/*` branch from current `master`; commit each verified task, merge/push `master`, delete the branch, and inspect unique files before worktree cleanup. Preserve existing `artifacts/`.

## File structure and interface decisions

| File | Responsibility |
|---|---|
| `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/20261024_ai_provider_usage_attempts/migration.sql` | One tenant-owned attempt model, constraints, indexes, RLS and narrow role grants. |
| `packages/database/src/ai-provider-usage.ts` | Tenant-scoped start/finalize/read operations; no provider networking. |
| `packages/database/src/ai-provider-usage.postgres.spec.ts` | Real two-tenant RLS, terminal immutability, constraints and runtime-role checks. |
| `apps/worker/src/ai-usage/metered-responses.ts` | One SDK call boundary and safe, bounded failure telemetry. |
| `apps/worker/src/ai-usage/ai-usage.reconciler.ts` | ID-only orphan discovery, charge-unknown finalization and bounded retention. |
| `apps/worker/src/ai-usage/monthly-report.ts`, `apps/worker/src/ai-usage/report-cli.ts` | Pure report calculation and private operator entry point. |
| `apps/worker/src/{orders,reply-drafts,catalogue}/openai-*.ts`, corresponding specs, processor specs and `apps/worker/src/main.ts` | Pass tenant, purpose and operation UUID into the shared boundary without changing product responses. |
| `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts` and its tests | Export non-secret ledger fields while present. |
| `docs/operations/data-protection-and-retention.md`, `docs/features/README.md`, `docs/superpowers/specs/2026-10-24-ai-provider-usage-ledger-design.md` | Canonical policy, ownership, evidence and status. |

The stable interface between tasks is:

```ts
export type AiUsagePurpose =
  | 'ORDER_RECOGNITION' | 'ORDER_INTENT' | 'REPLY_DRAFT'
  | 'CATALOGUE_STRUCTURE' | 'CATALOGUE_COLUMN_MAPPING' | 'CATALOGUE_ROW_CLASSIFICATION';
export type AiUsageContext = {
  tenantId: string;
  operationId: string; // existing trigger message, draft or catalogue run UUID
  purpose: AiUsagePurpose;
};
export type ReportPeriod = { from: Date; until: Date }; // UTC [from, until)
```

The module accepts a context with the existing UUID rather than creating a second service or queue. Each `responses.create` receives a new attempt UUID inside `metered-responses.ts`; catalogue loops therefore produce one row **per batch**. The schema uses integer nullable token counts, not product-table token snapshots. The provider's usage subfields should be copied from the SDK response before adapters flatten them.

---

### Task 1: Add a private tenant-owned attempt ledger and lifecycle export

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261024_ai_provider_usage_attempts/migration.sql`
- Create: `packages/database/src/ai-provider-usage.ts`
- Create: `packages/database/src/ai-provider-usage.postgres.spec.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/runtime-database-roles.ts`
- Modify: `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts`
- Modify: `apps/worker/src/tenant-lifecycle/tenant-export-datasets.spec.ts`

**Interfaces:** Produces `AiProviderUsageStore.start(context, requestedModel, attemptId, now)` and `finalize(context, attemptId, outcome, usage, returnedModel, now)`. `finalize` is a conditional `STARTED` → terminal update that returns whether one row changed; the same completion repeated does not increase usage. Use `withTenantTransaction` for both.

- [ ] **Step 1: Write a failing real-PostgreSQL test.** Copy the fixture/bootstrap pattern from `packages/database/src/ai-reply-drafts-rls.postgres.spec.ts`. With two fictional tenant UUIDs, assert no-context reads are empty, tenant B cannot read/update/insert tenant A's attempt, worker can start/finalize only in its tenant context, API has no write grant, negative tokens fail, terminal update fails, and an identical second completion changes zero rows. Include a zero-token response and a `USAGE_MISSING` response with `NULL` counts:

```ts
expect(await withTenantTransaction(worker, tenantA, tx =>
  tx.aiProviderUsageAttempt.findMany({ select: { tenantId: true } })))
  .toEqual([{ tenantId: tenantA }]);
expect(await worker.aiProviderUsageAttempt.findMany()).toEqual([]);
expect(await withTenantTransaction(worker, tenantB, tx =>
  tx.aiProviderUsageAttempt.findMany())).toEqual([]);
```

- [ ] **Step 2: Run the test red.** Run `pnpm --filter @autosale/database exec vitest run src/ai-provider-usage.postgres.spec.ts --maxWorkers=1`. Expected: the model/delegate or migration does not exist.
- [ ] **Step 3: Implement one table and store.** Add `AiProviderUsageAttempt` to Prisma with `id`, `tenantId`, `purpose`, `operationId`, `provider`, `requestedModel`, nullable `returnedModel`, `startedAt`, nullable `finalizedAt`, `outcome`, nullable `inputTokens`, `outputTokens`, `cachedInputTokens` and bounded nullable `errorCategory`; index `(tenantId, startedAt, id)` and `(outcome, startedAt, id)`. Use an enum/checklist of the six purposes and terminal outcomes `REPORTED`, `USAGE_MISSING`, `CHARGE_UNKNOWN`, `NOT_SENT`; reject negative tokens and contradictory null/non-null combinations. SQL essentials:

```sql
ALTER TABLE ai_provider_usage_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_usage_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_usage_tenant ON ai_provider_usage_attempts
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
REVOKE INSERT, UPDATE, DELETE ON ai_provider_usage_attempts FROM autosale_api;
```

Use a `BEFORE UPDATE` trigger to reject changes to terminal rows; do not add a correction procedure in this slice. Revoke `DELETE` from runtime roles and give the worker only the bounded retention function in Task 4. Ensure runtime role bootstrap does not re-grant API mutation or worker deletion rights. Do not expose rows via an API service.
- [ ] **Step 4: Add the export dataset and verify redaction.** Add `dataset('ai-provider-usage-attempts', 'aiProviderUsageAttempt', {...})` selecting only schema scalar fields; assert exact field allowlist and absence of `prompt`, `response`, customer identifiers and credentials. Add a real export writer fixture so the JSONL manifest count and checksum remain deterministic.
- [ ] **Step 5: Run the database and export tests green.** Run `pnpm --filter @autosale/database generate`, `pnpm --filter @autosale/database exec vitest run src/ai-provider-usage.postgres.spec.ts --maxWorkers=1`, and `pnpm --filter @autosale/worker exec vitest run src/tenant-lifecycle/tenant-export-datasets.spec.ts src/tenant-lifecycle/tenant-export-writer.spec.ts`. Expected: PASS; no secret fields in the export.
- [ ] **Step 6: Commit the scoped increment.** Stage only named source/migration/test files; run `git diff --cached --check`; commit `feat: record tenant-scoped AI provider usage attempts`.

### Task 2: Meter one actual Responses transport attempt before parsing

**Files:**
- Create: `apps/worker/src/ai-usage/metered-responses.ts`
- Create: `apps/worker/src/ai-usage/metered-responses.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:** `createMeteredResponses(store, sdk, signal).create(context, request): Promise<OpenAI.Responses.Response>` owns attempt IDs. The `store` comes from Task 1. `signal` accepts only fixed enum labels `start_failed`/`finalize_failed`, not tenant/operation IDs or errors.

- [ ] **Step 1: Write failing boundary tests.** Inject a fake SDK and store. Assert exactly one `start` before `sdk.responses.create`, one finalize before returning the response, explicit zero stays zero, missing `usage` yields `USAGE_MISSING`, thrown transport yields `CHARGE_UNKNOWN`, and start/finalize storage failure still returns/rethrows the product result while emitting only the fixed signal. Assert the fake SDK call count is one and neither prompt nor operation UUID appears in signal payloads:

```ts
expect(events).toEqual(['start', 'provider', 'finalize']);
expect(sdk.responses.create).toHaveBeenCalledTimes(1);
expect(signal).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
```

- [ ] **Step 2: Run the focused test red.** Run `pnpm --filter @autosale/worker exec vitest run src/ai-usage/metered-responses.spec.ts`. Expected: module absent.
- [ ] **Step 3: Implement the shared boundary.** Create a fresh `randomUUID()` for each call. Persist `STARTED` immediately before `responses.create`; finalize from `response.usage` *before* the caller parses `output_text`. Copy `input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens` as nullable integers after bounded validation; reject a subcount greater than input count as missing/invalid evidence. Never log the request, response, raw exception or IDs. If start fails, still invoke the provider once and emit `start_failed`. If finalize fails, return the original response and emit `finalize_failed`. If transport throws, attempt `CHARGE_UNKNOWN` finalization and rethrow the original error.

```ts
const attemptId = randomUUID();
let recorded = false;
try {
  await store.start(context, String(request.model), attemptId, new Date());
  recorded = true;
} catch { signal('start_failed'); }
let response: OpenAI.Responses.Response;
try {
  response = await sdk.responses.create(request);
} catch (providerError) {
  if (recorded) {
    try { await store.finalize(context, attemptId, 'CHARGE_UNKNOWN', null, null, new Date()); }
    catch { signal('finalize_failed'); }
  }
  throw providerError;
}
if (recorded) {
  try {
    await store.finalize(context, attemptId, response.usage ? 'REPORTED' : 'USAGE_MISSING',
      normalizeUsage(response.usage), String(response.model), new Date());
  } catch { signal('finalize_failed'); }
}
return response;
```

Create SDK clients with `new OpenAI({ apiKey, maxRetries: 0 })`, and test this option by injecting the client factory. Preserve `store: false` on every request.
- [ ] **Step 4: Run focused tests, typecheck, commit.** Run the focused test and `pnpm --filter @autosale/worker typecheck`; expected PASS. Commit `feat: meter individual OpenAI transport calls`.

### Task 3: Thread usage context through all five existing adapters

**Files:**
- Modify: `apps/worker/src/orders/{openai-order-recognizer,order-recognition.service,triggered-order.processor}.ts`
- Modify: `apps/worker/src/reply-drafts/{openai-reply-draft-generator,reply-draft.processor}.ts`
- Modify: `apps/worker/src/catalogue/{openai-table-structure-analyzer,openai-column-mapper,openai-ambiguous-row-classifier,catalogue-mapping.processor}.ts`
- Modify: matching `*.spec.ts` files and `apps/worker/src/main.ts`

**Interfaces:** Each public adapter input receives `usageContext: AiUsageContext`. The trigger message ID identifies an order/intent operation; `draftId` identifies a draft; `runId` identifies a catalogue mapping. The processor selects the purpose; the adapter's loop creates separate attempts through Task 2. Keep existing product metadata return types and safe fallback behavior unchanged.

- [ ] **Step 1: Write failing adapter/processor tests.** In the existing `openai-*.spec.ts` suites, inject a metered fake and assert all six purpose values across five adapters. For a 101-row ambiguous classifier, expect two distinct calls/attempts; for 51 mapping columns, expect two. Assert no attempt for a deterministic draft fallback that never contacts OpenAI, one attempt for a parsed-invalid response, and a fresh attempt UUID for a deliberate retry. In `triggered-order.processor.spec.ts`, distinguish `ORDER_RECOGNITION` from `ORDER_INTENT`.
- [ ] **Step 2: Run focused tests red.** Run `pnpm --filter @autosale/worker exec vitest run src/orders/openai-order-recognizer.spec.ts src/reply-drafts/openai-reply-draft-generator.spec.ts src/catalogue/openai-column-mapper.spec.ts src/catalogue/openai-table-structure-analyzer.spec.ts src/catalogue/openai-ambiguous-row-classifier.spec.ts`. Expected: context assertions fail.
- [ ] **Step 3: Pass the context through existing call sites.** Construct `AiUsageContext` only after existing freeze/lease gates. An order recognizer call receives the trigger message UUID and its mode-specific purpose; a reply generator receives `draftId`; all catalogue stages receive `runId`. In each adapter, replace only the `responses.create` call with `meteredResponses.create(input.usageContext, request)`; never create a second OpenAI client per layer. Preserve the app's existing mapped error types and the current product-table metadata, but remove `?? 0` from the **ledger** path. Example processor shape:

```ts
await generator.generate({
  usageContext: { tenantId, operationId: draftId, purpose: 'REPLY_DRAFT' },
  latestInbound: context.safe.latestInbound,
  recentContext: context.safe.recentContext,
  style: context.style,
  sources,
});
```

- [ ] **Step 4: Run focused and worker suites green.** Run `pnpm --filter @autosale/worker test`, then `pnpm --filter @autosale/worker typecheck`; expected PASS. Review all `new OpenAI` and `responses.create` matches with `rg -n 'new OpenAI|responses\.create' apps/worker/src` to prove no unmetered worker call remains. Commit `feat: meter order draft and catalogue model calls`.

### Task 4: Reconcile orphan attempts and enforce approved retention

**Files:**
- Modify: `packages/database/prisma/migrations/20261024_ai_provider_usage_attempts/migration.sql` or add a follow-on migration if Task 1 was already merged
- Create: `apps/worker/src/ai-usage/ai-usage.reconciler.ts`
- Create: `apps/worker/src/ai-usage/ai-usage.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `docs/operations/data-protection-and-retention.md`

**Interfaces:** `AiUsageReconciler.reconcile(now): Promise<{ unknown: number; purged: number }>`; each pass claims at most 100 IDs, finalizes overdue `STARTED` as `CHARGE_UNKNOWN` without a provider call, and removes at most 100 terminal records older than the approved 90-day cutoff. An attempt must remain long enough to reconcile before it is eligible for deletion.

- [ ] **Step 1: Write failing clock-controlled tests.** Seed one overdue and one fresh `STARTED`, one terminal row older than 90 days, one recent row, and two tenants. Assert only the overdue row becomes unknown, only the expired terminal row is purged, repeated passes are idempotent, and `sdk.responses.create` is never called. Assert a frozen tenant's already-dispatched attempt can finalize, but a new model call is blocked at the existing processor freeze gate.
- [ ] **Step 2: Run the reconciler tests red.** Run `pnpm --filter @autosale/worker exec vitest run src/ai-usage/ai-usage.reconciler.spec.ts`; expected: module absent.
- [ ] **Step 3: Add bounded discovery and deletion.** Follow `worker_due_ai_reply_drafts` migration style: a `SECURITY DEFINER` function with fixed `search_path`, `REVOKE ... FROM PUBLIC`, worker-only execute grant and hard limit. The orphan directory returns `tenant_id, attempt_id` only; each conditional `STARTED` → `CHARGE_UNKNOWN` update runs in `withTenantTransaction`. A separate worker-only `SECURITY DEFINER` retention function deletes at most 100 terminal records and returns a count, with `DELETE` denied to runtime roles. No runtime role makes an unrestricted cross-tenant table scan:

```sql
SELECT id, tenant_id FROM ai_provider_usage_attempts
WHERE outcome = 'STARTED' AND started_at < p_now - INTERVAL '15 minutes'
ORDER BY started_at, id
LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 100);
```

- [ ] **Step 4: Schedule the reconciler and guard rollout.** Follow existing `main.ts` bounded scheduler patterns. Emit only `operation='ai_usage_reconcile'` and bounded result/count metrics. Gate the 90-day deletion switch on the documented privacy/accounting approval before enabling production collection. Add the policy purpose, owner, exact 90-day rule, freeze-finalization exception and backup-expiry interaction to the data-protection runbook:

```ts
const aiUsageTimer = setInterval(() => void aiUsageReconciler.reconcile(new Date()), 60_000);
// Register the timer alongside existing worker shutdown cleanup in main.ts.
```
- [ ] **Step 5: Run worker and database tests, commit.** Run `pnpm --filter @autosale/database test`, `pnpm --filter @autosale/worker test`, and both package typechecks. Expected PASS. Commit `feat: reconcile and retain AI usage attempts`.

### Task 5: Build a private month report with explicit coverage and invoice inputs

**Files:**
- Create: `apps/worker/src/ai-usage/monthly-report.ts`
- Create: `apps/worker/src/ai-usage/monthly-report.spec.ts`
- Create: `apps/worker/src/ai-usage/report-cli.ts`
- Create: `apps/worker/src/ai-usage/report-cli.spec.ts`
- Modify: `apps/worker/package.json`
- Create: `docs/operations/ai-usage-cost-report.md`

**Interfaces:** `buildMonthlyAiUsageReport({ period, tenantIds, testTenantIds, rates, providerInvoice, infrastructureInvoice, attempts, orderIds, collectionGaps }): Report`. The operator CLI accepts an explicit tenant/cohort file and UTC `YYYY-MM`, reads tenant rows with `withTenantTransaction`, and emits only a private local report. Use decimal-string rates and integer token counts; compute with `Prisma.Decimal` rather than binary floating-point money math.

- [ ] **Step 1: Write failing pure report tests.** Use fictional attempts: an order and intent evaluation sharing one model response but only one ledger attempt; a draft with no order; two catalogue batches; a test tenant; an unknown-charge row; an unpriced cached-token row; one zero-order tenant. Assert included AI numerator contains all included attempts, denominator counts distinct `orders.id` in `[from, until)`, test cohort is separate, zero-order ratio is `null`, shared infrastructure is reported only as a global blended figure, and any missing invoice/rate/breakdown/gap/variance makes status `PROVISIONAL`.
- [ ] **Step 2: Run pure tests red.** Run `pnpm --filter @autosale/worker exec vitest run src/ai-usage/monthly-report.spec.ts`; expected: module absent.
- [ ] **Step 3: Implement pricing and reconciliation.** Require a versioned operator JSON input outside the repository with exact UTC rate-effective timestamps, model, input/output/cached-input prices as decimal strings per million tokens, provider project/account identity, invoice currency, invoice subtotal, credits/taxes and attributable infrastructure amount. Validate the external file before querying. Price only dimensions with known rates and usage, leave unknown buckets unpriced, compare computed pre-credit provider amount with matching invoice scope, report variance and status. Do not convert currencies or attribute shared host spend to individual tenants.

```ts
type CostStatus = 'COMPLETE' | 'PROVISIONAL';
const period: ReportPeriod = {
  from: new Date(`${month}-01T00:00:00.000Z`),
  until: firstDayOfNextUtcMonth(month),
};
const canonicalOrderIds = await withTenantTransaction(prisma, tenantId, tx =>
  tx.order.findMany({ where: { tenantId, createdAt: { gte: period.from, lt: period.until } },
    select: { id: true } }));
```

- [ ] **Step 4: Make the CLI private by construction.** Fail when the explicit authorized tenant list or provider project/account identity is missing; do not create a Nest controller, route or dashboard card. Write output only to an operator-selected local path under a private directory, with restrictive file permissions and no stdout dump of tenant totals. Validate that a test tenant is excluded only by explicit UUID membership and that raw request/response text never enters output.
- [ ] **Step 5: Run report tests and typecheck, commit.** Run the two focused tests and `pnpm --filter @autosale/worker typecheck`; expected PASS. Document exact invocation, invoice-scope checks, rate-source provenance, provisional states and safe artifact disposal in the operations guide. Commit `feat: report private AI usage and cost coverage`.

### Task 6: Verify the complete slice, release additively and record evidence

**Files:**
- Modify: `docs/features/README.md`
- Modify: `docs/superpowers/specs/2026-10-24-ai-provider-usage-ledger-design.md`
- Modify: `docs/operations/ai-usage-cost-report.md`
- Modify: `tasks/todo.md`
- Create: `docs/acceptance/ai-usage-cost-report-checklist.md`

**Interfaces:** No new product API. The evidence record names commit/image, migration, privacy approval, tests, browser paths, invoice scope and unresolved gaps without customer content.

- [ ] **Step 1: Run automated release gates.** Execute `pnpm build`, `pnpm typecheck`, `pnpm test`, focused two-tenant PostgreSQL isolation/export/report tests, and `git diff --check`. Expected: all pass. Review staged paths for `.env`, credentials, invoice inputs, database dumps, personal data, build output and runtime files; none may be committed.
- [ ] **Step 2: Prepare a recoverable production migration.** Follow `docs/operations/deployment.md` and `docs/operations/backup-restore.md`: record current master SHA and running image digests, take and verify a backup, inspect migration SQL and runtime grants, apply the additive migration, then manually deploy API/worker images. Keep collection disabled if the 90-day retention/privacy review is still open; in that case record deployment as schema-only and mark collection acceptance pending.
- [ ] **Step 3: Verify health and an authorized fictional tenant flow.** Check API/worker readiness and queue health. In a real browser, use only a fictional or explicitly authorized test tenant: run one catalogue mapping, one order-recognition trigger and one AI draft; after each, inspect the user-visible result and reload to verify persistence. Do not send an Instagram reply, create a shipment, or use customer data for this metering test. Read the private ledger through tenant-scoped operator tooling and confirm one row per actual model invocation, including catalogue batches; do not show tenant IDs as metric labels.
- [ ] **Step 4: Test report completeness without inventing a price.** If provider-account attribution, actual tariff and invoice exist, reconcile the month's known charges and record the variance; if not, retain `PROVISIONAL` and list the exact missing input. Confirm zero-order, test-cohort and infrastructure-allocation labels. Never claim the 30%-of-revenue hypothesis is proven by test-account samples.
- [ ] **Step 5: Update canonical docs and close only proven status.** Link source/tests/runbook/acceptance from `docs/features/README.md`; update spec status and `tasks/todo.md` only to the evidence actually achieved. Commit `docs: record AI usage metering acceptance`, merge the short-lived branch into `master`, push, verify remote SHA and working-tree status, then delete the merged branch after checking no unique tracked/untracked files remain. Leave `artifacts/` untouched.

## Self-review and acceptance mapping

- One row per possible charge, retries and parse-invalid outcomes: Tasks 2–3.
- Tenant RLS, minimal data, lifecycle export and freeze: Tasks 1, 3–4.
- Orphan unknowns, raw retention and non-blocking metering failure: Tasks 2 and 4.
- Private invoice-reconciled month report, canonical order denominator, test cohort, setup spend and shared infrastructure: Task 5.
- Backup, production activation gate, real-browser downstream checks and honest incomplete periods: Task 6.
- Deliberately excluded: subscriptions, payment collection, customer usage screen, autonomous reply send, historical cost backfill and legal approval itself.
