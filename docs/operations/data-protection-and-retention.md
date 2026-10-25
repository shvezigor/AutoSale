# Data protection, retention and tenant lifecycle

## Scope and roles

Sales AITO stores account/security data and processes customer conversations, contact details, orders, catalogue, payment facts, delivery and integration state. For buyer/order/chat data, the merchant is normally the GDPR controller and Sales AITO the processor. Sales AITO is controller for its own account security, service administration and billing data. The exact allocation and lawful bases must be reflected in customer terms, privacy notices and an Article 28 data processing agreement (DPA).

GDPR does not require a separate database for each merchant. It requires appropriate technical and organizational measures, purpose limitation, minimization, storage limitation, security and demonstrable accountability. The selected shared-schema controls are recorded in [`ADR 0002`](../adr/0002-shared-schema-tenant-isolation.md).

This runbook is an engineering baseline, not legal advice. A qualified EU/privacy lawyer must validate the DPA, notices, lawful bases, national accounting obligations and the final retention schedule before EU production launch.

## Retention schedule

There is no universal GDPR retention period. Each category needs a purpose, lawful basis, owner and deletion rule. Until the product has a configurable policy engine, use the following launch baseline and do not silently retain data forever:

| Category | Operational baseline | Deletion/exception |
|---|---|---|
| Failed sign-in, OAuth/link attempts and short-lived tokens | Expiry plus no more than 30 days for abuse diagnosis | Delete earlier when no longer needed; never log raw secrets/tokens. |
| Raw provider webhook payloads | 30 days after successful normalization | Keep only a minimized failure specimen when an unresolved incident requires it. |
| Application/security audit events | 12 months | Extend only for a documented incident, legal hold or contract requirement. |
| Internal AI provider usage attempts | Proposed 90 complete days after terminal finalization; collection and terminal deletion independently OFF pending formal privacy/accounting approval | Worker deletes at most 100 terminal rows per pass; STARTED records are repaired before the retention clock begins. See the approval and recovery rules below. |
| Conversations, copied media, customer profiles and delivery/contact data | While the merchant account is active and needed for the configured business purpose | Controller-configured deletion must cascade to object storage and provider-derived copies; legal hold must be explicit. |
| Orders, payment facts and commercial records | Merchant-configured period meeting its accounting/consumer-law duties | Do not invent one global period; country/entity obligations differ. Prefer deletion or irreversible anonymization when the duty ends. |
| Provider credentials | While the integration is connected | Revoke and delete immediately on disconnect/tenant deletion; cleanup jobs must be observable. |
| Backups | Daily local copies up to 14 days; encrypted private off-host copies up to 30 days | A deleted tenant may remain only in inaccessible disaster-recovery backups until expiry; maintain a deletion ledger and do not restore without replaying deletions. |
| Closed tenant | 30-day retrieval/export window by contract | Then delete active data and objects; record only the minimal deletion proof and any legally required records. |

The values above are product defaults, not a substitute for merchant policy. Any changed period requires documentation of purpose, owner and legal basis.

## AI usage measurement approval and maintenance

The [internal AI usage ledger](../superpowers/specs/2026-10-24-ai-provider-usage-ledger-design.md) exists only to measure direct provider usage and reconcile private unit-cost reports with invoices. The operator owns the schedule and recovery; the privacy and accounting owners must approve its purpose/lawful basis, retention period, invoice-evidence needs and backup treatment before production activation. Record approvers, date, scope and policy reference in the controlled release record. Engineering implementation and owner approval of the feature do not constitute this formal approval. No such activation approval is recorded here.

The [private monthly report runbook](ai-usage-cost-report.md) defines versioned external operator inputs, explicit tenant/test scope, collection-completeness attestations, decimal tariff/invoice reconciliation, private ACL-checked output and safe disposal. Reports remain provisional until all coverage and invoice/project/allocation evidence is reviewed. Report artifacts contain tenant-confidential aggregates; keep them outside Git/logs and only for the authorized private review period. This implementation does not approve longer-lived tenant-linked summaries or activate either runtime switch.

Keep `AI_USAGE_COLLECTION_ENABLED=false` and independently `AI_USAGE_RETENTION_ENABLED=false` until that review and rollout acceptance are complete. Neither switch enables the other. Safe orphan repair is permitted while both are OFF: once on startup and every 60 seconds, the worker discovers at most 100 STARTED attempts strictly older than 15 minutes and conditionally finalizes each as CHARGE_UNKNOWN/ORPHANED under its tenant transaction. This records uncertain cost without calling a provider. A frozen tenant's already-dispatched attempt may finalize normally or through orphan repair; freeze prevents new calls, including queued manual recognition and the final manual/intent pre-dispatch check.

