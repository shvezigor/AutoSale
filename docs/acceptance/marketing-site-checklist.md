# Marketing site acceptance record

Original acceptance date: 2026-09-17. Release status reconciled on 2026-10-15 against the [production marketing release record](../operations/marketing-release.md).

## Automated evidence

- [x] 2026-10-02: the home hero renders the 3:2 source artwork with `object-fit: cover`, breakpoint-specific focal positioning and no width/height distortion.
- [x] 2026-09-23: invalid demo submission Playwright regression passes at 320/768/1024/1440 px: field text, focus, retained values, independent clearing and no horizontal overflow.

- [x] Web typecheck passes.
- [x] Web production build passes.
- [x] Existing web tests and new marketing registry/locale tests pass.
- [x] Contracts tests pass, including demo lead validation.
- [x] API tests pass, including durable demo lead and notification failure behavior.
- [x] 2026-10-21: `demo-lead-abuse.service.spec.ts` passed all eight checks against a disposable Redis 8.2.1 container bound to a random loopback port. The real Lua quota admitted exactly 10 of 20 concurrent requests, rejected the other 10, then admitted a request after expiry. A second integration check established a Redis connection, disconnected that client, and confirmed the limiter returned a safe 503. This is isolated adapter evidence, not a production HTTP `Retry-After`, proxy-IP, or server-outage acceptance.
- [x] 2026-10-21: `demo-leads.redis-http.spec.ts` exercised the actual Nest public route with the same disposable Redis and a fictional in-memory lead repository: three distinct keys were accepted, the fourth contact request returned HTTP 429 with a positive `Retry-After` and no contact in the error, replay of the first key returned its original result without another insert, and a disconnected Redis client returned HTTP 503 without an insert. No public lead, email or live Redis state was changed. Production Caddy/Cloudflare client-IP handling and an actual Redis-server outage remain unverified.
- [x] Marketing Playwright suite passes for SEO metadata, hero asset loading, equivalent locale switching, 375/768/1440 responsive widths, and demo submission state.
- [x] Raw server HTML contains localized H1, canonical, alternate links, JSON-LD, and indexable robots metadata.
- [x] Login inherits `noindex, nofollow`.
- [x] Root redirects once to `/uk`; localized pages, image, robots, and sitemap return 200 locally.

## Human/browser evidence

- [x] Autonomous Command direction matches approved graphite, lime, and restrained violet palette.
- [x] Generated hero art is visible and carries no text, logo, fake dashboard, or stock photography.
- [x] Current capabilities and future integrations are visibly distinguished.
- [x] Desktop navigation, headings, disclosure controls, links, and landmarks appear in the accessibility tree.
- [x] Browser console has no errors or warnings on the tested Ukrainian home page.

## External launch prerequisites

