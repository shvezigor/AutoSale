# Demo request contact lifecycle

The export/deletion API and UI were deployed on the current Docker host on 2026-10-20, but **platform-admin browser acceptance is still pending**. `DEMO_LEAD_ERASURE_ENABLED` defaults to `false` in both API and worker; when false, the delete action is hidden/refused and the scheduled purge does not run. Do not enable it or rely on the privacy-period claim in production until the gates below pass.

## Operator actions

- `/admin/leads` shows masked contacts; opening a detail records a platform audit before full contact is disclosed.
- A platform administrator enters their current password again to download one lead as a same-origin UTF-8 JSON attachment. The token is bound to the current session and `DEMO_LEAD_EXPORT` for five minutes. The list's CSV export uses the same purpose, a required inclusive UTC date range and the active status filter. It returns at most 1000 rows, escapes spreadsheet formula prefixes, and does not use object storage.
- Early deletion requires a separate `DEMO_LEAD_DELETE` step-up and exact lead UUID confirmation. An active notification lease returns a safe conflict; retry only after the worker finishes. The lead row and minimal platform audit commit in one transaction. The audit contains a UUID/reason, never contact or note.
- The application never prints an exported contact, password or step-up token to diagnostics. Download files are sensitive and should be handled under the operator's approved access policy.

## Retention policy and activation gate

The product default approved on 2026-10-20 is the earlier of 180 days after the last successful operator status change and 365 days after lead creation. Viewing a lead or notifying the internal mailbox does not extend the clock. This is a product rule pending legal review, not a statutory claim.

The scheduled purge is implemented as a bounded PostgreSQL `FOR UPDATE SKIP LOCKED` function. It selects at most 100 due leads, refuses active notification leases, deletes eligible rows and appends a contact-free `SYSTEM` platform audit atomically. The worker invokes it on startup and daily **only** when `DEMO_LEAD_ERASURE_ENABLED=true`. The function is worker-only; API access is revoked. PostgreSQL tests cover 180/365-day boundaries, status-action extension, active/expired leases, row-lock contention, idempotency and notification replay after deletion.

Keep the flag off until an additive migration, database backup, independent restore test, count-only dry run and notification-fencing test pass. An off-host erasure/deletion ledger or equivalent recovery evidence is also required: restoring a backup must replay all erasures **before** any restored application or notification worker can read the database. A platform audit row in the same database alone is insufficient for a backup taken before deletion. Do not claim complete erasure or enable the automatic sweep without this recovery gate.

## Recovery and verification

1. Stop API/worker access to the restored database.
2. Restore from a verified backup in isolation.
3. Apply the independently held post-backup erasure ledger and confirm deleted lead UUIDs are absent; preserve only minimal UUID/time/reason proof.
4. Reconcile pending notification IDs against surviving rows before resuming the worker. Deleted IDs must be skipped, not emailed.
5. Verify API/worker health, masked queue, protected detail, no-store download headers, wrong-purpose/expired token rejection, CSV formula safety and row absence after reload with fictional test data.

Until an independent erasure ledger exists and this sequence is rehearsed, keep production deletion and scheduled purge unavailable.
