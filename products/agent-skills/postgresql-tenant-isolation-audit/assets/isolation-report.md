# Tenant isolation review

Scope, PostgreSQL version, actors, tenant model, evidence and omitted paths:

| Entry point | Trusted tenant source | Runtime role/context | Enforcement | Evidence/status |
|---|---|---|---|---|

## Findings

For each: actor and reachable operation; evidence; intended/actual access; counter-evidence; consequence; severity/confidence; narrow remedy.

## Negative acceptance plan

| Fictional case | Runtime identity | Expected allowed/denied result | No-side-effect assertion | Observed/proposed |
|---|---|---|---|---|

## Unverified boundaries and next step

Include privileged-role and pooled-connection limitations; avoid certification claims.
