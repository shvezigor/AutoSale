# Tenant data lifecycle acceptance

This checklist is the release evidence for phase one of tenant export, lifecycle freeze and retention preview. It uses only dedicated fictional tenants. It must never be pointed at a customer tenant.

## Automated evidence

- [x] Contract and state-machine tests reject destructive transitions; phase one has no physical-delete API, queue job or feature flag.
- [x] PostgreSQL tests prove fail-closed RLS, bounded platform/worker authority functions and role-specific grants.
- [x] Worker tests prove deterministic ZIP creation, SHA-256 verification, private seven-day artifacts, cleanup and durable retry recovery.
- [x] Dataset tests prove credential, password/session/token, OAuth-state, lease and platform-security categories are excluded.
- [x] API and worker tests prove a deletion request freezes provider ingestion, authenticated business mutations and not-yet-confirmed queued side effects while read-only/provider-confirmed reconciliation remains available.
- [x] Retention tests prove count-only summaries and no update/delete of candidate business rows.
- [x] Web tests cover export, deletion preparation, step-up, download, cancel/retry, retention preview, responsive layout, shared button variants and field validation.
- [x] `tests/e2e/tenant-data-lifecycle.spec.ts` is opt-in and fails unless two distinct tenant authorities are resolved; it verifies archive size/SHA-256, ZIP exclusions, tenant A freeze, tenant B continuity and cancellation cleanup.

## Isolated live acceptance

Set the following only in private process environment or CI secret storage:

```text
E2E_TENANT_LIFECYCLE_LIVE=1
E2E_BASE_URL=<isolated acceptance origin>
E2E_ADMIN_EMAIL=<fictional platform admin>
E2E_ADMIN_PASSWORD=<secret>
E2E_LIFECYCLE_OWNER_A_EMAIL=<fictional owner A>
E2E_LIFECYCLE_OWNER_A_PASSWORD=<secret>
E2E_LIFECYCLE_OWNER_B_EMAIL=<fictional owner B>
E2E_LIFECYCLE_OWNER_B_PASSWORD=<secret>
```

Run:

```powershell
pnpm exec playwright test tests/e2e/tenant-data-lifecycle.spec.ts
```

The scenario creates one export and one temporary `DELETE` preparation for fictional tenant A, confirms tenant B remains mutable, and cancels tenant A's request in `finally`. Keep the generated export private and allow its normal seven-day cleanup. Never store credentials, download responses, tenant IDs, archive contents or screenshots containing personal data in Git or CI artifacts.

## Current result

- [x] The opt-in scenario is discovered by Playwright and safely skips when its explicit fictional fixture is absent.
- [ ] Run the opt-in scenario against the isolated two-tenant fixture and record only the sanitized pass/fail result.
- [ ] Do not mark the capability **Available** until that isolated run is green.

## Deliberate phase-one limits

- Physical tenant deletion is unavailable.
- Provider credential revocation, object/database erasure, deletion-ledger creation and mandatory post-restore ledger replay are later destructive-phase gates.
- Retention is preview-only; merchant-specific conversation/order/payment/delivery periods remain unconfigured.
- The current restore procedure is unchanged because phase one never deletes tenant data. A destructive phase must add and prove ledger replay before runtime startup.
- Encrypted off-host backup enforcement and recurring production-like restore exercises remain EU launch gates.
