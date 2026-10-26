---
name: postgresql-tenant-isolation-audit
description: Audit a PostgreSQL SaaS tenant boundary across authorization, SQL, RLS roles, connection context, caches and jobs. Use for evidence-linked cross-workspace access reviews and negative test plans. Defaults to source analysis and does not certify security or query production tenants.
---

# PostgreSQL Tenant Isolation Audit

Trace who may access which tenant's data through the actual application and database identities. A tenant_id column, ORM filter or enabled RLS flag alone does not prove isolation. Scope the review to named paths and report unresolved boundaries explicitly.

## Establish the authorization model

Identify the authenticated principal, active tenant, membership/role policy, data ownership and allowed cross-tenant administrative paths. Read repository guidance and existing service/transaction helpers before proposing another access layer. Record PostgreSQL version, ORM/pooler and actual runtime roles when supplied. Ask for redacted schema/policies/source or a fictional fixture; no owner credentials or customer dump is required.

Use [references/boundary-method.md](references/boundary-method.md) for role and lifecycle checks. Review each selected HTTP/API route, repository/raw SQL operation, relation lookup, batch/export, job and cache key. Trace tenant context from a trusted authenticated decision to the final read/write. A tenant ID accepted from a request must be authorized, not merely well-formed.

## Inspect database enforcement

Identify grants, role memberships, table ownership, superuser/BYPASSRLS attributes, RLS enable/force flags and applicable policies. Distinguish row visibility through USING from allowed new row values through WITH CHECK. Evaluate actual policy composition, role applicability and default behavior. A public permissive policy can widen an otherwise narrow policy. RLS is not a substitute for the application's authorization model or all database privileges.

Check how a pooled connection obtains, changes and clears tenant context. Transaction-local settings work only within the intended transaction and connection. Session-level settings can outlive a request; SET LOCAL does not sanitize a pre-existing session value after commit. Missing/empty/invalid context should deny safely under the actual policy; never assume the policy does so from its name.

Audit SECURITY DEFINER functions, owner-backed views/functions, search_path, raw queries, service/maintenance roles and background jobs as distinct boundaries. An intentionally privileged maintenance flow is not automatically a vulnerability: require a concrete path available to an unauthorized caller, or classify the concern as an unverified risk. Conversely, a test using an owner or BYPASSRLS role cannot establish normal-runtime RLS behavior.

## Check lifecycle and indirect leaks

Inspect tenant qualification in uniqueness keys, joins, child-parent ownership, caches, object storage references, search indexes, queues and exports. Row IDs must not be treated as authorization. Role revocation, membership changes and tenant switching should affect pending work according to the documented contract. Global aggregates and support access need explicit scope rather than an invented universal prohibition.

For each finding attach file/symbol or evidence ID, actor, entry point, missing enforcement, expected versus actual access, consequence, confidence and smallest remedy. A missing ORM predicate is not a confirmed leak if a verified database policy blocks it; preserve this counter-evidence.

## Produce a testable report

Use [assets/isolation-report.md](assets/isolation-report.md) and the [fictional example](references/worked-example.md). Separate confirmed reachable violations, defense-in-depth gaps and unknown runtime facts. Do not issue a numerical security score or a clean bill of health from a source sample.

Propose fictional tenant A/B fixtures and tests under the actual runtime role: same-tenant success, cross-tenant read/write/relationship denial, missing context, mixed-tenant batches, connection reuse, jobs and revoked membership. Assert absence of database mutations, events and external side effects on denial. Mark tests proposed until actually run. Default audit scope excludes schema/role changes, production queries, exploitation, provider calls and deployment; execute only separately authorized checks in an isolated environment. Finish with ranked findings and precise remaining acceptance steps.
