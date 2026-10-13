# Scalable tenant-scoped catalogue retrieval for AI reply drafts

Status: **deployed to the current Docker-host production site; new-draft and send-time stale-guard browser acceptance passed; controlled pilot pending** (13 October 2026). The step-by-step implementation and verification plan is [`2026-10-13-scalable-ai-catalogue-retrieval.md`](../plans/2026-10-13-scalable-ai-catalogue-retrieval.md).

## Problem and scope

The previous `ReplyDraftProcessor` loaded the first 2,000 active products in SKU order and ranked them in memory. A relevant product after that boundary was invisible to both the model and the deterministic options fallback. Raising the limit would have moved more catalogue data through every draft job and made latency and memory proportional to the entire tenant catalogue.

This design changes only candidate retrieval for existing manual and automatic AI reply drafts. The quiet period, one-draft-per-anchor lifecycle, eight-source prompt limit, claim validator, source snapshot, send-time freshness check, explicit manager send, and provider-specific reply windows stay unchanged. It does not add customer-visible autonomous sending, an external search service, or catalogue edits.

## Approaches considered

1. **Increase or remove the 2,000-row limit.** Smallest code change, but scans and transfers all tenant products for each draft and still needs a new arbitrary cap. Rejected for general availability.
2. **Indexed PostgreSQL candidate retrieval, followed by the existing deterministic ranker.** Recommended: keep one tenant-owned product record and one ranking/grounding implementation, reduce rows entering the worker, and allow relevant products anywhere in the catalogue.
3. **Separate search engine or replicated search table.** Could handle larger or semantic search later, but adds synchronization, recovery, tenant-isolation and operational boundaries without evidence that PostgreSQL is insufficient. Deferred.

## Retrieval boundary

The focused `retrieveCatalogueCandidates` repository runs inside a separate `withTenantTransaction` after the processor commits its draft claim. It receives the tenant ID, sanitized latest inbound text and at most three recent text messages. It returns a bounded set of active `Product` rows for the existing `selectCatalogueCandidates` ranker. This is not a second draft pipeline and does not change the ranker's score or factual snapshot contract.

The database search has two ordered recall passes:

1. **High-intent terms:** exact case-insensitive SKU candidates and explicit model names extracted from the current message, falling back to recent context only as the current ranker does. A named model may have several variants. These matches take precedence over generic overlap, and matching a term solely in a parenthetical compatibility list must not make it a model option.
2. **General terms:** an indexed, token-based search across SKU, product name, aliases, brand, category, colour and size. Before the database cap, order by query coverage and field priority so an exact name or alias phrase is not displaced by many single-token generic matches; break ties by SKU and ID. This is a recall stage, not an answer or final relevance decision. The current ranker applies exact SKU/name/alias, model and overlap rules after retrieval. Variant attributes continue to be included only in verified source snapshots unless separately covered by tests and a later design change.

Search terms are derived from the already sanitized, bounded customer context: at most twelve distinct searchable tokens of 3–64 characters, plus a bounded exact SKU/model term. Empty, excessively long and non-searchable terms cannot produce an unbounded database scan. Queries are parameterized, explicitly filter `tenant_id` and `active = true`, and execute under the current tenant transaction/RLS. A deterministic database order and bounded per-pass result count prevent nondeterministic source sets. High-intent matches cannot be displaced by generic matches; an explicit model family that overflows its bounded pass must produce a fact-free clarification rather than an apparently exhaustive options list. The final model input remains at most eight source snapshots, and the options fallback remains at most four exact variants.

Use a PostgreSQL GIN index on a `simple`-configuration text-search expression over the named fields, plus an indexed case-insensitive exact-SKU lookup and the existing tenant/active boundary. These indexes are computed from product columns rather than maintained by a second table or trigger. The migration must be additive, with migration applied before the new worker. It must not write search terms, customer text, generated replies or prompts to application logs. A database retrieval error ends generation as `FAILED` with a safe code; it must not silently fall back to the old first-2,000 scan and present an incomplete answer. For an overflowed explicit model family, automatic preparation produces a fact-free `CLARIFY` draft and manual retry visibly blocks instead of spending a model call on incomplete options.

Explicit models in recent context are extracted from each of the last three messages independently, so a model name cannot accidentally absorb the first word of the next message.

The indexed recall implementation excludes common Ukrainian/English request words from its twelve-token search budget. If a natural phrase yields several possible model terms (for example, `моделі дверей Регіон`), it checks each bounded term separately and uses the smallest nonempty primary-name family; this avoids treating a generic product type as the named model. Exact SKU or a resolved explicit model skips generic recall. General recall first tries all searchable terms together, then falls back to a bounded coverage-ranked OR search only when the AND pass is empty. The final in-memory ranker and factual source snapshots are unchanged.

## Correctness and failure handling

- The product after SKU position 2,000 must be retrievable when the query names its SKU, explicit model, full product name or exact alias, without relying on its sort position or losing it to generic single-token matches.
- Exact SKU and explicit model precedence, dimension filtering, and primary-name-only model options remain intact. Generic matches cannot displace a high-intent result.
- Zero stock, unknown stock and missing currency keep their existing factual meanings. Retrieval never turns an unknown fact into an availability or price claim.
- Product edits or deactivation during generation still make the draft stale through the existing source-version guard. A ready draft still requires an explicit manager send and a fresh source check.
- Tenant A's terms and products cannot retrieve tenant B's rows, even when names and SKUs resemble each other. No customer text or search term is emitted in worker metrics or structured logs.
- Retrieval failure ends as `FAILED`; an overflowed explicit model family is handled as specified above; no ungrounded source is invented and no message is sent.