When deletion is separately approved and enabled, each pass deletes at most 100 terminal attempts whose `finalized_at` is strictly earlier than the pass time minus 90 days. A row exactly 90 days old remains until a later pass. STARTED rows are never deleted by retention, and an ancient STARTED attempt repaired now gets a fresh 90-day evidence period. Freeze does not prevent evidence finalization or change this independently approved terminal-retention rule. The SQL directory reveals tenant/attempt UUIDs only; discovery/deletion functions are worker-only and runtime roles retain no direct DELETE privilege. Maintenance telemetry contains only fixed operation/result values and bounded counts, without tenant IDs, operation UUIDs or provider/customer content.

If a pass fails, durable STARTED evidence remains available for the next pass and already terminal evidence is immutable. Inspect only the fixed `ai_usage_reconcile` result/count signals and worker health, resolve the infrastructure issue, and let the bounded scheduler retry; never resend the provider request to reconstruct usage. Restored records must pass the same reconciliation/cutoff rules. Deleted active rows can remain only in inaccessible backups until the existing 14-day local/30-day off-host expiry; a restore must replay the deletion ledger and reapply the approved retention sweep before normal access. This task supplies neither a new deletion ledger nor backup-expiry proof, so formal restore/rollout acceptance remains open. No longer-lived tenant-linked summaries are authorized by this schedule.

## Tenant export and deletion

The phased technical design is defined in [`Tenant data lifecycle`](../superpowers/specs/2026-10-02-tenant-data-lifecycle-design.md). Phase one now has the additive lifecycle state model and a fenced, recoverable export worker. It creates a deterministic JSONL ZIP, verifies the uploaded object's size and SHA-256 checksum, keeps it private, and exposes it only to a platform administrator through a purpose-bound reauthentication token and a same-origin API attachment. The internal object-storage endpoint and object key never reach the browser. The artifact expires after seven days; cleanup removes the object and download metadata while retaining checksum and ready-time evidence. BullMQ does not own retries: durable database state, leases and bounded backoff do. Ordinary logs and metric labels exclude tenant/request IDs, object keys and download responses.

Deletion requests still cannot physically delete tenant data. Provider ingestion, authenticated API business mutations and queued/scheduled provider side effects are now frozen. Platform admins can request count-only retention previews; they do not update or delete candidate records. The remaining steps below describe the complete launch target and require a later destructive-workflow acceptance gate.

The reproducible phase-one evidence is maintained in [`tenant-data-lifecycle-checklist.md`](../acceptance/tenant-data-lifecycle-checklist.md). Automated component/cross-service suites and the isolated two-tenant scenario are green, so phase one is **Available**. The scenario uses fresh fictional tenants and always cancels its temporary deletion request. Encrypted off-host backup readiness is tracked separately in [`offsite-backup-restore-checklist.md`](../acceptance/offsite-backup-restore-checklist.md).

Before general EU availability, implement one operator-owned workflow that:

1. freezes new ingestion for the tenant;
2. creates a machine-readable export of tenant records and an object manifest;
3. records export time, scope and checksum without copying secrets;
4. revokes provider credentials and queued external actions;
5. deletes tenant-owned PostgreSQL rows through audited cascades;
6. deletes tenant-owned object-store keys and verifies absence;
7. writes a deletion ledger entry containing tenant ID, request/legal basis, execution time, actor and backup-expiry date;
8. reapplies the deletion ledger after any disaster restore;
9. reports completion or unresolved provider/backup exceptions.

The workflow also supports controller assistance for access, correction, erasure, restriction and portability requests. Identity and authority must be verified before any export or deletion.

## EU/EEA hosting and international transfers

EU/EEA hosting is the default deployment choice because it reduces transfer complexity, but GDPR does not categorically require all data to remain in the EU. Every subprocessor and remote support/backup path must be inventoried. A transfer outside the EEA needs an adequacy decision or another valid safeguard such as SCCs, plus the required transfer assessment and supplementary measures where appropriate.

Record at minimum: provider, purpose, data categories, regions, transfer mechanism, retention, encryption/key control, incident contact and subprocessor-change process. Do not enable a provider in production before this record and the customer-facing subprocessor list are updated.

## Security operations

