# Tenant isolation review: tenant-2

This is a source-only assessment using the supplied evidence, including separately reported isolated database tests; I did not run those tests or access any environment. PostgreSQL version, ORM/pooler details and source locations were not provided.

- T1: SELECT by invoice ID has no ORM tenant predicate.
- T2: Actual restricted runtime identity is neither owner, superuser nor BYPASSRLS; forced RLS correctly scopes SELECT and write checks to authenticated transaction context.
- T3: Isolated A/B read/write tests passed under that runtime identity.
- T4: Global maintenance role deliberately bypasses RLS and the supplied access map makes it inaccessible to ordinary callers.
- T5: Cache key is invoice ID alone. IDs are globally unique. Cache hits skip current caller authorization. No runtime cache tests exist.

| Entry point | Trusted tenant source | Runtime role/context | Enforcement | Evidence/status |
|---|---|---|---|---|
| Direct invoice SQL | Authenticated transaction context | Restricted role in T2 | Correct SELECT and write RLS | T2/T3: supplied passing isolated evidence |
| Cache hit | Current caller authorization skipped | Database may not be called | ID-only lookup | T5: source-supported boundary gap, runtime reachability untested |
| Maintenance | Explicit privileged access map | Global bypass role | Restricted administrative reachability | T4: intentional privilege; no ordinary-caller violation demonstrated |

## Ranked findings

1. **High priority: cache-hit authorization bypass.** Actor: a caller without current access to a target invoice, such as A requesting a B invoice already cached or a previously authorized member whose access was revoked. Entry point: invoice-ID cache lookup. Expected: every response is authorized for the current principal and tenant. Actual: T5 says a hit skips that decision. A cache hit can therefore return a previously cached invoice without the RLS check that protects a database miss. Consequence: cross-tenant or revoked-member data disclosure if the caller can reach the lookup with that ID and the value exists. Confidence is high in the missing source boundary, but there is no supplied runtime cache test or actual disclosure incident. Do not describe exploitation as observed; verify reachable ID input, cache population and response behavior.

   Counter-evidence: globally unique IDs avoid accidental same-ID collision and T2/T3 protect database access; neither authorizes the current cache reader. Minimal remedy, owned by the invoice read/cache service: enforce current caller/tenant authorization on every hit and miss using the existing authorization owner. Derive any tenant component from trusted context. Qualifying cache keys by tenant may prevent accidental sharing, but is insufficient by itself for membership revocation or invoice-specific permissions. Do not cache a long-lived permission decision without an explicit invalidation/revalidation contract.

2. **Defense-in-depth observation, not confirmed SQL leak:** T1's missing ORM predicate is not an exploitable direct SQL tenant leak under T2/T3. Preserve that concrete counter-evidence. A service predicate might help clarity or robustness if existing conventions require it, but duplicating enforcement is not the primary repair supported here.

3. **No finding against the maintenance role from supplied evidence:** T4 describes intended privilege with no ordinary-caller access path. Retain explicit access control and auditability. Reassess only if new evidence shows reachable credentials, role switching, a privileged function or job accessible to an unauthorized caller.

## Negative acceptance plan

| Fictional case | Runtime identity | Expected result | No-side-effect assertion | Evidence status |
|---|---|---|---|---|
| A/B direct reads and writes | Restricted runtime role | Same-tenant allow; cross-tenant deny | No unauthorized writes/effects | Passed in independently supplied isolated tests T3; not rerun |
| Warm B invoice as B, request same ID as A | Ordinary A through real cache path | No B payload or cached metadata disclosed | No write/event/job/provider effect | Proposed |
| Same-tenant authorized cache hit | Ordinary authorized A | Correct A response | No unexpected mutation/effect | Proposed |
| Warm A cache, revoke member, retry same ID | Revoked member | Deny according to current membership contract | No cached disclosure or mutation/effect | Proposed |
| Switch tenant or omit/forge context on cache hit and miss | Actual application identity | Fail closed for unauthorized context | No data disclosure or external effects | Proposed |
| Pool reuse A → B → absent context, commit/rollback | Actual restricted pool identity | No context carryover | No unauthorized records/events/effects | Proposed unless T3 evidence explicitly covers it |
| Cross-tenant relation, mixed batch, queued work after revocation | Relevant runtime identities, if those paths exist | Deny unauthorized access using documented batch/job rules | No B changes or unauthorized effects | Proposed; contracts needed |
| Ordinary caller attempts documented maintenance entry point | Ordinary role, isolated fake data | Access denied before privileged work | No mutation/events/effects | Proposed; no production privilege tests |

## Remaining boundaries and acceptance

First request cache handler/key/population code, reachable request contract and current authorization/revocation helper. Then run deterministic fictional cache tests and verify both response body and downstream consumers. Inspect context reset and indirect paths only within the supplied scope; do not discard the supplied RLS success evidence merely because pool details are absent. A separately authorized browser test should cover authorized access, cross-tenant denial with a warm cache, tenant switching/revocation, and reload behavior. No complete-system security certification is supported.
