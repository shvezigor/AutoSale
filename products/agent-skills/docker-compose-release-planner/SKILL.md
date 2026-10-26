---
name: docker-compose-release-planner
description: Prepare evidence-based release, migration and recovery plans for an existing Docker Compose application. Use when checking deployment readiness, reviewing backup and rollback gates, or writing an operator handoff for a Compose release. Produces a go/no-go release record; it does not provision infrastructure or run production commands automatically.
---

# Docker Compose Release Planner

Make a proposed release concrete enough for an operator to execute and verify. This is a planning and readiness skill for existing Compose deployments, not an automatic deployment tool. The plan may be blocked when a required backup, acceptance check or recovery path is missing.

## Establish scope and authority

Record the requested action, target environment, approved revision if any, operator and constraints. Distinguish draft infrastructure, provisioned infrastructure, parallel migration and live production. Treat old chat notes as historical evidence; obtain a current scoped snapshot from authorized read-only tools or supplied sanitized output.

Read the deployment, migration, backup/restore, observability and provider runbooks relevant to this release. Inspect only the pertinent Compose services, image/revision handling, database migrations, storage volumes, jobs and routing. Use the existing release scripts and secret mechanism when describing execution; do not invent provider-specific commands, paths or credentials.

The skill authorizes no live actions. Do not provision billable resources, change DNS, stop services, apply migrations, restore data, rotate secrets, alter network access or execute a deployment. If the user asks for execution, deliver the verified plan and hand it to the authorized operator or a separately authorized execution workflow. Keep approval requirements from the actual environment in the handoff.

## Assess readiness

Use [references/readiness-method.md](references/readiness-method.md) to check revision evidence, configuration, health, data safety and recoverability. Missing evidence is not a successful check. Record the source and time/environment for each observation; redact credentials, private hostnames and personal data from shareable output.

Classify each check as passed with evidence, failed, unknown or not applicable with reason. Use [assets/release-record.md](assets/release-record.md) for the plan. Set the decision to go only when all required preconditions are evidenced and there is no unresolved blocker. Go means ready for an authorized operator, not approval to execute or proof of a successful deployment.

For database/storage changes, require an application-consistent backup with a defined recovery point, a verified restore path, and independent storage appropriate to the deployment. A provider VM snapshot alone does not prove database consistency or restore readiness. Do not label a migration reversible because an older container image exists. State whether old and new application versions can safely use the post-migration schema.

## Specify the execution and verification boundaries

Describe preflight, exact immutable artifact/revision, backup verification, release through the existing procedure, migration order, health checks and operator decision points. Link authoritative commands rather than generating unverified commands that could affect live state. Identify the source of runtime configuration without printing its values. Pin the expected revision and record which components must match it.

Define the full affected flow: login/authorization when relevant, primary success path, validation and relevant failure states, persisted data after reload, background jobs/storage/provider callbacks and visible downstream result. Health endpoints alone cannot establish user-visible acceptance. Use fictional data or an authorized test account, and keep messaging, payments and other external side effects behind explicit authorization.

For each failure signal define an observable threshold, owner and stop condition. Avoid infinite retries. Preserve the authoritative old environment during parallel migration until the planned acceptance and recovery gates pass.

## Make recovery operational

Use [assets/recovery-decision.md](assets/recovery-decision.md) to distinguish application rollback from database recovery. Account for migrations, writes since cutover, external callbacks and queued jobs. A restore may lose writes and repeat side effects; identify the reconciliation strategy and required approval instead of promising zero loss. Prefer the existing tested recovery procedure, with forward repair where an old application cannot use the new schema.

End with go/no-go, blocking evidence, operator steps, verification requirements and recovery limits. A supplied plan, successful build or accepted image pull is not a deployment result. After actual execution by an operator, record their observed revision and acceptance results separately; label unverified steps explicitly.

See [references/worked-example.md](references/worked-example.md) for a fictional release that must remain blocked despite healthy containers.
