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

The deployed public-form abuse protection uses independent Redis quotas of 10 new submissions per client IP in 10 minutes and 3 per normalized contact in 24 hours. The API rejects bodies over 16 KiB. An already accepted idempotency-key replay does not spend another quota; a filled hidden bot field appears accepted but creates no lead. A quota response is HTTP 429 with `Retry-After`; unavailable Redis is HTTP 503 and no lead is accepted. The form shows localized, non-field retry/outage guidance without clearing the entered values. Caddy runs the matching trusted-proxy configuration in `Caddyfile` so the API sees the sanitized client IP; do not enable `trust proxy` on an API reachable directly from an untrusted network. Production-browser 429/503 UI handling passed with intercepted responses; a controlled real quota/replay and tunnel client-IP boundary still need acceptance. No raw client IP or contact should be entered into diagnostics.

The separate conversion intake is disabled by default with `MARKETING_ANALYTICS_ENABLED=false`. It must stay off until the public privacy disclosure, event contract, legal basis and market rollout are approved. The database holds only aggregate UTC day/event/locale/approved-plan counts; the API role can increment through a narrow function but cannot read raw counter rows. Do not infer unique visitors or trial activation from these counters. `DEMO_LEAD_ERASURE_ENABLED=false` likewise keeps early deletion and scheduled lead purging unavailable until the independent erasure-ledger and restore gates in [`demo-lead-lifecycle.md`](demo-lead-lifecycle.md) pass.

The dashboard's plan discussion action opens email even if measurement is off or the API fails; it is not a subscription or callback request. Platform administrators may see only aggregates in `/admin/conversions`, with cells under three suppressed. The registration-to-first-order rate uses registered organizations in the selected cohort; the first-order-to-plan-interest rate is shown only inside the 90-day linkable window. A daily worker sweep removes raw tenant-plan interests after 90 days and anonymous daily counters after 13 months in batches of 100. Verify its count-only logs and database age bounds after deployment. Do not set `MARKETING_ANALYTICS_ENABLED=true` merely because the privacy text ships: record legal basis, market, operator approval, a browser network-payload check, retention verification and an explicit release decision first.

After the new release, the worker claims a due lead with a two-minute lease and makes at most four SMTP attempts. Retryable failures wait 1, 5, then 15 minutes. If any required SMTP setting or `DEMO_LEAD_EMAIL` is absent at startup, the worker leaves due leads unclaimed and pauses demo reconciliation; setting the values requires a worker restart, after which reconciliation resumes. This standby state does not constitute successful email delivery. Explicit SMTP 5xx rejection stops immediately; an ambiguous timeout remains retryable. A five-second bounded reconciliation scan restores due jobs after Redis/worker failure when configured. `SENT` is terminal. The platform operations page exposes only due/exhausted counts and queue health, never lead contacts. SMTP acceptance can be ambiguous if the worker dies before marking `SENT`; every attempt uses the same Message-ID, but this does not guarantee exactly-once physical email.

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
7. If SMTP is still unconfigured, verify a fictional test lead remains due with zero consumed attempts and configure SMTP before claiming delivery works. Once configured, restart the worker, submit one approved internal test lead and confirm both the database record and notification email.
8. Complete Search Console and Bing verification.

## Rollback

Roll back application containers first. The demo lead table is additive and can remain in place during an application rollback. Do not drop it while leads may contain unresolved business contacts.

## Deployment record

### 2026-10-20 demo operations and conversion-code rollout

