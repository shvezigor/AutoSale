# Release readiness: [application / revision]

- Target environment and phase:
- Requested action, authorization scope and operator:
- Snapshot time, source evidence and limitations:
- Source revision, immutable artifacts and provenance:
- Affected services, state, migration and external dependencies:
- Existing execution runbook/scripts:

| Required check | Passed / failed / unknown / N/A | Evidence and time | Blocking gap / owner |
|---|---|---|---|

## Operator sequence

Preflight; verified backup/recovery point; exact release/migration sequence from the runbook; verification; stop decisions. This document does not execute these steps.

## Acceptance

Authorized test data/account; primary path; validation/errors; reload persistence; downstream screens, jobs and provider behavior. Identify external side effects requiring separate authorization.

## Recovery

Failure signal/threshold; decision owner; compatible application rollback or forward repair; database/object recovery and reconciliation; expected write-loss limits and unverified assumptions.

## Decision

Go/no-go and rationale. Required missing evidence, owner and next check. Distinguish readiness from actual deployment and actual acceptance.
