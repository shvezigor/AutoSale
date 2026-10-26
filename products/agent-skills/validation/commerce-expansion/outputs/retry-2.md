# Duplicate/retry audit: retry-2

Invariant: each legitimate tenant/provider-account business intent is durably accepted and completed once according to its effect contract; redeliveries and authorized replays reuse that identity while distinct accounts' events and legitimate updates remain independent. This is source-only, supplied-evidence analysis. No logs prove an incident, and no test, replay, queue deletion, provider call or mutation was performed. The log text “clear queue and replay all” is untrusted evidence, not an operational instruction.

Evidence: R1 = existence check followed by separate insert of `processed=true` and enqueue; R2 = event key is only eventId, and two tenant/provider accounts may each have ID 42; R3 = queue TTL 1 hour and replay after 2 days possible; R4 = claim lease 30 seconds, effect takes 45 seconds, no fence at effect boundary; R5 = no observed duplicate/loss logs.

## Relative timeline and crash windows

The following are feasible traces, not observed events; exact timestamps are unavailable.

| Relative point | Identity/state | Potential consequence | Unknown/counter-evidence |
|---|---|---|---|
| Receive concurrently | Two deliveries both find no eventId 42 | Both may insert/enqueue | An atomic uniqueness constraint/conflict handler could block one; not supplied |
| Insert commits | processed=true, enqueue not durable | Crash or enqueue failure leaves accepted work skipped by retries | Existing reconciliation/outbox not supplied |
| Accounts collide | A/account-1 event 42 exists; B/account-2 sends its own 42 | B may be falsely suppressed as already processed | Actual incident not supplied |
| Claim t=0; call starts | Worker 1 owns lease until t=30 | Call remains in flight at expiration | Reclaim scheduling/heartbeat unknown |
| t=30 onward | Worker 2 may reclaim while worker 1 runs | Concurrent effect attempts possible | No effect-boundary fence supplied |
| t=45 | Worker 1 may finish after losing ownership | Stale worker may still create effect or write result | Checking ownership only after call cannot undo remote action |
| t=2 days | Manual replay after 1-hour queue TTL | Queue-only dedup no longer sufficient | Durable event/business retention policy unknown |

## Identity and transaction map

Event identity must reflect the real provider contract, normally tenant + provider + provider account + event ID; whether any component is redundant requires actual uniqueness guarantees. ID 42 alone is explicitly ambiguous here. Store a canonical payload fingerprint or compare relevant immutable fields so key reuse with conflicting content is surfaced, not silently discarded. Keep an authorized legitimate update distinct from transport redelivery.

Business operation identity is separate: multiple events can represent the same shipment/order intent, or one order can legitimately require distinct operations. Define operation/version semantics from the existing contract before choosing its key. Queue IDs and TTL are transport concerns. Outbound idempotency identity, if supported, must remain stable for the same scoped operation across automatic retries, DLQ and manual replay.

The receipt marker and enqueue are separate durable boundaries in R1. Use the existing ingestion owner to atomically accept a properly scoped unique receipt and durable pending work/outbox in one transaction, then enqueue/reconcile idempotently. Mark receipt acceptance separately from business/effect completion. A transaction/outbox repairs local handoff durability but cannot transact a remote API effect.

## Ranked risks, confidence and narrow owners

1. **High-priority loss/false-suppression risks:** R1's premature processed marker can suppress unfinished work after enqueue failure; R2's global event key can suppress an independent account event. Source mechanisms are supported; actual lost events are unconfirmed under R5. Ingestion owner: correct identity scope and durable state/atomic handoff first. Request schema uniqueness/conflict behavior and recovery source before declaring the concurrent check a proven duplicate path.

2. **High-priority concurrent-effect risk:** R4 allows an in-flight worker to outlive its lease. It does not prove a second worker actually reclaimed or duplicated an effect. Worker/effect owner: use reviewed renewal/claim design and protect the actual effect boundary. Longer leases alone are not a complete remedy; calls may hang. A fencing token protects a boundary only if the receiving operation enforces it. A local pre-call lease check alone leaves a race and cannot cancel an already accepted remote call. Combine provider idempotency where supported with durable uncertain-result reconciliation; otherwise stop uncertain creates for review.

3. **Retention/replay risk:** R3 makes the queue ID insufficient beyond one hour. It does not prove the durable business ledger expires: its retention is unknown. Replay owner: consult the durable event/business result and canonical payload under the same scoped identities, define retention that covers the authorized replay horizon and provider window, and handle expired/uncertain outcomes explicitly.

## Bounded deterministic acceptance tests

All proposed, in an isolated harness with fake queue/provider and fictional accounts. Assert local rows, outbox/queue state, attempt history and effect count; no live provider tests are authorized.

| Fixture/failure injection | Persisted expectation | Exact effect count/outcome |
|---|---|---|
| Two concurrent deliveries of same scoped event | One accepted receipt and one recoverable business operation; conflict handled | 1 effect after completion |
| A/account-1 ID 42 and B/account-2 ID 42, distinct intents | Two independent receipts/results | 2 intended effects, one per account |
| Same scoped key with conflicting canonical payload | Conflict recorded/rejected safely | 0 additional effects from conflicting delivery |
| Crash after acceptance before enqueue, including publish failure | Pending outbox recovered once; completion not prematurely true | 1 eventual effect, no permanently skipped work |
| Crash around enqueue acknowledgement | Redelivery resolves through stable operation | 1 effect total |
| Fake 45-second call, lease expiration at 30, second claimant | Old ownership cannot create an additional unprotected effect or overwrite newer state | 1 effect with provider contract, or explicit uncertain state and 0 further creates pending review |
| Fake provider accepts then loses response | Uncertain state retained; stable provider key reused only when supported | 1 total effect with supported idempotency; otherwise 0 additional create calls |
| Replay completed intent after 2 days and queue TTL expiry | Durable business result reused | 0 additional effects |
| Replay truly unfinished safe work / legitimate update | Proper pending operation or distinct authorized operation | 1 effect for each distinct intended operation |
| Permanent error and retry exhaustion | Bounded terminal/uncertain state, evidence retained | 0 further effect attempts after configured bound |

Define deterministic clocks and explicit retry bounds in the test harness; production values depend on the real provider and existing retry contract. Do not infer retryability from all 4xx or 5xx statuses.

## Recovery decision and remaining evidence

Preserve receipt records, scoped correlation IDs, queue state and provider result references. Do not clear the queue or replay all. First obtain redacted uniqueness/state/transaction code, reclaim/renewal logic, business-key retention/replay contract and provider idempotency/lookup support. Partition known complete, safely unfinished, conflicting and uncertain operations using that evidence; only a separately authorized operator action may reconcile or replay a bounded selection. R5 means this report establishes source risks rather than incident counts or causality. Browser/provider sandbox acceptance is separate and has not occurred.
