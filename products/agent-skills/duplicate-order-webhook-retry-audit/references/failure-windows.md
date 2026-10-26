# Failure-window worksheet

| Window | Duplicate or loss risk | Evidence/check |
|---|---|---|
| Two deliveries race | Both pass a pre-insert existence check | Atomic unique business/event key and conflict handling |
| Ingestion commits, enqueue fails | Accepted event never reaches worker | Existing outbox/reconciliation contract |
| Processed marker commits before effect | Retry skips unfinished work | Durable state machine and recovery state |
| Remote success, response lost | Retry repeats the external action | Provider idempotency scope/window or authoritative reconciliation |
| Effect commits, job ack fails | Queue redelivery repeats business write | Stable business key and transaction boundary |
| Lease expires while old worker runs | Two workers execute one effect | Ownership checks/fencing at the actual effect boundary |
| Job/key expires or is removed | Manual replay bypasses deduplication | Business retention and replay policy, not only queue identity |

Define the invariant per effect: one local order per business intent; one permitted message per approved send; no loss of valid updated orders. Multiple transport attempts are expected and do not by themselves prove a defect.

Provider contracts differ. Read current official guidance for the actual provider before choosing verification, ordering, retry or key-retention rules. Starting points: [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests), [AWS idempotent API design](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/). These references do not make this a Stripe-specific implementation or a running webhook server.