- Fast-forwarded and pushed `master` through `25006d1` (main implementation at `aaaa53a`). Before deployment, created `backups/20261020T115402Z`: SHA-256 manifest verified the PostgreSQL dump, MinIO archive and configuration; the dump listing was readable and a full PostgreSQL restore succeeded in an isolated temporary container with 67 public tables. The temporary restore container was removed; the backup remains local. This is **not** an off-host erasure ledger or independent-host disaster-recovery proof.
- The manual deploy built API/web/worker and applied the five additive `20261020*` migrations and role grants. Docker Compose briefly stalled replacing an old API process, causing a temporary 502. Existing data was not reset. The newly built containers were started and registered under canonical Compose names, Caddy was reloaded, and API/web/worker, PostgreSQL and Redis returned to healthy. Docker Desktop itself was not restarted. A subsequent web-only rebuild/recreate deployed the error-state styling in `25006d1`.
- Public `/uk/demo` and `/health/live` returned HTTP 200 after the rollout. Production Playwright ran 26 cases: 12 passed and 14 authenticated cases skipped because platform-admin/owner test credentials and a safe order ID were unavailable to the test process. Passed cases cover public locale/SEO/responsiveness, field validation at four widths, fictional demo success via intercepted API response, localized 429/503 with retained values via intercepted responses, and strict public conversion-event payload shape. The final 429 screenshot in ignored `test-results` shows error styling. These intercepted cases do **not** prove a live lead was persisted, a real quota was enforced, or Redis failed over. Platform-admin queue/export/report and owner form flows remain unverified in the deployed browser.
- `MARKETING_ANALYTICS_ENABLED` and `DEMO_LEAD_ERASURE_ENABLED` are unset in the running API/worker, so both safe defaults remain disabled. Do not turn either on to complete acceptance: analytics needs a recorded privacy/legal release decision, and erasure needs the independent ledger/restore gates. SMTP/internal recipient are still unconfigured; notification delivery remains unverified.
- A follow-up authenticated production-browser smoke exercised the owner profile, new-product editor and bank-account form with invalid/fictional values only. Each field error was localized, focused and linked through `aria-invalid`/`aria-describedby`; correcting one field preserved other errors. The product editor was closed without saving, and reload showed unchanged profile details and one bank account. The available owner session redirected `/admin/leads` to `/dashboard` after authorization, so admin acceptance remains open. Browser warnings observed in this session came from unrelated extensions, not a `sales-aito.com` script URL; no site-scoped console warning/error was captured.
- Read-only host inspection confirmed the running proxy's mounted Caddyfile SHA-256 equals the repository file; it trusts `CF-Connecting-IP` only from private peers and forwards parsed client IP to API. `cloudflared` and proxy share `autosale_edge`. The remote Cloudflare hostname-to-proxy mapping and a live spoofed-header boundary were not inspected, so those gates remain open.
- The same tenant-owner browser session received a response reporting `statusCode: 403` from `GET /api/admin/demo-leads` with no contact data. This confirms the negative role boundary after the route redirect; it does not prove the admin queue's authorized success path.
- A subsequent `PLATFORM_ADMIN` production-browser session verified the masked demo queue, status filtering and reload, fictional-lead detail, one explicitly approved `NEW → CONTACTED` transition with persisted list/detail state, aggregate-only conversion reporting with date validation and suppressed small cells, and count-only demo-notification operations metrics (one due, zero exhausted). The JSON and CSV export forms required password step-up and showed localized required-field errors; no password was entered and no contact file was downloaded. The actual export headers/audit, authenticated Playwright cases, SMTP delivery and other external release gates remain open. The browser's site-scoped console logs contained no warnings or errors in this check; unrelated extension warnings were ignored.
- 2026-10-20 18:09 UTC: released tested `master` commit `67ca795064fb184d9d01c4238375c7f926d7fb4d` as a web-only image (`sha256:2539ca3ec270ab827e9086672e3f8acca481851ebfe602d2f3088fda555cce0d`). Before replacement, created `backups/20261020T180523Z`; SHA-256 manifest passed, the MinIO tar was readable, and PostgreSQL `pg_restore -l` read 778 listing lines. A first Git Bash path-conversion attempt left private `backups/.incomplete-20261020T180509Z`; cleanup was not permitted by the local command policy, so this incomplete copy is retained for separate controlled removal and must not be used for restore. Compose showed API/web/worker/PostgreSQL/Redis/MinIO healthy; public login returned HTTP 200. A fresh platform-admin browser session verified that blank CSV export now focuses the password field with localized error, `aria-invalid` and `aria-describedby`, with no site-scoped console warnings/errors; the form was cancelled without a download. Evidence screenshot: ignored `artifacts/admin-lead-export-password-focus-2026-10-20.png`. No database migration or API/worker replacement was performed.

### 2026-10-18 controlled acceptance follow-up

- A disposable PostgreSQL container plus SMTP server bound to `127.0.0.1` verified one fictional notification after a transient 450 response, a terminal 550 rejection without retry, no second email on `SENT` replay, and reconciliation after a simulated queue-enqueue failure. The worker's 15 demo-lead tests and typecheck passed. PostgreSQL suites that timed out when two test containers started concurrently passed individually with one worker; run them serially on this busy Docker Desktop host.
- A follow-up isolated test restarted a disposable Redis container and recreated a BullMQ worker instance against the same disposable PostgreSQL database. Reconciliation recovered a due lead and a replayed completed job did not trigger another SMTP-boundary call. The 16 demo-lead tests and worker typecheck passed with one Vitest worker. This does not replace full application-process restart or real-mailbox acceptance; no production containers were restarted for this check.
- The deployed `worker` container was then restarted without rebuilding other services. Its process returned to Docker `healthy`, the public `/health/live` endpoint returned HTTP 200, and the count-only database aggregate remained one `PENDING` lead with zero attempts before and after startup. All required worker SMTP/recipient settings were absent, so this proves full-container startup and safe unconfigured standby only; it does **not** prove post-restart SMTP delivery or reconciliation with a configured sender.
- Production still has no SMTP or internal recipient settings. The live pending lead therefore remains unclaimed with zero attempts; no production email or platform-admin browser acceptance is claimed. No application rebuild/deploy is required for this test-only follow-up.

### 2026-10-16 durable demo-notification rollout

- Deployed and pushed `master` commit `ed43c046623fe28f897660f9b11da9db2b1dc497` to the current Windows Docker/Cloudflare host. Fresh application-consistent backup: `backups/20261015T201645Z`; its manifest was checksum-verified, and the PostgreSQL dump and MinIO archive were readable. A separate partial backup at `backups/.incomplete-20261015T201626Z` from the first attempt was retained for manual private cleanup; it must not be published.
- The isolated branch passed 2,100 automated tests (one pre-existing skipped test), monorepo typecheck, production build, and quiet Compose validation. The pre-release hardening keeps unconfigured worker startup in standby without consuming due leads or attempts.
- A loopback-only SMTP sink accepted one fictional lead notification with the stable Message-ID. Database tests cover atomic claims, bounded delays, expiration and migration backfill; API/worker tests cover queue failures and safe aggregates.
- Migration `20261015_demo_lead_notification_retries` finished successfully. API, web, worker, PostgreSQL, Redis and MinIO were healthy after deployment, and public `/health/live` returned HTTP 200.
- In the deployed Ukrainian demo form, blank submission showed localized field errors and focused the first invalid control. One clearly fictional browser-submitted lead displayed “Заявку отримано”. After reload the public form reset, while a read-only database aggregate still showed exactly one `PENDING` lead with zero attempts. No contacts were displayed in the diagnostic output.
- The current host has no `SMTP_*` or `DEMO_LEAD_EMAIL` values. Therefore the live worker intentionally leaves the lead due; no production email delivery has been verified. The browser session available for acceptance redirected `/admin/operations` to the workspace dashboard, so the count-only platform-admin view also remains unverified in a platform-admin session.

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
