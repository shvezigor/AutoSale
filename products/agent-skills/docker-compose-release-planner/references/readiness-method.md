# Readiness method

Collect a minimal sanitized snapshot: environment phase, source revision, requested immutable image references, running revisions, relevant service health, queue/worker state, migration state, backup recovery point and restore evidence, routing/provider dependencies and affected acceptance flow. Supply timestamps. Do not retrieve secret files or dump production records for a readiness check.

Artifact identity matters: a mutable image tag can change between review and execution. A revision label alone does not prove image contents; use the repository's trusted build provenance and digest process where available. If absent, mark artifact verification as a gap instead of inventing a digest.

Check backups against the affected data: database, object storage and any other authoritative volume. Coordinate recovery points when records reference objects. Record the stated recovery-time and recovery-point objectives if supplied; do not invent achievable values. Verify restore evidence applies to the current format/version and required encryption keys are available to the operator without exposing them.

Schema compatibility is separate from backup availability. For a destructive migration, inspect the actual migration and dependency sequence. Determine whether the old image can run after it and whether new writes need reconciliation. Missing compatibility evidence blocks an automatic application rollback recommendation.

Define acceptance before release, including user-visible success, relevant errors, persistence and downstream effects. State authorized fixture/account and side-effect limits. Provider outage, unavailable test credentials or pending approval can block a live check; report the exact missing step rather than claiming full acceptance from local tests.

Use proportionate thresholds from existing service objectives. If none are supplied, propose thresholds as decisions for the operator, not observed facts. A failed required check means stop; unknown required evidence means no-go pending evidence. Record not-applicable checks with their reason.
