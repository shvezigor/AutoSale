# Release readiness: R1 → R2

**Decision: NO-GO.** Current service health does not establish R2 readiness. This is a readiness plan only; no production actions have been performed or authorized by this record.

Target: supplied fictional live Compose environment, comprising web, API, worker, PostgreSQL and object storage. Operator identity and release window are not supplied. Evidence source: supplied scenario only; observation timestamps, exact source revision, running artifacts and runbook paths are unknown. No live inspection was performed.

| Required check | Status | Supplied evidence / time | Gap and proposed owner |
|---|---|---|---|
| Current liveness | Passed, limited | All five services healthy; time unknown | Operator must obtain current scoped snapshot before a release decision |
| Schema compatibility | Failed | R2 drops a column R1 reads | Release engineer: change migration strategy or demonstrate a safe supported recovery strategy; R1 cannot safely use the stated post-migration schema |
| Consistent data backup | Unknown | VM snapshot only; time unknown | Data operator: coordinate DB and referenced objects, define recovery point, cover other authoritative volumes and required keys |
| Demonstrated recovery | Unknown | No successful restore evidence | Data operator: isolated restore proof for applicable versions/formats, independently stored copy, measured recovery evidence |
| Immutable artifact identity | Failed | Mutable latest images | Release engineer: pin each release component to trusted digests and corresponding source/build provenance; record known prior artifacts |
| Build, tests, migration rehearsal, runtime configuration | Unknown | Not supplied | Release engineer: provide preflight results, migration state and tested release/recovery procedures; identify secret mechanism without exposing values |
| Browser and downstream acceptance | Unknown | No evidence supplied | QA/operator: define affected flows, accounts, outcomes and safe provider fixtures, then obtain actual results |
| Routing, queues, workers and provider dependencies | Unknown | Service health only | Operator: capture relevant backlog, job state, routing and dependency readiness |

## Operator sequence once blockers are resolved

1. Identify the approved R2 source revision, exact immutable artifacts, affected services, operator, release window and existing deployment/migration/recovery runbooks. Capture a timestamped, sanitized snapshot of running revisions, health, queues, migration state and routing. Do not retrieve secrets or production records for the plan.
2. Inspect the actual migration and all readers/writers, including workers. Prefer evaluating an expand/contract sequence that retains the column until R1 dependencies are removed. Feasibility is unproven. If retaining the destructive change, document forward repair and data recovery; an older image alone is no rollback plan.
3. Establish an application-consistent recovery point across PostgreSQL and referenced objects, independent/off-host storage and usable keys. Restore in isolation using the existing procedure and verify data/object relationships and application behavior. Record evidence, timestamps and any supplied RPO/RTO; neither is currently known.
4. Complete build/tests and migration rehearsal against representative fictional data. Verify runtime configuration sources, immutable provenance and tested release scripts. Finalize acceptance and recovery decision thresholds before the go/no-go review.
5. Only after a new go decision and separate execution authority, an operator follows the cited existing runbook for backup verification, migration/service order, release and verification. Exact commands and order cannot be specified from the supplied evidence; do not improvise them.

## Acceptance required

Map these checks to the actual changed capability before release: authorized test-account login/permissions if relevant; primary create/update path; localized validation and relevant failure states; saved values after reload; all affected downstream screens; worker completion, object retrieval and provider callback effects. Use fictional fixtures or an explicitly authorized test account. Controlled provider fixtures are preferred; real messages, transactions and other external side effects require explicit authorization. Health checks and automated tests supplement these checks and cannot replace them. Capture final browser evidence, including screenshots where visuals matter. All acceptance results remain unverified.

## Stop and recovery decisions

The operator owns the go/no-go decision; assign a named incident/recovery owner before release. Any failed required precondition or unknown required evidence stops release. Propose zero unexpected migration failures, all required service health checks passing and every required acceptance check passing as operator decisions, not observed production thresholds. Use existing service objectives for latency, errors and queue lag; none were supplied, so those numeric thresholds must be agreed before cutover. Do not retry indefinitely.

No R2 failure is currently observed. If an authorized release later fails, record actual revision, failure signal, write/job/callback history and containment authority. R1 reads a dropped column, so blind application rollback or schema downgrade is unsafe. Evaluate tested forward repair; database/object restore requires an authorized recovery decision and coordinated recovery point. Restoration may lose writes since that point and may repeat jobs or provider effects. Inventory and reconcile saved writes, object references, queued/in-flight jobs and callback identifiers before resuming. RPO, RTO and acceptable loss remain unknown; zero loss is not promised. Recovery requires fresh health, browser, persistence and downstream proof.

Required next evidence: compatible migration/recovery design, consistent independently stored backup plus isolated restore proof, immutable artifacts/provenance, current scoped snapshot and acceptance/preflight evidence. Readiness, execution and acceptance are separate records. R2 has not been deployed by this assessment.
