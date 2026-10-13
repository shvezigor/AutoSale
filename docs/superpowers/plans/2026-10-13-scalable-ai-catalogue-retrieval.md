# Scalable AI Catalogue Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an active product anywhere in a tenant catalogue eligible for a grounded AI reply draft without loading the entire catalogue into the worker.

**Architecture:** Preserve `selectCatalogueCandidates` as the final deterministic ranker and the current draft lifecycle. Commit the existing draft claim first, then run indexed PostgreSQL recall in a separate tenant transaction; it returns bounded product IDs in two ordered passes (exact SKU/explicit model, then general terms), loads only those products, and reports an explicit-model overflow. This split ensures a failed SQL query cannot roll back the claim before a durable `FAILED` update; the processor never silently returns to the first-2,000 prefix.

**Tech Stack:** TypeScript, Prisma 7, PostgreSQL 17.6, Vitest, Testcontainers, pnpm, Playwright/browser acceptance.

**Spec:** [`docs/superpowers/specs/2026-10-12-scalable-ai-catalogue-retrieval-design.md`](../specs/2026-10-12-scalable-ai-catalogue-retrieval-design.md)

## Global Constraints

- Search only active products for the explicit tenant ID inside `withTenantTransaction`; PostgreSQL RLS remains a second boundary.
- Use sanitized latest inbound text and at most three recent text messages; at most 12 distinct searchable tokens of 3–64 characters plus bounded exact SKU/model terms.
- Keep the current ranker, at most eight source snapshots and at most four exact options. Do not make outbound replies automatic.
- Do not log raw customer text, search terms, prompts, source names, or generated replies.
- Apply the additive index migration before deploying the worker. Keep the tenant owner switch as the pilot gate.
- Never use real customer records in fixtures. Browser smoke uses the authorized test account; the 2,001/10,000/50,000-product fixtures stay isolated.
- An explicit model family overflowing the recall cap yields fact-free automatic `CLARIFY` or visible manual `BLOCKED`, without a model call. A retrieval error yields `FAILED`, not the old prefix scan.
- A performance claim requires same-version PostgreSQL, same fictional fixture/hardware/cache method, correctness-matched full-scan baseline, p50/p95 and `EXPLAIN (ANALYZE, BUFFERS)` evidence.
- Follow repository button/form/browser rules if any UI or API-visible status is changed; update canonical feature docs and `docs/features/README.md` in the behavior commit.

## File responsibility map

| File | Responsibility |
|---|---|
| `packages/database/prisma/migrations/20261013090000_ai_catalogue_search_indexes/migration.sql` | Add partial tenant/active lower-SKU B-tree and `simple` full-text GIN expression indexes; no product-table rewrite or search shadow table. |
| `apps/worker/src/reply-drafts/catalogue-candidates.ts` | Export one bounded search-intent extractor built from the existing normalization/model/options helpers; retain final ranker and snapshot rules. |
| `apps/worker/src/reply-drafts/catalogue-candidates.spec.ts` | Prove term bounds, model extraction/context fallback, dimensions, existing rank and factual semantics. |
| `apps/worker/src/reply-drafts/catalogue-retrieval.ts` | Tenant-scoped parameterized indexed recall, deterministic high-intent/general ordering, bounded ID selection and product hydration. |
| `apps/worker/src/reply-drafts/catalogue-retrieval.postgres.spec.ts` | Isolated PostgreSQL integration: >2,000 position, query precedence, overflow, RLS and broad-query bounds. |
| `apps/worker/src/reply-drafts/reply-draft.processor.ts` and `.spec.ts` | Replace prefix fetch; map overflow/failure to durable statuses without model spend; prove source freshness remains intact. |
| `apps/worker/src/reply-drafts/catalogue-retrieval.bench.spec.ts` | Opt-in Vitest benchmark with fictional fixtures and plan collection, skipped in normal tests. |
| `packages/contracts/src/reply-drafts.ts`, `apps/api/src/conversations/reply-drafts.service.ts`, `apps/web/src/components/social-reply-composer.tsx`, `apps/web/src/i18n/messages/{uk,en}.ts` | Safe error-code schema/serialization and localized presentation for new outcomes; no raw database errors. |
| `docs/superpowers/specs/2026-10-04-catalogue-grounded-ai-reply-drafts-design.md`, `docs/superpowers/specs/2026-10-12-scalable-ai-catalogue-retrieval-design.md`, `docs/acceptance/ai-reply-drafts-checklist.md`, `docs/features/README.md` | Canonical behavior, rollout/rollback, measured evidence, browser acceptance and evidence-based status. |

