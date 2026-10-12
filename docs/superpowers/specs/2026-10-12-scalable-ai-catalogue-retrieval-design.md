# Scalable tenant-scoped catalogue retrieval for AI reply drafts

Status: **user-approved direction; written design awaiting review; not implemented** (12 October 2026).

## Problem and scope

`ReplyDraftProcessor` currently loads the first 2,000 active products in SKU order and ranks them in memory. A relevant product after that boundary is invisible to both the model and the deterministic options fallback. Raising the limit would move more catalogue data through every draft job and make latency and memory proportional to the entire tenant catalogue.

This design changes only candidate retrieval for existing manual and automatic AI reply drafts. The quiet period, one-draft-per-anchor lifecycle, eight-source prompt limit, claim validator, source snapshot, send-time freshness check, explicit manager send, and provider-specific reply windows stay unchanged. It does not add customer-visible autonomous sending, an external search service, or catalogue edits.

## Approaches considered

1. **Increase or remove the 2,000-row limit.** Smallest code change, but scans and transfers all tenant products for each draft and still needs a new arbitrary cap. Rejected for general availability.
2. **Indexed PostgreSQL candidate retrieval, followed by the existing deterministic ranker.** Recommended: keep one tenant-owned product record and one ranking/grounding implementation, reduce rows entering the worker, and allow relevant products anywhere in the catalogue.
3. **Separate search engine or replicated search table.** Could handle larger or semantic search later, but adds synchronization, recovery, tenant-isolation and operational boundaries without evidence that PostgreSQL is insufficient. Deferred.

## Retrieval boundary

Introduce a focused repository function called by `ReplyDraftProcessor` inside its existing `withTenantTransaction`. It receives the tenant ID, sanitized latest inbound text and at most three recent text messages. It returns a bounded set of active `Product` rows for the existing `selectCatalogueCandidates` ranker. It must not create a second draft pipeline or change the ranker's score or factual snapshot contract.

The database search has two ordered recall passes:

1. **High-intent terms:** exact case-insensitive SKU candidates and explicit model names extracted from the current message, falling back to recent context only as the current ranker does. A named model may have several variants. These matches take precedence over generic overlap, and matching a term solely in a parenthetical compatibility list must not make it a model option.
2. **General terms:** an indexed, token-based search across SKU, product name, aliases, brand, category, colour and size. Before the database cap, order by query coverage and field priority so an exact name or alias phrase is not displaced by many single-token generic matches; break ties by SKU and ID. This is a recall stage, not an answer or final relevance decision. The current ranker applies exact SKU/name/alias, model and overlap rules after retrieval. Variant attributes continue to be included only in verified source snapshots unless separately covered by tests and a later design change.

Search terms are derived from the already sanitized, bounded customer context: at most twelve distinct searchable tokens of 3–64 characters, plus a bounded exact SKU/model term. Empty, excessively long and non-searchable terms cannot produce an unbounded database scan. Queries are parameterized, explicitly filter `tenant_id` and `active = true`, and execute under the current tenant transaction/RLS. A deterministic database order and bounded per-pass result count prevent nondeterministic source sets. High-intent matches cannot be displaced by generic matches; an explicit model family that overflows its bounded pass must produce a fact-free clarification rather than an apparently exhaustive options list. The final model input remains at most eight source snapshots, and the options fallback remains at most four exact variants.

Use a PostgreSQL GIN index on a `simple`-configuration text-search expression over the named fields, plus an indexed case-insensitive exact-SKU lookup and the existing tenant/active boundary. These indexes are computed from product columns rather than maintained by a second table or trigger. The migration must be additive, with migration applied before the new worker. It must not write search terms, customer text, generated replies or prompts to application logs. A database retrieval error ends generation as `FAILED` with a safe code; it must not silently fall back to the old first-2,000 scan and present an incomplete answer. For an overflowed explicit model family, automatic preparation produces a fact-free `CLARIFY` draft and manual retry visibly blocks instead of spending a model call on incomplete options.

## Correctness and failure handling

- The product after SKU position 2,000 must be retrievable when the query names its SKU, explicit model, full product name or exact alias, without relying on its sort position or losing it to generic single-token matches.
- Exact SKU and explicit model precedence, dimension filtering, and primary-name-only model options remain intact. Generic matches cannot displace a high-intent result.
- Zero stock, unknown stock and missing currency keep their existing factual meanings. Retrieval never turns an unknown fact into an availability or price claim.
- Product edits or deactivation during generation still make the draft stale through the existing source-version guard. A ready draft still requires an explicit manager send and a fresh source check.
- Tenant A's terms and products cannot retrieve tenant B's rows, even when names and SKUs resemble each other. No customer text or search term is emitted in worker metrics or structured logs.
- Retrieval failure ends as `FAILED`; an overflowed explicit model family is handled as specified above; no ungrounded source is invented and no message is sent.

## Measurement and acceptance

Before implementation, capture the current result and retrieval time on the same fictional fixtures used after the change: 2,001 products with the relevant SKU last, and representative 10,000- and 50,000-product catalogues with exact SKU, named-model, alias and broad queries. The current 2,000-row prefix is a correctness-failing reference, not a fair performance baseline; compare indexed retrieval against a correctness-matched full scan over the same fixture. Record p50/p95 of the retrieval stage, rows returned to the worker, and `EXPLAIN (ANALYZE, BUFFERS)` for indexed queries. Use the same PostgreSQL version, fixture, hardware and warm/cold-cache method for before/after comparison; do not claim a performance win inside measurement noise.

Acceptance requires the formerly invisible product to appear in the verified eight-source set; the source result and claim-validator tests must remain green; retrieval must never materialize an entire large catalogue in the worker. The implementation plan will set a concrete latency gate from the measured baseline before code changes. A 50,000-product test is a scaling fixture, not a promise of unlimited catalogue size. Add automated tests for term extraction, retrieval precedence, tenant isolation/RLS, exact options, broad-query limits, snapshot freshness and failure handling. After deployment, verify a normal draft through the browser in the consenting test account, including persisted editor state after reload; the synthetic >2,000-row case stays in isolated test data, not in the production account.

## Rollout and rollback

Apply the additive index migration, deploy the worker, watch AI-draft queue backlog, generation latency and failure counters, and verify that logs remain privacy-minimized. The tenant owner switch remains the pilot gate. If latency or grounding regresses, return the worker to the previous version while leaving the harmless index in place; the old 2,000-row limit is an explicitly documented temporary rollback limitation. Do not mark AI drafts generally available until the broader live-provider pilot and catalogue-size benchmark both pass.