## Measurement and acceptance

### Pre-retrieval-code benchmark (isolated fictional database, 13 October 2026)

The opt-in `catalogue-retrieval.bench.spec.ts` used PostgreSQL 17.6-alpine in Testcontainers on Windows/Docker Desktop (AMD Ryzen 7 5700X, 32 GiB host RAM). Each fixture was analyzed after insertion, with five warmups and 30 warm-cache samples per query, on the same host and process. The old 2,000-SKU prefix was verified to miss the 2,001st product. The correctness-matched baseline transferred all active product columns for every tenant row; the indexed SQL prototype transferred one row for selective SKU/model/name/alias queries and at most 128 for a broad query. No production/customer data was used.

| Active products | Full-scan p50 / p95, rows | Exact SKU indexed p95, rows | Model/name/alias indexed p95, rows | Broad indexed p95, rows |
|---:|---:|---:|---:|---:|
| 2,001 | 10.02 / 16.84 ms, 2,001 | 0.67 ms, 1 | 1.15 / 1.01 / 1.09 ms, 1 | 2.21 ms, 128 |
| 10,000 | 41.23 / 51.91 ms, 10,000 | 0.65 ms, 1 | 1.75 / 2.46 / 1.90 ms, 1 | 5.62 ms, 128 |
| 50,000 | 195.46 / 227.26 ms, 50,000 | 0.80 ms, 1 | 3.00 / 4.10 / 2.87 ms, 1 | 25.67 ms, 128 |

`EXPLAIN (ANALYZE, BUFFERS)` used `products_ai_search_sku_idx` for the 50,000-row exact lookup (4 shared-hit blocks, 0 reads) and `products_ai_search_fts_idx` for model/name/alias (319–321 shared-hit blocks, 0 reads). The broad query used the GIN index with 1,277 shared-hit blocks, 0 reads. These figures are warm-cache local evidence, not a production SLA. Before implementing worker retrieval, the acceptance gate is fixed at **p95 ≤170 ms on the 50,000-row fixture across all five query cases**, at least 25% below the measured 227.26 ms full-scan p95, with ≤200 hydrated rows and the relevant last product present in each selective result. Repeat on the same host/fixture/cache method after integrating the actual repository; if the difference falls within measurement noise, do not claim a performance improvement.

### Repository measurement after indexed recall code

The same opt-in benchmark now includes the actual `retrieveCatalogueCandidates` function inside `withTenantTransaction`, including bounded ID recall and product hydration. On the 50,000-row fictional fixture, 30 warm-cache samples after five warmups yielded:

| Case | Repository p50 / p95 | Hydrated rows |
|---|---:|---:|
| Exact SKU | 2.78 / 3.40 ms | 1 |
| Explicit model | 5.31 / 5.92 ms | 1 |
| Full name | 8.72 / 12.51 ms | 1 |
| Exact alias | 8.41 / 11.83 ms | 1 |
| Broad single word | 76.33 / 93.08 ms | 128 |

All five cases met the previously fixed 170 ms p95 gate and the selective cases returned the last product. The correctness-matched full scan in this repeat was 206.91 / 223.87 ms (p50/p95) and transferred 50,000 rows. Small-fixture broad-query timings (14.09 ms p95 indexed repository versus 15.00 ms p95 full scan at 2,001 rows) are too close to measurement noise to support a speed claim. The above remains isolated local evidence, not a production latency guarantee; worker integration and production-browser acceptance are separate gates.

The recorded before/after fixture uses 2,001, 10,000 and 50,000 fictional products. The previous 2,000-row prefix is a correctness-failing reference, not a fair performance baseline; the repository benchmark compares indexed retrieval with a correctness-matched full scan on the same PostgreSQL version, host and warm-cache method. The 50,000-row measurements above prove the local gate only; they are not a production latency guarantee.

Acceptance requires the formerly invisible product to appear in the verified eight-source set; the source result and claim-validator tests must remain green; retrieval must never materialize an entire large catalogue in the worker. The implementation plan will set a concrete latency gate from the measured baseline before code changes. A 50,000-product test is a scaling fixture, not a promise of unlimited catalogue size. Add automated tests for term extraction, retrieval precedence, tenant isolation/RLS, exact options, broad-query limits, snapshot freshness and failure handling. After deployment, verify a normal draft through the browser in the consenting test account, including persisted editor state after reload; the synthetic >2,000-row case stays in isolated test data, not in the production account.

The post-deployment test-account browser check on 13 October 2026 passed the new-draft editor/reload/source gate: two inbound messages within four seconds staled the first queued draft without a model attempt, then produced one `READY`/`ANSWER` draft for the second anchor. A real browser reload retained its size-matched reply in the untouched editor with eight catalogue sources collapsed. The provider call took 4,047 ms; no outbound message was created. A subsequent authorized source-product edit changed the product version before one send attempt; the draft became `STALE`/`SOURCE_CHANGED`, the editor retained its text, and no outbound row was created. The original product value was restored and verified after reload. These isolated observations do not establish a latency SLA or complete the controlled pilot. Detailed evidence and remaining gates stay in the [acceptance checklist](../../acceptance/ai-reply-drafts-checklist.md).

## Rollout and rollback

Apply the additive index migration, deploy the worker, watch AI-draft queue backlog, generation latency and failure counters, and verify that logs remain privacy-minimized. The tenant owner switch remains the pilot gate. If latency or grounding regresses, return the worker to the previous version while leaving the harmless index in place; the old 2,000-row limit is an explicitly documented temporary rollback limitation. Do not mark AI drafts generally available until the broader live-provider pilot and catalogue-size benchmark both pass.