---

### Task 1: Establish the correctness-matched baseline and additive indexes

**Files:** Create `apps/worker/src/reply-drafts/catalogue-retrieval.bench.spec.ts`; create `packages/database/prisma/migrations/20261013090000_ai_catalogue_search_indexes/migration.sql`; modify `docs/superpowers/specs/2026-10-12-scalable-ai-catalogue-retrieval-design.md` with measured baseline and gate.

**Interfaces:** The benchmark exports `runCatalogueRetrievalBenchmark(databaseUrl: string): Promise<BenchmarkReport>` and creates only fictional tenants/products in an isolated database. The later repository uses the exact full-text expression in this migration. The gate, fixed before Task 3, is indexed p95 under the correctness-matched full-scan p95 and at most 250 ms for a 50,000-row tenant on the benchmark host; if the full-scan p95 is already below 250 ms, require at least a 25% p95 reduction. Record measurement noise and do not assert a win within it.

- [ ] **Step 1: Write a failing index contract test.** In `apps/worker/src/reply-drafts/catalogue-retrieval.postgres.spec.ts`, after applying migrations to PostgreSQL 17.6, query `pg_indexes` and assert the two expected index names and expression/partial predicate; assert a fictional tenant's 2,001st SKU is not in the old 2,000-row prefix.

```ts
const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
  SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'products'
`;
expect(indexes.find((row) => row.indexname === 'products_ai_search_fts_idx')?.indexdef)
  .toContain("to_tsvector('simple'");
expect(indexes.find((row) => row.indexname === 'products_ai_search_sku_idx')?.indexdef)
  .toContain('lower(sku)');
