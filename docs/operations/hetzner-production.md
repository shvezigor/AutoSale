# Sales AITO production on Hetzner Cloud

This is the canonical operator runbook for preparing, provisioning, migrating, releasing, scaling, and recovering the initial Sales AITO production host. It complements the provider-neutral [`deployment.md`](deployment.md), [`backup-restore.md`](backup-restore.md), and [`../../infra/AUTO_DEPLOY.md`](../../infra/AUTO_DEPLOY.md).

## Current decision and state

The selected baseline is recorded in [`ADR 0001`](../adr/0001-hetzner-single-host-production.md). As of 18 September 2026, a Hetzner order form was prepared but **no server was purchased or created**. A browser form is not durable infrastructure state and must be rechecked before ordering.

The last observed draft contained:

| Setting | Draft value |
| --- | --- |
| Project shown in the console | `FinTrack` — replace with a separate `Sales AITO` project |
| Server name | `sales-aito-prod-01` |
| Plan | CPX32, 4 shared vCPU, 8 GB RAM, 160 GB SSD |
| Location | Falkenstein, Germany |
| Image | Ubuntu 24.04 LTS |
| Network | public IPv4 and IPv6 |
| Backups | enabled in the draft |
| Displayed total | USD 50.99/month excluding VAT at that time |
| Missing | SSH key and firewall |

Pricing and availability are time-sensitive. Reconfirm them in the Hetzner Console immediately before purchase. The order becomes billable when `Create & Buy now` is confirmed; leaving the form open does not reserve capacity or save a reliable draft.

## Target topology

```text
Internet
   |
Cloudflare DNS / Tunnel
   |
Hetzner Cloud Firewall
   |
sales-aito-prod-01
   |-- cloudflared -> Caddy
   |-- Next.js web
   |-- NestJS API
   |-- BullMQ worker
   |-- PostgreSQL
   |-- Redis
   `-- MinIO

Off-host: GitHub, encrypted backups, provider credentials
```

The Compose project contains nine services; `migrate` is one-shot and the other eight are long-running. One host is acceptable for the initial cost-sensitive stage, but it is not highly available.

## Gates that require explicit approval

Stop immediately before each of these actions unless the user has explicitly authorized it for the current operation:

- clicking `Create & Buy now` or provisioning any other paid Hetzner resource;
- uploading or creating an SSH/deployment key;
- changing `sales-aito.com` DNS or Cloudflare Tunnel routing;
- enabling the repository variable `AUTO_DEPLOY_ENABLED=true`;
- stopping the current production stack or making the new host authoritative;
- restoring a backup over an existing database;
- deleting the old host, disk, Volume, snapshot, backup, IP, or firewall.

## Phase 1: free preparation

Complete these items before purchasing a server:

1. Create or select a dedicated Hetzner project named `Sales AITO`.
2. Choose the final plan after checking whether deployment still builds images on the host:
   - CPX32 is the minimum start and needs memory monitoring;
   - CPX42 is safer while `infra/scripts/deploy.sh` performs Docker builds on the host.
3. Prepare a dedicated administrator SSH public key and a separate GitHub deployment key. Never reuse a personal private key in GitHub Actions.
4. Define a Hetzner Cloud Firewall:
   - inbound SSH only from approved administrator source addresses;
   - no public PostgreSQL, Redis, MinIO, API, metrics, or Docker daemon ports;
   - no inbound 80/443 is required when Cloudflare Tunnel is the only ingress;
   - allow outbound traffic needed for GitHub, container registries, Cloudflare, email, AI, Meta, Google, Telegram, and delivery providers.
5. Prepare production secrets using `.env.example` as the inventory. Store only the final `.env` on the server and provider credentials in their approved secret stores.
6. Decide the cutover type:
   - **new empty production** — no existing authoritative data;
   - **migration** — current PostgreSQL/MinIO data must be backed up, transferred, restored, and reconciled.
7. Confirm a rollback owner, maintenance window, recovery point, and recovery time target.

Do not paste any real secret, private key, token, database dump, or customer data into an issue, commit, chat, or runbook.

## Phase 2: provision the host

After explicit purchase approval:

1. Recheck project, location, plan, price, architecture, Ubuntu version, IPs, backups, SSH key, firewall, and hostname.
2. Create the server and record its Hetzner resource ID outside Git.
3. Verify the SSH host key through a trusted channel before accepting it.
4. Install current Docker Engine, Docker Compose v2, Git, and curl from their official repositories.
5. Create a dedicated non-root deploy user. Membership in the Docker group is privileged; grant it only to that account.
6. Disable password and root SSH login only after key-based login has been verified in a second session.
7. Enable unattended security updates and accurate time synchronization.
8. Create `/srv/autosale` for the deployment checkout and `/srv/autosale-backups` for local backup staging, owned by the deploy operator.
9. Keep production databases and storage on the primary disk initially. Do not attach a Volume by default: Volumes are not covered by Hetzner server backups and require their own backup policy.
10. If CPX32 must build images locally, add a small host-local swap file as an emergency cushion and alert on any sustained runtime swap use. Swap is not a substitute for adequate RAM.

Capture a baseline of disk, memory, CPU, load, Docker, and kernel versions without recording secrets.

## Phase 3: prepare the application

1. Clone the repository into `/srv/autosale` using the server's read-only GitHub deploy key.
2. Checkout the approved `master` commit and keep the checkout deployment-only. Local tracked changes intentionally block automated deployment.
3. Create `/srv/autosale/.env` from `.env.example`, set `NODE_ENV=production`, and apply restrictive file permissions.
4. Required public values must agree:
   - `APP_PUBLIC_URL=https://sales-aito.com`;
   - Google and Meta callback URLs use the same exact origin;
   - production cookies remain secure;
   - feature flags stay disabled until their provider acceptance is complete.
