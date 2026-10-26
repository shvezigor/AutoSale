# Fictional example: healthy containers, blocked release

Input: a live Compose application has web, API, worker, PostgreSQL and object storage. An operator proposes release R2 from R1. A VM snapshot exists; no application-consistent backup or restore test is supplied. R2 drops a database column used by R1. Current containers return healthy. Request: assess readiness only; no live commands, messages or migration actions.

Decision: no-go. Healthy current containers show current liveness, not release readiness. The destructive schema change makes R1 image rollback unsafe unless compatibility is demonstrated. No consistent database/object recovery point or tested restore path is evidenced. Immutable artifact identities and affected browser acceptance are also unknown.

Preflight next steps for the operator: inspect the migration and compatibility strategy, obtain a consistent backup including referenced objects and independent storage, verify restore in isolation, identify immutable R2 artifacts and define the affected acceptance flow. An expand/contract migration or forward repair may be preferable, but feasibility is not yet established.

Proposed acceptance after an authorized release: fictional test-account login, save a record, check field validation, reload and confirm persistence, then verify its worker-produced downstream result using a controlled provider fixture. Do not send real messages or create provider transactions to test a health endpoint.

Recovery must account for writes and queued jobs since the selected recovery point. Do not promise zero loss or suggest a blind schema downgrade. Operator authorization, backup evidence and compatibility remain explicit gates. No production operation is performed and the release is not described as deployed.