```

- [ ] **Step 2: Run red.** `pnpm --filter @autosale/worker exec vitest run src/reply-drafts/catalogue-retrieval.postgres.spec.ts`; expect the index assertions to fail. Docker/Testcontainers must be available.
- [ ] **Step 3: Implement only the indexes and benchmark.** Use the following exact SQL expression in both the index and Task 3's search query. In the benchmark use `generate_series` to insert 2,001, 10,000 and 50,000 clearly fictional rows; compare the old prefix, correctness-matched full scan and later indexed query for exact SKU/model/name/alias/broad cases; use `performance.now()` for 30 warm iterations after 5 warmups and collect `EXPLAIN (ANALYZE, BUFFERS)` without printing customer text. Save the before-code-change report and derive the gate in the spec.

```sql
CREATE INDEX "products_ai_search_sku_idx" ON "products" ("tenant_id", lower("sku")) WHERE "active" = true;
CREATE INDEX "products_ai_search_fts_idx" ON "products" USING gin (
  to_tsvector('simple', coalesce("sku", '') || ' ' || coalesce("name", '') || ' ' ||
    coalesce("aliases"::text, '') || ' ' || coalesce("brand", '') || ' ' ||
    coalesce("category", '') || ' ' || coalesce("color", '') || ' ' || coalesce("size", ''))
) WHERE "active" = true;
```

- [ ] **Step 4: Run green and inspect plan.** Run the focused Vitest command above. On the isolated Testcontainers database run the opt-in benchmark with `RUN_CATALOGUE_BENCH=1 pnpm --filter @autosale/worker exec vitest run src/reply-drafts/catalogue-retrieval.bench.spec.ts` (PowerShell: `$env:RUN_CATALOGUE_BENCH='1'; pnpm --filter @autosale/worker exec vitest run src/reply-drafts/catalogue-retrieval.bench.spec.ts; Remove-Item Env:RUN_CATALOGUE_BENCH`). Record PostgreSQL version, host/cache method, p50/p95 and rows transferred. If the index expression is rejected as non-immutable, adjust it to an equivalent immutable concatenation before proceeding.
- [ ] **Step 5: Commit.** Stage only the migration, benchmark, contract test and benchmark evidence in the design spec; `git commit -m "test: baseline and index catalogue recall"`.

### Task 2: Bound and share search-intent semantics

**Files:** Modify `apps/worker/src/reply-drafts/catalogue-candidates.ts`; modify `apps/worker/src/reply-drafts/catalogue-candidates.spec.ts`.

**Interfaces:** Export `extractCatalogueSearchIntent(latestInbound: string, recentContext: readonly string[]): { tokens: string[]; exactTerms: string[]; explicitModels: string[]; query: string; asksForOptions: boolean }`. `query` is normalized and input-bounded by the existing sanitizer; exact terms must be independently capped to 64 characters. The extractor must reuse `requestedModelTokens`, `normalize` and `asksForOptions`, not invent a second model grammar. `selectCatalogueCandidates` and `selectRequestedModelSources` keep existing signatures.

- [ ] **Step 1: Write failing unit tests.** Include a latest-message model, fallback from one of three prior messages, a fourth prior message ignored, duplicate/case-folded tokens, >64-character token rejected, 13 distinct terms capped at 12, punctuation-only input returning no terms, and primary-name-only model matching (`Додатковий замок (Регіон)` must not become a Регіон option). Add a 2,001st-product ranker regression only if the test does not duplicate retrieval integration.

```ts
const intent = extractCatalogueSearchIntent('покажіть моделі дверей Регіон', ['потрібен розмір 860х2050']);
expect(intent.explicitModels).toContain('регіон');
expect(intent.tokens.length).toBeLessThanOrEqual(12);
expect(intent.asksForOptions).toBe(true);
```

- [ ] **Step 2: Run red.** `pnpm --filter @autosale/worker exec vitest run src/reply-drafts/catalogue-candidates.spec.ts`; expect missing export/test failures.
- [ ] **Step 3: Add the minimal extractor.** Normalize the latest message plus `recentContext.slice(-3)`, reuse `requestedModelTokens`, take 12 unique tokens from existing `tokens()` after filtering length `<=64`, derive bounded whole SKU-like terms from the latest message plus context, and use existing `asksForOptions`. Keep the model-token fallback order intact. Do not alter score weights, source snapshot shape, `stockQuantity` or price/currency handling.

```ts
export function extractCatalogueSearchIntent(latestInbound: string, recentContext: readonly string[]) {
  const query = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  const searchable = [...tokens(query)].filter((term) => term.length <= 64).slice(0, 12);
  return { query, tokens: searchable,
    exactTerms: [...new Set(query.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [])]
      .filter((term) => term.length >= 3 && term.length <= 64).slice(0, 12),
    explicitModels: requestedModelTokens(latestInbound, recentContext).filter((term) => term.length <= 64),
    asksForOptions: asksForOptions(latestInbound, recentContext) };
}
```

- [ ] **Step 4: Run green.** Run the focused unit spec and `pnpm --filter @autosale/worker typecheck`; expected PASS.
- [ ] **Step 5: Commit.** `git add apps/worker/src/reply-drafts/catalogue-candidates* && git commit -m "feat: bound AI catalogue search intent"`.

### Task 3: Implement indexed, tenant-safe two-pass recall

**Files:** Create/modify `apps/worker/src/reply-drafts/catalogue-retrieval.ts` and `.postgres.spec.ts`.

**Interfaces:** Export `retrieveCatalogueCandidates(tx: Prisma.TransactionClient, tenantId: string, latestInbound: string, recentContext: readonly string[]): Promise<{ products: CatalogueCandidateInput[]; modelOverflow: boolean }>`. A model pass fetches at most 65 IDs (64 + overflow sentinel), exact-SKU pass at most 8, generic pass at most 128. Deduplicate IDs in high-intent-first order and hydrate at most 200 products with the existing `Product` select. Never use an unbounded `findMany`, and never insert customer text into an SQL string; use `Prisma.sql`/`Prisma.join` bindings. Empty intent returns no products without a query.

- [ ] **Step 1: Write failing PostgreSQL integration cases.** Seed fictional tenants, put matching SKU/model/full name/alias after 2,000 earlier SKUs, include generic distractors and a compatibility-only parenthetical name, then assert the desired ID is returned for each query. Assert >64 explicit-model variants reports overflow; a broad query returns `products.length <= 200`; deactivated and other-tenant products are absent; a transaction in tenant A cannot read tenant B under the runtime role/RLS fixture.

```ts
const result = await withTenantTransaction(prisma, tenantA, (tx) =>
  retrieveCatalogueCandidates(tx, tenantA, 'Покажіть модель Регіон 860х2050', []));
