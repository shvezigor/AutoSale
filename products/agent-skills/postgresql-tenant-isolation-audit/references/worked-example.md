# Fictional source-only example

S1: invoices(id, tenant_id, amount). S2: API authenticates tenant A and passes supplied invoice ID to UPDATE invoices SET paid=true WHERE id=$1. No service ownership check is described. S3: RLS is enabled with a tenant predicate, but the API connects as app_owner, which owns the table; FORCE RLS is off. Source caller permits an ordinary member to supply an invoice ID. Tests use the same owner and contain only A records. No database was accessed.

## Example finding

High-priority source-supported isolation gap: ordinary request access reaches an unscoped update through a table-owner role that normally bypasses RLS. The described policy does not establish protection for this runtime identity. This is a reachable source path under the supplied facts; actual exploitation has not been performed.

Remedy: choose and verify the intended restricted runtime role and enforcement boundary; preserve the existing transaction helper, add trusted tenant ownership enforcement and appropriately reviewed RLS/grants. Do not merely append FORCE RLS without reviewing role privileges, maintenance paths and migration effects.

Proposed acceptance: A updates A successfully; A updating B changes zero rows and emits no event; missing context denies; reuse a pooled connection across A/B; test the intended restricted role and separately verify owner behavior. Current owner-only A fixtures do not prove isolation. No schema changes, production queries or live tests occurred.
