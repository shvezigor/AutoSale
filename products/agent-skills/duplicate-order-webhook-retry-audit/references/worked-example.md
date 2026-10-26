# Fictional supplied-evidence example

D1: provider event ev-7 belongs to tenant A and requests order intent oi-4. D2: worker calls shipping provider, then saves sent=true. The remote call has no idempotency key. D3: first request was accepted by the provider, response was lost, worker timed out before saving. D4: retry created a second shipment; two distinct provider shipment IDs are supplied. No production access or replay authorized.

## Example conclusion

The supplied provider IDs and timeline support duplicate external shipment after an uncertain first result. A local sent flag written after the call cannot bridge the remote success/local persistence gap. Reusing the queue job ID or wrapping only database work in a transaction does not fix that gap.

First verify whether this provider's shipment operation supports idempotency with an appropriate scope/window. If it does, use one stable tenant/provider/intent-scoped key across attempts and record responses safely. Otherwise, an uncertain result requires authoritative lookup or operator review before another create call. Preserve evidence; do not delete either shipment or replay automatically.

Proposed tests use a fake provider that commits a shipment then loses the response, concurrent worker claims and an expired lease. Assert one intended effect or an explicit uncertain state awaiting reconciliation, not a fabricated global exactly-once guarantee. No tests or external repairs are claimed as executed in this example.
