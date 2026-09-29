# ADR 0002: Shared-schema tenant isolation and database defense in depth

- **Status:** Accepted; relation guards and runtime role separation available, RLS rollout pending
- **Date:** 2026-09-28
- **Decision owner:** Sales AITO

## Context

Sales AITO is a multi-tenant SaaS. Customer conversations, orders, catalogues, payments, delivery records and integration state live in shared PostgreSQL tables with a required `tenant_id`. The authenticated session or verified provider binding determines the tenant; ordinary API input must never choose it.

A database per customer would increase provisioning, migration, backup and support cost without being required by GDPR. A shared schema is acceptable only when isolation is enforced consistently and independently tested. Application predicates alone are insufficient defense against a future service bug, unsafe SQL or compromised runtime credential.

## Decision

Keep one shared PostgreSQL schema for the current product stage and enforce these invariants:

1. Tenant identity comes from the authenticated principal or verified external-provider binding, never from an ordinary request body, query or header.
2. Every tenant-owned service query includes the tenant identifier.
3. Every relationship between tenant-owned records is database-enforced as belonging to the same tenant. Required references use composite `(tenant_id, id)` foreign keys. Nullable historical references that must retain `ON DELETE SET NULL` behavior use database tenant guards.
4. Object keys remain tenant-prefixed and object downloads require a tenant-scoped database lookup. A key prefix is organizational defense, not an authorization boundary.
5. Queue consumers re-read durable records and recover tenant authority from those records before provider or persistence actions.
6. Cross-tenant corruption tests run against real PostgreSQL migrations.
7. Runtime database identities will be separated before RLS is enabled:
   - owner/migrator role for schema migrations only;
   - non-owner, `NOBYPASSRLS` API role;
   - non-owner worker role with only the operations it needs;
   - restricted backup/restore operator.
8. RLS must fail closed when tenant context is absent. Platform administration must use explicit aggregate functions/views instead of silently bypassing tenant policy.

## Available controls

- Sessions bind a user, tenant and role and revalidate active user, tenant and membership state.
- Tenant-facing controllers pass the session-bound tenant to services.
- Provider webhooks derive tenant ownership from verified connection state.
- Composite tenant relations already protect delivery, inventory and several catalogue/payment paths.
- Migration `20260928224500_tenant_relation_guards` extends database protection to messages, orders, legal entities/accounts, commercial terms, Sheets exports and order audit logs.
- `tenant-relations.postgres.spec.ts` proves representative cross-tenant writes fail with PostgreSQL foreign-key violations.
- Deployments provision separate `autosale_api` and `autosale_worker` login roles after migrations. Both are non-owner, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` and `NOBYPASSRLS`; neither can create or alter schema objects.
- The owner connection remains available only to the one-shot migration and role-provisioning jobs. Application containers receive role-specific URLs and refuse to start when their distinct secrets are absent.

## RLS rollout gate

RLS is deliberately not enabled merely because runtime roles are now separated. The next gate is a fail-closed tenant transaction context for HTTP requests and background jobs, followed by explicit administration paths and PostgreSQL policy tests. Enabling policies before those paths exist would break legitimate work or encourage unsafe bypasses.

The rollout is complete only when role/grant migrations, request/worker tenant transaction context, platform-admin access paths, background reconciliation, backup/restore and integration tests are all proven together. Production data must be audited for tenant consistency before policies are forced.

## Performance strategy

Shared tables remain suitable while access paths start with `tenant_id` and use measured composite indexes. Cursor pagination is preferred for growing event/message histories; existing offset pagination for orders/catalogue must be replaced when measurements show deep-page degradation. Partitioning or tenant sharding is a later operational decision, triggered by measured table/index size, vacuum pressure, query latency or tenant-specific residency requirements—not by row count alone.

## Consequences

Benefits:

- migrations, backups and analytics remain operationally simple;
- database constraints contain cross-tenant damage from application defects;
- a later RLS layer can be added without changing the product data model;
- GDPR obligations can be fulfilled without database-per-customer infrastructure.

Trade-offs:

- a compromised API or worker credential still reaches all tenant rows until RLS is deployed, but it no longer grants schema ownership or DDL;
- full backups contain every tenant and require particularly strong encryption/access controls;
- tenant export and deletion need deliberate workflows across PostgreSQL, object storage, providers and backup expiry.

## References

- [`../operations/data-protection-and-retention.md`](../operations/data-protection-and-retention.md)
- [`../research/2026-09-28-eu-data-protection-retention-research.md`](../research/2026-09-28-eu-data-protection-retention-research.md)
- [`../superpowers/specs/2026-08-27-self-hosted-auth-design.md`](../superpowers/specs/2026-08-27-self-hosted-auth-design.md)

