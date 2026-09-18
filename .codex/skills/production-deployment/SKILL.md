---
name: production-deployment
description: Prepare, provision, migrate, deploy, verify, scale, or recover the Sales AITO production environment, especially the Hetzner Cloud Docker Compose deployment. Use for production hosting, server setup, cutover, release, rollback, backups, or infrastructure scaling; not for ordinary local development.
---

# Sales AITO production deployment

Use the repository runbooks as the source of truth instead of reconstructing production from chat history.

## Route the task

1. Read [`docs/operations/hetzner-production.md`](../../../docs/operations/hetzner-production.md) for Hetzner provisioning, first deployment, cutover, scaling, and recovery.
2. Read [`docs/operations/deployment.md`](../../../docs/operations/deployment.md) before releasing application code.
3. Read [`infra/AUTO_DEPLOY.md`](../../../infra/AUTO_DEPLOY.md) before enabling or using GitHub Actions deployment.
4. Read [`docs/operations/backup-restore.md`](../../../docs/operations/backup-restore.md) before migration, restore, destructive maintenance, or disk/server replacement.
5. Read [`docs/operations/observability.md`](../../../docs/operations/observability.md) when verifying health or investigating a failed rollout.
6. Read [`docs/adr/0001-hetzner-single-host-production.md`](../../../docs/adr/0001-hetzner-single-host-production.md) before changing the selected provider or topology.

## Establish the current state

Before any mutation, determine and report which phase applies:

- **Draft only:** a Hetzner order form may be configured, but no paid server exists.
- **Provisioned:** the host exists, but Sales AITO is not serving production traffic.
- **Parallel migration:** old production remains authoritative while the new host is tested.
- **Live:** the host receives `sales-aito.com` traffic and provider callbacks.

Inspect the current Git commit, dirty state, container health, backup freshness, public health endpoint, and whether GitHub auto-deploy is enabled. Do not infer any of these from an earlier conversation.

## Safety gates

- Do not click Hetzner `Create & Buy now`, provision billable storage/IPs, enable paid backups, or otherwise start billing without the user's explicit authorization at that action.
- Do not enable `AUTO_DEPLOY_ENABLED`, change production DNS/Cloudflare routes, stop the old production stack, restore over a database, rotate secrets, or perform cutover unless the user explicitly authorized that live change.
- Never copy secrets into Git, chat, command output, Docker images, CI artifacts, or documentation. Use `.env` on the host and GitHub Environment secrets where prescribed.
- Never treat Hetzner server backups as the only database backup. Require a fresh application-consistent PostgreSQL/MinIO backup and an off-host copy before cutover or destructive work.
- Preserve the old environment until the new host passes health, data, login, callback, and rollback checks.

## Execution contract

For a real deployment:

1. Record the approved commit SHA and target environment.
2. Complete the relevant preflight checklist from the Hetzner runbook.
3. Take and verify the required backup before changing live state.
4. Deploy only the tested `master` commit or an immutable release tag through the existing scripts.
5. Verify containers, migrations, public health, login, background worker, storage, and provider callbacks without generating uncontrolled external side effects.
6. If verification fails, stop rollout and follow the documented rollback path; do not improvise database downgrades.
7. Record the deployed SHA, time, verification result, backup ID, and any remaining acceptance gap without storing personal production data.

For documentation-only changes, push the verified commit to `master`; do not rebuild or restart production containers merely to distribute Markdown files. If auto-deploy is enabled, observe the workflow result and verify that the deployed SHA matches `master`.