5. Configure a dedicated Cloudflare Tunnel for the new production host. During preparation, test host-local health before routing the production hostname.
6. Validate without printing expanded secrets:

```sh
cd /srv/autosale
docker compose config --quiet
```

Do not use `docker compose config` without `--quiet` in shared logs because expanded environment values may be exposed.

## Phase 4: data migration or initial deployment

### New empty production

Run the normal deployment after configuration validation:

```sh
cd /srv/autosale
chmod +x infra/scripts/*.sh
sh infra/scripts/deploy.sh
```

Create the initial platform administrator only through the documented [`authentication.md`](authentication.md) procedure.

### Migration from an existing production host

1. Deploy and health-check the new stack before it receives production traffic.
2. Take a fresh application-consistent backup on the source using [`backup-restore.md`](backup-restore.md).
3. Copy the encrypted backup to off-host storage and to the new host; verify `SHA256SUMS`.
4. Begin the maintenance window. Stop source-side ingestion and workers so no new writes occur after the final backup.
5. Take the final backup, transfer it, and verify checksums again.
6. Restore on the new host only after explicit restore confirmation:

```sh
CONFIRM_RESTORE=autosale infra/scripts/restore.sh /absolute/path/to/final-backup
sh infra/scripts/deploy.sh
```

7. Validate record counts, representative fictional/control records, MinIO objects, migrations, login, worker health, and pending jobs.
8. Move the Cloudflare production route only after the restored system is healthy.
9. Keep the old host stopped but recoverable until the agreed rollback window expires. Do not allow both independent databases to accept production writes.

## Phase 5: release automation

Follow [`../../infra/AUTO_DEPLOY.md`](../../infra/AUTO_DEPLOY.md). Configure the GitHub `production` Environment with:

