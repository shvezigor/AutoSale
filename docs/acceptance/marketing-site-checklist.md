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

- [x] Deploy the integrated marketing release to the production host on 2026-09-18; the initial 2026-09-17 build was rolled back before the corrected release.
- [x] Apply migration `20260917150000_demo_leads` in production, as recorded in the release runbook.
- [ ] Configure `DEMO_LEAD_EMAIL` and SMTP, then verify a real internal notification.
- [ ] For the retry rollout, prove with a controlled local SMTP sink that a saved fictional lead is sent once, transient failures retry with bounded delays, terminal failures stop, and Redis/worker restart recovery does not resend `SENT` rows.
- [ ] In a real browser against the deployed environment, verify localized demo submission/validation, a reload-safe result, and count-only admin operations; capture UI evidence. Do not count the configured SMTP recipient as verified until an authorized internal test email is observed.
- [ ] Inspect and confirm the canonical Cloudflare Tunnel hostname-to-proxy configuration. The 2026-09-18 HTTPS 200 route checks prove public reachability, but the release record does not document this configuration inspection.
- [ ] Verify Google Search Console and Bing Webmaster Tools, then submit the sitemap.
- [ ] Record production Core Web Vitals after deployment.
