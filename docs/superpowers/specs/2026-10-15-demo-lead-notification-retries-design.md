# Durable demo-lead notification retries

Status: design approved in chat on 15 October 2026; implementation in `codex/demo-lead-notification-retry`, isolated and live acceptance pending.

## Problem and outcome

A public demo request is already durably stored in PostgreSQL, but the API currently attempts SMTP delivery inline. A failed attempt leaves `notificationStatus=FAILED` with no automatic recovery. The platform operator can miss a legitimate lead even though the visitor sees a successful submission. The outcome is that a saved request eventually reaches the configured internal mailbox when SMTP recovers, or becomes a bounded, visible failure without losing the request.

The actors are the visitor submitting a request and the platform operator receiving the notification. This is an internal email, not a message to the visitor or to a tenant customer.

## Options considered

1. Retry inside the HTTP request. Smallest code change, but the visitor waits for SMTP and a server restart loses the retry. Rejected.
2. Poll PostgreSQL without BullMQ. Durable, but duplicates existing queue infrastructure and makes delivery timing and queue monitoring less consistent. Rejected.
3. **Use BullMQ as the wake-up mechanism and PostgreSQL as the authoritative delivery state.** Reconcile due records into the queue after enqueue failure or restart. This reuses the worker and platform operations patterns and is the selected design.

## Scope and non-goals

Scope: queue new leads after the database commit; worker-owned SMTP delivery; bounded retries with backoff; recovery of due and abandoned attempts; count-only operations visibility and a guarded operator requeue procedure for terminal rows; safe migration of existing `PENDING` and retryable `FAILED` leads; automated and browser acceptance; deployment runbook.

Non-goals: a platform-admin lead-management page, customer-facing email, public rate limiting, changing the demo form, full lead retention/deletion, and claims of exactly-once physical email delivery. Those remain separate backlog work.

## State and ownership

- `DemoLead` in PostgreSQL remains the source of truth. Add `notificationNextAttemptAt`, `notificationLeaseId`, and `notificationLeaseExpiresAt` (nullable) alongside the existing `notificationStatus`, `notificationAttempts`, `notifiedAt`, and safe `lastNotificationError` code. Keep the existing public lead idempotency key and one lead per accepted request.
- The API persists the lead and best-effort enqueues a BullMQ job containing **only the lead ID**. It returns the existing accepted response even when Redis is temporarily unavailable; the worker reconciler later finds the due database row. No SMTP call remains in the public request.
- A worker atomically claims one due `PENDING` or retryable `FAILED` lead using a lease. A second worker/replayed job cannot send while a valid lease exists. `SENT` and exhausted records are no-ops. The worker reads the contact fields only after claiming.
- Count each claimed SMTP attempt, up to **four total attempts**. Retryable failures become due after 1, 5, and 15 minutes. After the fourth failure, leave `FAILED` with no next-attempt time. Missing SMTP configuration and explicit SMTP 5xx recipient rejection are terminal without consuming the remaining retry budget. Ambiguous network timeouts are retryable. Store bounded error codes, not exception text, contact details or credentials.
- A periodic bounded reconciler queues due rows and reclaims expired leases after a worker crash. It also covers rows left `PENDING` by a failed API enqueue and pre-existing `FAILED` rows below the attempt ceiling. Reconciliation never changes `SENT` back to pending.
- Successful SMTP acceptance conditionally marks the claimed row `SENT` and records `notifiedAt`. A stable Message-ID derived from the lead UUID makes an ambiguous duplicate recognizable to mail infrastructure and the operator; it is **not** an exactly-once guarantee. If SMTP accepted a message but the worker crashed before recording success, a later attempt may send another internal email bearing the same lead ID.

## Privacy, security and observability

- SMTP credentials are configured on the worker as secrets; the API keeps any SMTP configuration needed by existing authentication email, but no longer uses it for demo notifications. Do not put lead fields in BullMQ payloads, metrics, exception logs or queue dashboards.
- The existing platform operations area may show queue health and aggregate due/exhausted counts only. It must not expose lead contact information. A guarded operator maintenance procedure can requeue a specific terminal lead ID after correcting the cause, but cannot requeue `SENT`; its execution is recorded without contact data. A separate audited, access-controlled lead-management UI remains future work.
- Emit counts for attempts, success, retryable failure, terminal failure, and due backlog. Logs carry the lead ID as correlation ID and a safe error code only.
- The public endpoint and response do not reveal whether an address already exists, whether SMTP is configured, or whether delivery succeeded. Consent and current input validation are unchanged.

## Rollout and recovery

1. Add and apply a non-destructive migration; no existing lead is discarded. Existing `SENT` rows stay terminal. Existing `PENDING` and `FAILED` rows with fewer than four attempts become due; exhausted rows remain operator-visible. Document the guarded operator requeue procedure for a terminal row after SMTP configuration is corrected.
2. Deploy tested API first and worker second from the same master commit. The old worker ignores the new queue while the new API safely leaves unsent leads in PostgreSQL; the new worker reconciles them on startup. Do not start the new reconciler while an old API instance can still send inline, because that could duplicate a notification.
3. Verify public form success and persisted lead state in a real browser with fictional, authorized test data; verify the count-only downstream operations view where available. Use a controlled SMTP sink to prove success, transient recovery, terminal failure and replay without contacting a real customer. Production mailbox acceptance remains open until valid internal SMTP configuration is provided and an authorized internal test email is observed.
4. On failure, preserve leads and stop/revert application containers according to the deployment runbook. Do not roll back by deleting the additive columns or demo data. Recovery must not automatically resend a row already marked `SENT`.

## Acceptance criteria

- One valid public submission creates one durable lead and returns the existing success response without waiting for SMTP.
- Duplicate submission with the same idempotency key creates no second lead or logical notification.
- A temporary SMTP failure retries with the specified delays and ultimately records `SENT` after success; four failures stop automatically and remain visible as `FAILED`.
- A permanent rejection or missing configuration does not spin; queue outage, worker restart and duplicate job are recovered or ignored without losing the lead.
- No test fixture or log contains real contact data, SMTP credentials or email body. Queue jobs carry only a UUID.
- Automated contract, API, worker, migration, typecheck and build checks pass. Browser checks cover accepted submission and reload-safe form behavior; the authenticated operations view shows only aggregate downstream status. Controlled SMTP-sink checks cover retry and failure. Production email delivery is reported separately from local acceptance.