- [x] 2026-10-20: the public abuse-protection code was manually deployed after a checksum-verified backup and isolated PostgreSQL restore. Production Playwright verified the real form's localized 429 and 503 states with retained fictional values using intercepted responses; a screenshot of the 429 state is stored in ignored Playwright output. Public pricing-signal payload, locale navigation, SEO, responsive layout, demo success and invalid-field tests also passed. The 429/503 browser checks verify UI handling, **not** that production Redis actually throttled or failed.
- [ ] Repeat with one approved fictional lead and its idempotent replay, inspect actual `Retry-After` after a controlled quota test, and verify the Cloudflare Tunnel client-IP boundary without logging raw IPs. The 2026-10-21 read-only audit found that private-network peers are trusted for `CF-Connecting-IP` while Caddy's host port is published on every interface; the separate public tunnel currently targets `host.docker.internal:80`. Whether the firewall admits an untrusted private peer and which tunnel serves the hostname remain unverified. Follow the coordinated route/restriction sequence in the [release runbook](../operations/marketing-release.md); do not induce a Redis outage on the live host or change the port binding alone.
- [x] 2026-10-20: in a live `PLATFORM_ADMIN` browser session, the demo queue showed one explicitly fictional lead with a masked contact and no note or full contact in the table. The `CLOSED` filter showed an empty state and remained selected after reload; returning to all statuses restored the row. The detail page opened for that fictional lead. With the owner's explicit approval, `NEW → CONTACTED` completed once; the new status and next permitted action remained after reload, and the masked queue row appeared under the `CONTACTED` filter after another reload. No customer message was sent.
- [x] 2026-10-20: the same admin session loaded the aggregate-only conversion report. Cells under three appeared suppressed, both cohort rates showed insufficient data, a valid date range changed the URL and persisted after reload, and an invalid range showed a localized field error with `aria-invalid`/`aria-describedby`. The operations page showed only count metrics for demo notifications (one due, zero exhausted), with no lead contact, and those counts remained after reload. No site-scoped console warning/error was captured; unrelated extension warnings were present.
- [ ] Complete the actual purpose-bound JSON and scoped CSV downloads in an authorized admin browser session. Both export controls opened password step-up forms; blank submit showed a localized field error and `aria-invalid`, then the forms were closed without entering a password or downloading a contact file. The CSV browser check exposed a first-invalid-focus bug; after the `67ca795` web-only release, a fresh browser check confirmed focus on the invalid password and `aria-describedby="currentPassword-error"`. Regression tests cover CSV and deletion confirmation focus. Inspect actual no-store/same-origin export headers and audit records without copying contacts into evidence. Automated authenticated E2E cases remain skipped without `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; manual browser smoke does not replace them.
- [ ] 2026-10-20: an initial new-tab observation briefly showed an admin shell before the signed-in tenant-owner session redirected to `/dashboard`. A repeated direct `/admin` visit redirected immediately without showing admin content; the web proxy and server layout both gate by `PLATFORM_ADMIN`. No repeatable cross-role disclosure was observed, but this is not a dedicated security audit or platform-admin acceptance. No lead detail or contact was opened.
- [x] 2026-10-20: the same signed-in tenant-owner browser session received a response reporting `statusCode: 403` and `Insufficient access` from `GET /api/admin/demo-leads`; no lead rows or contacts were returned. This verifies the negative authorization path, not the platform-admin success path.

- [x] Deploy the integrated marketing release to the production host on 2026-09-18; the initial 2026-09-17 build was rolled back before the corrected release.
- [x] Apply migration `20260917150000_demo_leads` in production, as recorded in the release runbook.
- [ ] Configure `DEMO_LEAD_EMAIL` and SMTP, then verify a real internal notification.
- [x] A worker started without SMTP configuration defers due leads without claiming them or spending an attempt. Unit checks cover processor and reconciliation standby; the 2026-10-16 production browser submission persisted as one `PENDING` lead with zero attempts after reload.
- [x] A controlled local SMTP sink proves that a saved fictional lead is sent once, a transient failure retries, a terminal rejection stops, and replay of a `SENT` row does not resend it.
- [x] 2026-10-18 isolated cross-component test: real disposable PostgreSQL, loopback-only SMTP, stored transient failure followed by success, terminal recipient rejection, ignored `SENT` replay, and recovery after a simulated queue-enqueue failure. The test and worker typecheck pass when PostgreSQL suites run serially.
- [x] 2026-10-18 isolated Redis recovery: real disposable Redis container and PostgreSQL, a BullMQ worker instance closed and recreated after the Redis restart, a due lead recovered by reconciliation, and a replayed `SENT` job ignored without a second send. SMTP is doubled only in this queue-boundary test; the separate loopback-SMTP test covers actual delivery.
- [x] Restart the deployed worker container while SMTP is unconfigured: it returned to `healthy`, public health stayed HTTP 200, and the existing count-only lead aggregate remained `PENDING` with zero attempts. This verifies complete process boot and safe standby, not delivery.
- [ ] Repeat with a full application worker process/container restart and controlled SMTP sink. The isolated BullMQ instance restart proves configured queue recovery, while the deployed container restart proves only unconfigured standby; neither proves delivery after a configured process restart.
- [x] In a real browser against the deployed environment, verify localized blank-submit errors and first-invalid focus, submit one clearly fictional lead, and observe the success state; completed 2026-10-16 with screenshot evidence in the release session.
- [x] Reload the public demo page and verify the submitted lead persists in the database without another notification attempt. The public success message itself is intentionally transient; the form resets on reload, while the database aggregate remained at one `PENDING` lead with zero attempts.
- [x] 2026-10-20: the platform-admin operations page displayed count-only demo notification metrics (one due, zero exhausted) after reload and no lead contact. The earlier tenant-owner session correctly redirected `/admin/operations` to `/dashboard`; that negative path is separate from this successful admin check.
- [ ] Inspect and confirm the canonical Cloudflare Tunnel hostname-to-proxy configuration. The 2026-09-18 HTTPS 200 route checks prove public reachability, but the release record does not document this configuration inspection.
- [x] 2026-10-20: read-only host inspection confirmed the running proxy mounts the current `Caddyfile` byte-for-byte (SHA-256 match), uses `CF-Connecting-IP` only from private trusted peers and forwards the parsed client IP to API. The running tunnel and proxy share only the `autosale_edge` network; proxy also joins `autosale_internal`. This verifies local wiring, **not** the remote Cloudflare hostname route or a live spoofing boundary test.
- [ ] Verify Google Search Console and Bing Webmaster Tools, then submit the sitemap.
- [ ] Record production Core Web Vitals after deployment.
