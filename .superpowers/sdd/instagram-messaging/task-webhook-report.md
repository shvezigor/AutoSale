# Instagram Webhook Reliability Hardening Report

## Delivered

- Require a signed callback envelope with `object: "instagram"` and an `entry` array. Every entry must be an object with a non-empty Instagram account ID; malformed envelopes or entries return `400` before any tenant lookup or persistence.
- Split every callback entry into its own persisted payload (`{ object: "instagram", entry: [entry] }`). Each entry resolves its own active Instagram connection and tenant, so no event or normalized message can inherit `entry[0]` attribution.
- Skip a structurally valid entry whose account is unknown or inactive while continuing to accept other valid, known entries in the same callback.
- Preserve signature verification over untouched raw bytes and return promptly after durable database registration. Redis dispatch runs asynchronously and failures do not turn a durably accepted callback into a `500`.
- Re-dispatch duplicate Meta deliveries while their event remains `RECEIVED`; processed duplicates acknowledge without dispatch.
- Use the persisted `WebhookEvent` as the durable dispatch record. A worker-side reconciler polls `provider = META, status = RECEIVED` every five seconds and adds normalization work with the stable event UUID as BullMQ `jobId`.
- Configure failed normalization jobs for removal after attempts are exhausted. This permits the durable reconciler to recreate a failed job instead of leaving a retained failed BullMQ identity permanently blocking recovery.
- Redact `access_token` and `appsecret_proof` keys recursively before webhook payload persistence. Webhook payloads or message contents are not added to logs.
- Reject non-Instagram payloads again at the worker normalization boundary as defense in depth.

## Durability Ruling

The existing `WebhookEvent` is the outbox record; no second outbox table or schema migration is needed.

- `RECEIVED` means durable work remains eligible for dispatch.
- `PROCESSED` is written only after normalization finishes durably.
- API delivery and the reconciler both use `jobId = eventId`, so concurrent Meta retries, poller runs, and crash recovery converge on one live BullMQ job.
- Database message uniqueness remains the final idempotency boundary for at-least-once worker execution.
- If the API crashes after the database commit but before Redis accepts the job, the row remains `RECEIVED` and the reconciler recreates dispatch.
- If Redis is unavailable, the webhook still acknowledges after database durability; a Meta retry and the reconciler each safely retry the same queue identity.

## Validation Semantics

- Wrong/missing `object`, missing/non-array `entry`, or an entry without a non-empty `id`: reject the whole callback with `400` and create no records or jobs.
- Valid entry for an unrecognized/inactive account: skip only that entry.
- Valid entries for different accounts: resolve and persist independently under their own tenants.
- Unsupported Instagram entry contents (for example, no supported `message` event): persist safely and normalize to no messages under the existing unsupported-event behavior.

## TDD Evidence

RED was observed before implementation:

- API: 10 failures proved missing per-entry routing, malformed-envelope rejection, pending replay dispatch, non-blocking acknowledgement, and payload redaction.
- Worker: the non-Instagram normalizer case failed and the new reconciler module was absent.

GREEN focused verification:

```text
pnpm --filter @autosale/api test meta.controller.spec.ts meta-event.service.spec.ts
Test Files  2 passed (2)
Tests  17 passed (17)

pnpm --filter @autosale/worker test instagram-event-reconciler.spec.ts instagram-normalizer.spec.ts instagram.processor.spec.ts
Test Files  3 passed (3)
Tests  10 passed (10)
```

## Final Verification

```text
pnpm --filter @autosale/api test
Test Files  45 passed (45)
Tests  223 passed (223)

pnpm --filter @autosale/worker test
Test Files  18 passed (18)
Tests  61 passed (61)

pnpm --filter @autosale/api typecheck
PASS

pnpm --filter @autosale/worker typecheck
PASS

git diff --check
PASS
```

## Files

- `apps/api/src/meta/meta.controller.ts`
- `apps/api/src/meta/meta.controller.spec.ts`
- `apps/api/src/meta/meta-event.service.ts`
- `apps/api/src/meta/meta-event.service.spec.ts`
- `apps/worker/src/instagram/instagram-event-reconciler.ts`
- `apps/worker/src/instagram/instagram-event-reconciler.spec.ts`
- `apps/worker/src/instagram/instagram-normalizer.ts`
- `apps/worker/src/instagram/instagram-normalizer.spec.ts`
- `apps/worker/src/main.ts`

## Remaining Concerns

Raw webhook payload lifetime remains governed by the broader retention policy, which is outside this reliability change. This change ensures token-shaped Meta credentials are not retained in those payloads and does not introduce message content into logs.
