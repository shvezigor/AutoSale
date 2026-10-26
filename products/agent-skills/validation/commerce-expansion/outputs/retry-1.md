# Duplicate/retry audit: retry-1

Protected invariant: one intended shipment for tenant A business intent `oi-4`; retries may repeat transport attempts but must not silently create additional shipments or abandon unfinished work. This report uses fictional supplied evidence only. No replay, cancellation, provider lookup, network access or repair was performed. Provider identity, operation contract and idempotency retention/support remain unknown.

Evidence: R1 = event `ev-7`/intent `oi-4` reaches the shipping worker; R2 = worker calls provider without idempotency key, then writes `sent=true`; R3 = provider accepts first call but response is lost and worker times out before local save; R4 = queue retry creates second shipment and distinct provider IDs are supplied; R5 = owner proposes stable queue ID plus DB transaction.

## Timeline

Exact timestamps were not supplied; relative ordering is supplied rather than invented clock times.

| Relative time | Identity | Durable local state | External evidence | Gap |
|---|---|---|---|---|
| t0 | A / ev-7 / oi-4 | Work reaches worker; ingestion/claim details unknown | None yet | Upstream durability unknown |
| t1 | Attempt 1 / oi-4 | sent flag not yet saved | First shipment accepted, provider ID 1 supplied | Remote success precedes local result |
| t2 | Attempt 1 | Timeout before sent save | Accepted effect persists; response lost | Outcome uncertain to worker |
| t3 | Queue retry / same intent | Local completion guard absent | Second shipment created, distinct provider ID 2 supplied | Retry repeats non-idempotent effect |

## Key and transaction map

| Layer | Known identity | Required contract / unknown |
|---|---|---|
| Event | tenant A, ev-7 | Provider/account scope and receipt dedup not supplied |
| Business effect | oi-4 shipment intent | Stable tenant/provider-account/operation/intent identity across retry and manual replay |
| Queue | Retry exists, ID unspecified | Queue ID retention cannot define permanent business completion |
| Outbound | No idempotency key | Provider support, key scope, payload binding and retention unknown |
| Local result | sent=true after remote call | Durable pending/claimed/uncertain/confirmed result states needed in existing effect owner |

## Supported mechanism and counter-evidence

R3/R4 support a confirmed duplicate in this fictional supplied trace, with high confidence: remote success → response loss → no local completion → repeated create. The distinct supplied provider IDs and same intent establish stronger correlation than repeated queue logs alone. No independent provider verification was performed. No evidence identifies an ingestion duplicate, queue bug, or payment/order duplicate.

R5 does not close the failure window. A stable queue ID may reduce duplicate enqueue, but a retried worker still calls the provider; queue retention/removal also limits protection. A DB transaction can atomically record local state/outbox handoff but cannot roll back an accepted remote shipment. A local sent flag cannot prove remote failure when absent. Never retrying would also lose genuinely unfinished work.

## Narrow remedy and owner

The shipping effect owner should reuse the existing intent/result ledger and retry ownership rather than introduce another queue. First establish provider support for this exact shipment operation and its scope/retention contract using separately supplied authoritative documentation. If supported, persist and reuse one tenant/provider-account/operation/intent-scoped idempotency key with canonical payload comparison and recorded provider result across attempts, DLQ and replay. An event-only key may be wrong if legitimate later events change the business action.

If idempotency is absent or its window has expired, classify lost responses as uncertain. Block automatic repeat create until an authoritative lookup safely correlates the original effect, or an operator resolves the ambiguity. If lookup cannot distinguish outcomes, retain uncertainty; do not assume absence of a response means absence of a shipment. Use bounded attempts/duration, backoff and jitter, explicit retryable/terminal/uncertain states and one retry owner; provider-specific status classification is not supplied.

## Proposed acceptance and recovery

Tests use fictional intent fixtures and a fake provider; none ran.

| Failure point | Persisted result expected | Exact external-effect assertion | Terminal outcome |
|---|---|---|---|
| Normal shipment | Confirmed result with provider ID | 1 shipment | Confirmed |
| Provider commits, loses response; idempotency supported | Same stable key/result reconciled | 1 shipment across retries | Confirmed after retry/lookup |
| Same loss without idempotency/lookup | Durable uncertain state | 1 initial effect; 0 additional create calls before resolution | Uncertain, operator review |
| Provider rejects before create, then safe retry | Bounded state/attempt history | 0 before success, 1 after successful permitted retry | Confirmed or terminal per fake contract |
| Worker dies after result commit before ack | Existing confirmed result reused | 1 shipment total | Confirmed |
| Concurrent claims or expired lease | Only current owner may initiate effect; old worker cannot create anew | 1 with protected provider boundary, otherwise no additional uncertain create | Confirmed or explicit uncertain |
| Manual replay after queue removal | Business result/key retained for replay policy | 0 additional shipment for completed intent | Confirmed/deduplicated |

Operator recovery decision: preserve both supplied shipment IDs, correlation and state history; isolate this intent from automatic create retries. Obtain separately authorized authoritative status correlation, decide which existing shipment should fulfill the intent, and obtain explicit authorization before cancellation or another external action. Neither shipment was canceled or replayed here. Remaining unknowns are provider idempotency/lookup contracts, current shipment lifecycle and upstream receipt/claim durability; these preclude an exactly-once guarantee.
