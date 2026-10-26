# Tenant isolation review: tenant-1

Source-only review of the supplied invoice-update path. No database, browser, network, deployment, or schema change was used. PostgreSQL version, ORM/pooler, grants beyond ownership, and exact policy SQL were not supplied. Evidence labels below refer only to the fictional request.

- T1: An ordinary authenticated tenant A member supplies an invoice ID.
- T2: Handler executes `UPDATE invoices SET paid=true WHERE id=$1`, without an ownership check.
- T3: RLS is enabled and a tenant policy exists.
- T4: Runtime role `app_owner` owns the table; FORCE RLS is off; no other enforcement is described.
- T5: Existing tests use the owner role and contain only A records.

| Entry point | Trusted tenant source | Runtime role/context | Enforcement | Evidence/status |
|---|---|---|---|---|
| Invoice paid update | Authenticated A membership; transaction propagation unspecified | app_owner; context unspecified | ID-only SQL; no ownership check; owner normally bypasses non-forced RLS | T1–T4: reachable source-supported gap |

## Ranked findings

1. **High priority: ordinary callers reach an update without effective tenant enforcement.** Actor: ordinary A member. Entry point: supplied invoice ID in handler T2. Expected: A may change an authorized A invoice; supplying B's invoice ID cannot alter B. Actual described path: the query selects by ID alone, while table ownership and FORCE RLS off mean the described tenant policy does not constrain the runtime owner in ordinary PostgreSQL behavior. Given a B invoice ID, this path can mark B's invoice paid. Consequence: unauthorized cross-tenant invoice-state mutation, with possible downstream accounting behavior; downstream effects were not supplied and are not asserted. Confidence is high in the source-supported violation mechanism; no exploit or database observation was performed. RLS enabled and a tenant policy are counter-evidence to lack of any security intent, but do not defeat this role-specific bypass. An ID's unpredictability would not establish authorization.

   Smallest corrective owner: the invoice service/runtime database-access owner. Reuse its existing transaction and authorization helpers if present. Enforce ownership using trusted authorized tenant context at the update boundary and verify the affected-row contract. Select and verify a restricted runtime database identity with reviewed grants/policies; do not blindly add FORCE RLS as the entire repair. Review role membership, superuser/BYPASSRLS attributes, maintenance paths, and migration effects before choosing database changes. FORCE RLS does not constrain superusers or BYPASSRLS roles.

2. **Acceptance evidence gap:** T5 proves neither cross-tenant denial nor intended restricted-runtime enforcement. Owner-only same-tenant tests may pass while the violation remains. Keep same-tenant success tests, add adversarial fictional fixtures and test both intended restricted identity and owner behavior separately.

## Negative acceptance plan

All rows are proposed, not run. Use fictional A/B invoices, including unpaid B invoice `inv-b-fictional`, and no external providers.

| Fictional case | Runtime identity | Expected result | No-side-effect assertion | Status |
|---|---|---|---|---|
| A updates A | Actual request identity, then intended restricted identity after repair | Authorized update succeeds | Exactly intended A mutation only | Proposed |
| A supplies B ID | Same identities, owner tested explicitly | Denied/zero affected rows under corrected contract; avoid disclosing B existence | B remains unpaid; no domain event, job, or external call | Proposed |
| A reads B, if a read route exists | Actual read identity | No B fields disclosed | No writes/events/calls | Proposed, route evidence needed |
| Missing/empty/invalid context | Restricted runtime role | Fail closed | No invoice/event/job/effect | Proposed |
| Reuse pooled connection A → B → absent context, including rollback | Actual pool identity | No stale tenant authorization | No unrelated reads/mutations/events/effects | Proposed, pool contract needed |
| Mixed A/B batch or cross-tenant child-parent linkage, if supported | Actual route/job identity | Reject unauthorized elements according to documented atomicity | No B changes/events/effects | Proposed, path evidence needed |
| Job created before A membership revocation | Actual job identity | Honor documented reauthorization/revocation contract | No unauthorized update or effect | Proposed, job contract needed |

## Unverified boundaries and acceptance steps

Obtain redacted policy/grant/role definitions and the transaction-context and pool lifecycle source, plus existing invoice authorization/event code. Verify USING and WITH CHECK applicability, policy composition, trusted context establishment, and reset behavior; parameterization alone does not authorize a row. Review only relevant related jobs, cache/read paths and maintenance entry points when supplied. No evidence establishes their behavior here.

Acceptance requires the narrow repair, isolated A/B tests under the actual intended runtime identity, explicit owner behavior checks, and separately authorized complete browser acceptance of the affected invoice flow when an environment is available. This sample does not certify repository-wide isolation.