expect(result.products.map((product) => product.id)).toContain(lastProductId);
expect(result.products.map((product) => product.tenantId)).toEqual(
  expect.arrayContaining([tenantA]));
```

- [ ] **Step 2: Run red.** `pnpm --filter @autosale/worker exec vitest run src/reply-drafts/catalogue-retrieval.postgres.spec.ts`; expect missing repository failures.
- [ ] **Step 3: Implement the bounded repository.** Use `lower(sku) = ${term}` for exact SKU and the indexed `to_tsvector('simple', same_expression) @@ to_tsquery('simple', ${boundTokenOrExpression})` as a superset for model/general recall. Join escaped search tokens with `|` for general recall (not `plainto_tsquery`'s all-token AND, which loses normal sentences), then post-filter model matches against `split_part(lower(name),'(',1)` with whole-term boundaries. Score general hits in SQL by exact whole name/alias phrase, matched query-token count and field priority before `LIMIT 128`; tie-break by `sku COLLATE "C", id`. A model pass must check all 65 sentinel hits before choosing 64; never report an apparently exhaustive options list after overflow. Hydrate selected IDs with a single bounded `tx.product.findMany`, then restore SQL order in memory. Ensure the query uses both explicit tenant and active predicates and RLS transaction context.

```ts
const exactSkuIds = intent.exactTerms.length === 0 ? [] : await tx.$queryRaw<{ id: string }[]>`
  SELECT id FROM products WHERE tenant_id = ${tenantId}::uuid AND active = true
    AND lower(sku) IN (${Prisma.join(intent.exactTerms)})
  ORDER BY sku COLLATE "C", id LIMIT 8
`;
const modelOverflow = modelIds.length > 64;
const orderedIds = [...new Set([
  ...exactSkuIds.map((row) => row.id), ...modelIds.slice(0, 64).map((row) => row.id),
  ...generalIds.slice(0, 128).map((row) => row.id),
])].slice(0, 200);
const hydrated = await tx.product.findMany({
  where: { tenantId, active: true, id: { in: orderedIds } },
  select: { id: true, tenantId: true, sku: true, name: true, aliases: true,
    brand: true, category: true, color: true, size: true, attributes: true,
    price: true, currency: true, stockQuantity: true, active: true, updatedAt: true },
});
const byId = new Map(hydrated.map((product) => [product.id, product]));
return { products: orderedIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), modelOverflow };
```

`modelIds` and `generalIds` are bounded raw-query ID rows produced earlier in the same function; their SQL must apply the precise index expression from Task 1, a parameterized tenant/active predicate, SQL-side relevance ordering before the limit, and `LIMIT 65`/`LIMIT 128` respectively. Do not interpolate unescaped terms into SQL syntax; construct token tsquery text only from the constrained alphanumeric token set and pass it as a bound parameter.
- [ ] **Step 4: Run green and inspect bounded plans.** Run focused PostgreSQL test, `pnpm --filter @autosale/worker typecheck`, and benchmark after implementation. Assert indexed p95 meets Task 1's recorded gate and that `EXPLAIN (ANALYZE, BUFFERS)` shows no full tenant scan on selective 10,000/50,000-row cases. Broad terms may touch more index postings but must still return bounded rows. Keep the actual benchmark evidence in the spec.
- [ ] **Step 5: Commit.** `git add apps/worker/src/reply-drafts/catalogue-retrieval* docs/superpowers/specs/2026-10-12-scalable-ai-catalogue-retrieval-design.md && git commit -m "feat: recall bounded tenant catalogue candidates"`.

### Task 4: Integrate safe outcomes into draft processing

**Files:** Modify `apps/worker/src/reply-drafts/reply-draft.processor.ts` and `.spec.ts`, `packages/contracts/src/reply-drafts.ts`, `apps/api/src/conversations/reply-drafts.service.ts` and `.spec.ts`, `apps/web/src/components/social-reply-composer.tsx` and `.spec.tsx`, and `apps/web/src/i18n/messages/{uk,en}.ts`.

**Interfaces:** Replace the 2,000-row fetch with `retrieveCatalogueCandidates`. `modelOverflow` bypasses `generator.generate`: automatic => `READY`/`CLARIFY`, fact-free text, empty source/product IDs; manual => `BLOCKED` with safe code `CATALOGUE_MODEL_OVERFLOW`. Retrieval exception => durable `FAILED` with safe code `CATALOGUE_RETRIEVAL_FAILED`. Extend `finish` error union. Do not weaken lease, source snapshot, source version, validator or explicit send guards.

- [ ] **Step 1: Write failing processor tests.** Spy on the generator. For >64 matching model variants, assert automatic clarification and manual block each make zero model calls. Force repository failure (e.g. inject a failing query in the recall transaction) and assert the already committed claim becomes durable `FAILED` with one attempt, without model call or prefix fallback. Add a >2,000 SKU test whose expected `sourceSnapshot` contains the last product; retain changed-product `STALE`, zero stock, null stock/missing currency, and tenant isolation regressions.
- [ ] **Step 2: Run red.** `pnpm --filter @autosale/worker exec vitest run src/reply-drafts/reply-draft.processor.spec.ts`; expect overflow/failure/large-catalogue assertions to fail.
- [ ] **Step 3: Implement the processor transaction split and safe outcomes.** The first `withTenantTransaction` commits the draft claim/lease, style and safe message context without product search. A second `withTenantTransaction` performs recall and persists `sourceSnapshot` under the same lease; after it commits, proceed to `modelRequestStartedAt`. Catch retrieval errors **outside** that second transaction, then call `finish` in a fresh tenant transaction to persist `FAILED`/`CATALOGUE_RETRIEVAL_FAILED` against the committed lease; rethrow unrelated claim/tenant errors. For overflow, persist the appropriate automatic/manual result before `modelRequestStartedAt`; automatic text comes from `safeAutomaticClarification` and no catalogue source is presented. Keep downstream `selectCatalogueCandidates(...)` unchanged, plus the existing final anchor and source-version checks after generation. Add both error codes to the contract enum and API safe-code allowlist and show localized, actionable status text in the existing composer; no raw DB error reaches API/UI.

```ts
const recalled = await retrieveCatalogueCandidates(
  tx, tenantId, safe.latestInbound, safe.recentContext,
);
if (recalled.modelOverflow) {
  const automatic = draft.triggerSource === 'AUTOMATIC';
  const clarification = safeAutomaticClarification(safe.latestInbound);
  await tx.aiReplyDraft.updateMany({
    where: { id: draftId, tenantId, leaseId, status: 'PROCESSING' },
    data: { status: automatic ? 'READY' : 'BLOCKED',
      outcome: automatic ? 'CLARIFY' : null,
      generatedText: automatic ? clarification.text : null,
      sourceSnapshot: [], errorCode: automatic ? null : 'CATALOGUE_MODEL_OVERFLOW',
      leaseId: null, leaseExpiresAt: null },
  });
  return { outcome: automatic ? 'READY' as const : 'BLOCKED' as const };
}
const sources = selectCatalogueCandidates(
  recalled.products, tenantId, safe.latestInbound, safe.recentContext,
);
```

At the processor's outer boundary, return the new `READY`/`BLOCKED` context outcome before `modelRequestStartedAt`; if recall alone throws, identify it with a narrow repository error class so unrelated failures still surface, and call `finish` in a fresh transaction. The claim must already be committed; otherwise `finish` cannot match the lease after PostgreSQL aborts the recall transaction.
- [ ] **Step 4: Run green.** Run processor, ranker, API contract and relevant web specs, then `pnpm --filter @autosale/worker typecheck` and `pnpm --filter @autosale/worker build`; expected PASS.
- [ ] **Step 5: Commit.** Stage processor, tests and any necessary existing status-copy file; `git commit -m "feat: fail closed on AI catalogue recall limits"`.

### Task 5: Verify, document and roll out

**Files:** Modify the two canonical AI draft designs, `docs/acceptance/ai-reply-drafts-checklist.md`, `docs/features/README.md`; modify operational deployment notes only if migration/deploy commands or rollback steps differ from the existing runbook.

**Interfaces:** No new runtime API. The feature index must point to the implemented repository and benchmark, and must retain `In progress` until full provider/browser pilot acceptance is proven.

- [ ] **Step 1: Run complete relevant automation.** `pnpm --filter @autosale/worker test`, `pnpm --filter @autosale/worker typecheck`, `pnpm --filter @autosale/worker build`, `pnpm --filter @autosale/database test`, plus affected API/web tests. Distinguish environment failures from code failures.
- [ ] **Step 2: Verify migration and rollout order.** On staging or the designated test environment, apply additive indexes before deploying the new worker. Confirm index presence, queue backlog/generation failures and no customer-text logging. Keep old worker rollback possible without dropping indexes; document its temporary 2,000-row limitation.
- [ ] **Step 3: Browser acceptance after deployment.** In the authorized test account, use fictional catalogue/customer data only. Request a normal draft, wait for ready editor text, reload and verify persistence, inspect compact sources, edit the linked product and verify stale-source send prevention. Also exercise visible manual error/overflow state if safely reproducible. Capture a screenshot for the resulting editor/status. Do not import 50,000 products to production; use isolated integration/benchmark fixtures.
- [ ] **Step 4: Update documents with evidence.** Record actual benchmark p50/p95, rows and plans; add checked/unchecked acceptance rows for success, failure, reload, stale source, tenant isolation and live provider gap. Update canonical retrieval section and feature index wording/status in the same scoped commit as final behavior. If browser credentials or provider approval block a step, name that exact step and leave it unchecked.
- [ ] **Step 5: Commit and finish branch.** `git add` only scoped source/tests/docs; verify `git diff --cached --name-only` excludes `.env`, secrets, dumps, runtime files, build output and production data. Commit. From `master`, merge the short-lived `codex/*` branch, push `master`, prove no unique tracked/untracked work remains, delete the merged branch and clean only its own worktree. Never touch pre-existing `artifacts/` or other user files.

## Self-review

- Spec coverage: exact SKU/model/name/alias after 2,000, source/option limits, overflow, error, tenant/RLS, factual null/zero semantics, stale snapshot, performance, rollout, browser smoke and pilot status each map to Tasks 1–5.
- No independent new service, table, queue or UI flow is planned. The one new worker repository sits behind the existing draft processor.
- Exact SQL expression, threshold and fixture evidence are locked in Task 1 before retrieval code in Task 3; later steps use the interfaces above.
