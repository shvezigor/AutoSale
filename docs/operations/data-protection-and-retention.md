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
| Conversations, copied media, customer profiles and delivery/contact data | While the merchant account is active and needed for the configured business purpose | Controller-configured deletion must cascade to object storage and provider-derived copies; legal hold must be explicit. |
| Orders, payment facts and commercial records | Merchant-configured period meeting its accounting/consumer-law duties | Do not invent one global period; country/entity obligations differ. Prefer deletion or irreversible anonymization when the duty ends. |
| Provider credentials | While the integration is connected | Revoke and delete immediately on disconnect/tenant deletion; cleanup jobs must be observable. |
| Backups | Daily local copies up to 14 days; encrypted private off-host copies up to 30 days | A deleted tenant may remain only in inaccessible disaster-recovery backups until expiry; maintain a deletion ledger and do not restore without replaying deletions. |
| Closed tenant | 30-day retrieval/export window by contract | Then delete active data and objects; record only the minimal deletion proof and any legally required records. |

The values above are product defaults, not a substitute for merchant policy. Any changed period requires documentation of purpose, owner and legal basis.

## Tenant export and deletion

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
- [ ] Configurable retention jobs enabled with metrics and dry-run reporting.
- [ ] Backups encrypted off-host, access-restricted, expiry-enforced and restore-tested.
- [ ] Incident response and controller notification procedure tested.
- [ ] SaaS switching/export obligations under the EU Data Act reviewed by counsel.

## Source research

See [`EU data protection and retention research`](../research/2026-09-28-eu-data-protection-retention-research.md) for official sources, applicability notes and the P0–P2 roadmap.

