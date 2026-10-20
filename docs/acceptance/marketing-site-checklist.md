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
- [ ] Repeat with one approved fictional lead and its idempotent replay, inspect actual `Retry-After` after a controlled quota test, and verify the Cloudflare Tunnel client-IP boundary without logging raw IPs. Do not induce a Redis outage on the live host merely for this checklist.
- [ ] The platform-admin demo queue/detail/status/export and aggregate conversion report still require a platform-admin browser session. Automated E2E cases are present but skipped without `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`; this is not accepted browser coverage.

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
- [ ] Verify count-only demo notification metrics in a platform-admin browser session. The available session redirected `/admin/operations` to `/dashboard`, so this browser check is not complete.
- [ ] Inspect and confirm the canonical Cloudflare Tunnel hostname-to-proxy configuration. The 2026-09-18 HTTPS 200 route checks prove public reachability, but the release record does not document this configuration inspection.
- [ ] Verify Google Search Console and Bing Webmaster Tools, then submit the sitemap.
- [ ] Record production Core Web Vitals after deployment.