- Migration, API, worker and backup database identities are split. Runtime roles do not own tables, cannot perform DDL and cannot bypass RLS. The backup role can bypass RLS only to read a complete disaster-recovery dataset; it cannot write, execute application functions or assume runtime roles. Restore uses the owner credential only in an explicitly confirmed one-shot process with runtime services stopped.
- Forced fail-closed RLS now covers every current public table containing `tenant_id`, including order audit, inventory reservations, Sheets exports and conversational intent evaluations. Cross-tenant schedulers use role-specific bounded ID directories, then re-read and mutate durable state inside `withTenantTransaction`. Any future tenant-owned table must add its policy and PostgreSQL isolation test in the same migration. Operational lifecycle workflows remain incomplete even though the current database schema is covered.
- Use TLS in transit, encrypted disks/object storage/backups, restricted secret access and documented rotation.
- Add Redis authentication/ACL and prevent unrelated containers from reaching privileged queues.
- Use non-root object-store credentials and explicit bucket policy; tenant prefixes alone are not access control.
- Keep production logs free of message bodies, customer addresses, access tokens and credentials unless a narrowly scoped incident procedure explicitly requires evidence.
- During an active lifecycle freeze, verified Meta and Telegram callbacks are acknowledged without retaining new provider/customer payloads. Already queued Instagram normalization is re-checked under tenant context, marked technically complete, and skips messages, media copies and AI order recognition. The only freeze telemetry dimensions are the bounded mutation surface and `lifecycle_frozen`; tenant, request, chat and customer identifiers are forbidden.
- Authenticated writes re-check the freeze inside the same tenant transaction before changing orders, commercial terms, payments, procurement, catalogue, shipment/delivery state, supplier or personal test sends, team membership, order settings, legal entities/bank accounts, Google configuration, or provider connections. The API returns only `409 TENANT_LIFECYCLE_FROZEN`; list/detail reads and personal profile/security corrections remain available. Provider cleanup performed by the lifecycle workflow is a separate privileged path.
- Queued catalogue sync/mapping, Telegram supplier/notification delivery, Google Sheets export, and carrier create/cancel jobs re-check the freeze in their claim transaction before any new external mutation. Work that has not crossed a provider boundary is terminally recorded with `TENANT_LIFECYCLE_FROZEN` and is not retried. Carrier status reads and reconciliation of a document already confirmed by the provider remain allowed so local state can converge without issuing a second create or cancel call.
- `POST /api/admin/retention/dry-runs` creates an idempotent preview and queues only `runId` plus `tenantId`; `GET /api/admin/retention/dry-runs?tenantId=<uuid>` returns at most 50 bounded summaries. The worker records only category, policy status, cutoff, candidate count, oldest candidate timestamp and an optional approximate byte count. It never returns candidate IDs or content and performs no candidate update/delete SQL. Raw webhooks use 30 days, user notifications 90 days and tenant security audit 365 days. Conversations/customer data and orders/payments/delivery remain `POLICY_NOT_CONFIGURED` until merchant/legal requirements are configured.
- In `/admin`, open **Керувати даними** on the target tenant. Export needs one confirmation. Deletion preparation requires the exact tenant name and a fresh current-password step-up; this only freezes work and prepares the export, and the interface intentionally offers no physical-delete action. Download also requires a fresh password step-up and saves the private ZIP from the authenticated same-origin response without exposing an object-storage URL. Cancel/retry use the lifecycle request row, while retention preview appears as count-only categories.
- Queue `tenant-lifecycle` owns job names `tenant-lifecycle.export` and `tenant-lifecycle.retention-dry-run`. To recover a safe failed request, inspect only its bounded status/error code, correct the infrastructure problem, and use **Повторити**; durable state and a fresh fenced lease prevent BullMQ retries from becoming the source of truth. To unfreeze a tenant, use **Скасувати** on its active deletion preparation and verify its status is `CANCELLED` before resuming provider traffic.
- Retention dry-run summaries are reviewed in the same admin tenant card. They contain category, policy status, cutoff, candidate count, oldest timestamp and optional approximate bytes only—never candidate IDs or content.
- Maintain an incident process capable of helping controllers meet GDPR breach notification timelines.
- Treat dependency integrity as a release gate: audit both the production dependency graph and the complete committed lockfile, reject known high/critical vulnerabilities, and verify registry signatures. The 2026-09-30 baseline is clean for both graphs and all 756 installed packages have verified registry signatures.
- Run quarterly restore tests and cross-tenant isolation tests in CI.

## Launch checklist

- [ ] DPA, privacy notice, controller/processor roles and DSAR contact approved.
- [ ] Subprocessor register and transfer mechanisms approved.
- [x] Non-owner PostgreSQL identities are used by API and worker containers.
- [x] Fail-closed RLS rollout completed for every current public table containing `tenant_id`.
- [x] Restricted backup identity provisioned; restore remains an explicitly confirmed one-shot owner operation.
- [x] Current-quarter restore from a restricted-role dump exercised on an isolated host; keep the quarterly schedule active.
- [ ] Tenant export/deletion workflow and deletion ledger proven end to end.
- [x] Count-only retention dry-run reporting enabled with bounded summaries and metrics; configurable execution/deletion remains disabled.
- [ ] Backups encrypted off-host, access-restricted, expiry-enforced and restore-tested.
- [ ] Incident response and controller notification procedure tested.
- [ ] SaaS switching/export obligations under the EU Data Act reviewed by counsel.

## Source research

See [`EU data protection and retention research`](../research/2026-09-28-eu-data-protection-retention-research.md) for official sources, applicability notes and the P0–P2 roadmap.