- `DEPLOY_HOST`;
- optional `DEPLOY_PORT`;
- `DEPLOY_USER`;
- `DEPLOY_PATH=/srv/autosale`;
- dedicated `DEPLOY_SSH_PRIVATE_KEY`;
- pinned `DEPLOY_SSH_HOST_KEYS`;
- `DEPLOY_HEALTHCHECK_URL=https://sales-aito.com/health/live`.

Leave `AUTO_DEPLOY_ENABLED` unset or not equal to `true` until one manual deployment and rollback rehearsal succeed. Enabling it is a separate production change. Once enabled, each successful `master` verification deploys the exact tested commit; a failed rollout attempts to restore the previous application commit.

The current deployment builds images on the server. Moving builds to GitHub Actions and publishing immutable images to GHCR is the highest-priority infrastructure improvement before horizontal scaling.

## Acceptance checklist

Record the deployed commit and require all applicable checks:

- `docker compose ps` shows healthy long-running services and a successfully completed migration;
- host memory, swap, disk, and load are within thresholds;
- `https://sales-aito.com/health/live` succeeds through Cloudflare;
- Ukrainian and English public routes load with the correct canonical host;
- registration/login and one controlled manager session work;
- API and worker metrics are reachable only from the internal/admin path;
- PostgreSQL and MinIO data are present and Redis can recover queues from authoritative state;
- Meta/Google callbacks still match `https://sales-aito.com`;
- one controlled inbound webhook is acknowledged without duplicate processing;
- no real customer message, shipment, supplier notification, or email is generated solely for a smoke test;
- a new backup completes, checksum verification succeeds, and an off-host copy exists;
- logs contain no tokens, passwords, phone numbers, addresses, message bodies, or unbounded identifiers.

Do not mark production ready while any required provider acceptance remains pending.

## Routine operations

- Apply OS security updates regularly and schedule reboots.
- Run application-consistent backups daily, retain local copies for 14 days, keep encrypted off-host copies for at least 30 days, and perform a restore drill at least quarterly.
- Alert before memory, CPU, disk, queue, database connection, or backup age becomes critical. Start with warning at 70% disk usage and adapt thresholds from measured production behavior.
- Deploy only verified `master` commits or immutable release tags.
- Record release SHA, UTC time, operator, backup ID, health result, and rollback outcome without production personal data.

## Vertical scaling without application migration

Hetzner Rescale changes CPU/RAM through a larger fixed plan; individual RAM modules cannot be added separately.

Before rescaling:

1. Diagnose the actual bottleneck from host and application metrics.
2. Create and verify an application-consistent off-host backup.
3. Create a server snapshot if appropriate and schedule a restart window.
4. Keep the same CPU architecture; the current CPX line is x86.
5. When moving to a larger plan, prefer keeping the current primary-disk size if Hetzner offers that option and future downgrade matters.

If the primary disk is enlarged, expand the partition/filesystem after rescale and verify capacity. Primary disks and Volumes cannot be shrunk through normal Hetzner resizing. Attached Volumes can grow to the provider limit but are excluded from server backups.

Vertical scaling preserves the single failure domain. Add a second host only after stateful services/object storage are externalized or otherwise shared safely.

## Failure and rollback

- Application failure before cutover: keep production on the old host and fix the new host offline.
- Application failure after a normal release: use the existing exact-commit rollback path; never attempt an automatic Prisma schema downgrade.
- Data migration failure before traffic switch: discard the incomplete target data and repeat from a verified backup.
- Failure after traffic switch with no new writes: route back to the preserved old host.
- Failure after new writes: stop and reconcile data explicitly; do not point traffic back to a stale database.
- Lost host: provision a clean compatible server, restore the recorded Git commit and secrets, restore PostgreSQL/MinIO from the latest verified backup, then reattach routing only after acceptance.

## Decommission gate

Do not delete the old environment until the rollback window has expired, production backups have passed checksum and restore validation, provider callbacks are stable, and the owner explicitly approves deletion. Record what was deleted and whether any snapshot or backup remains recoverable.
