# Sales AITO marketing release

## Required production configuration

```dotenv
APP_PUBLIC_URL=https://sales-aito.com
DEMO_LEAD_EMAIL=sales@example.com
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=Sales AITO <no-reply@sales-aito.com>
CLOUDFLARE_TUNNEL_TOKEN=...
```

`DEMO_LEAD_EMAIL` is the internal recipient of demo notifications. The worker needs the `SMTP_*` values and `DEMO_LEAD_EMAIL`; the API retains SMTP configuration for authentication mail only. A demo lead is committed to PostgreSQL before an ID-only BullMQ wake-up job is queued. The HTTP response does not wait for SMTP, and a Redis outage does not lose a committed lead.

After the new release, the worker claims a due lead with a two-minute lease and makes at most four SMTP attempts. Retryable failures wait 1, 5, then 15 minutes. Missing SMTP settings and explicit SMTP 5xx rejection stop immediately; an ambiguous timeout remains retryable. A five-second bounded reconciliation scan restores due jobs after Redis/worker failure. `SENT` is terminal. The platform operations page exposes only due/exhausted counts and queue health, never lead contacts. SMTP acceptance can be ambiguous if the worker dies before marking `SENT`; every attempt uses the same Message-ID, but this does not guarantee exactly-once physical email.

After correcting a terminal failure, an operator with approved database access may requeue exactly one lead using its UUID (never a contact value):

```sh
docker compose exec api node dist/cli/requeue-demo-lead.js <lead-uuid> --confirm-id <same-lead-uuid>
```

The command only changes a terminal `FAILED` row without an active lease; it cannot requeue `SENT`. The output contains the lead UUID and result only. Do not paste contact details or raw SMTP errors into support tickets or logs.

## Deployment order

1. Back up PostgreSQL.
2. Build all images and validate `docker compose config`.
3. Run the additive migration containing `20261015_demo_lead_notification_retries`; backfill only non-`SENT` rows with fewer than four attempts.
4. Deploy the tested API before the new worker from the same commit. Do not start the new worker while an old API instance can still send demo email inline; the old worker simply ignores the new queue while PostgreSQL retains the lead. Deploy web and proxy after health checks.
5. Verify the Cloudflare Tunnel route points `sales-aito.com` to the proxy service.
6. Run the public endpoint checks from `docs/operations/search-indexing.md`.
7. Submit one test demo lead with an approved internal test contact and confirm both the database record and notification email.
8. Complete Search Console and Bing verification.

## Rollback

Roll back application containers first. The demo lead table is additive and can remain in place during an application rollback. Do not drop it while leads may contain unresolved business contacts.

## Deployment record

### 2026-10-15 retry candidate (not yet a production release)

- The isolated branch passed 2,096 automated tests (one pre-existing skipped test), monorepo typecheck, production build, and quiet Compose validation.
- A loopback-only SMTP sink accepted one fictional lead notification with the stable Message-ID. Database tests cover atomic claims, bounded delays, expiration and migration backfill; API/worker tests cover queue failures and safe aggregates.
- No live production SMTP recipient or browser acceptance is claimed here. Record the deployed master SHA, fresh backup ID, browser evidence and authorized internal mailbox result after rollout.

### 2026-09-17

- Initially deployed the standalone marketing implementation from commit `4204556`. This release was rolled back after verification showed that its application base did not contain the latest workspace functionality from `master`.
- Created the pre-deployment PostgreSQL backup under `backups/20260917T185528Z` with its SHA-256 recorded in the local manifest.
- Applied migration `20260917150000_demo_leads` successfully.
- Restored the application containers from `master` commit `f5db5fd` before preparing the corrected integration release.

### 2026-09-18

- Integrated the bilingual marketing website onto `master` commit `f5db5fd` in branch `codex/marketing-master-integration`.
- Preserved the current dashboard, profile, settings, onboarding, Google OAuth, notifications, Telegram, delivery, worker, and API functionality while adding the public marketing routes and demo-lead flow.
- Deployed the corrected application from integration commits `80746a4`, `80fa368`, and `0705722`.
- Confirmed that all 1,340 automated tests pass, the monorepo typecheck passes, and the production build contains both public marketing routes and private workspace routes.
- Confirmed healthy API, worker, and web containers.
- Confirmed HTTPS 200 responses for the localized home pages, pricing, demo, login, health endpoint, robots, sitemap, and hero asset.
- Confirmed that unauthenticated dashboard and profile requests redirect to login and that the current workspace login interface is served after the deployment.
- Confirmed canonical URL, reciprocal English alternate, JSON-LD, public indexing directive, and private login noindex directive in production HTML.
- SMTP delivery and search-console submission remain pending external configuration.
