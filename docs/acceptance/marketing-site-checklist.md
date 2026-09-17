# Marketing site acceptance record

Date: 2026-09-17

## Automated evidence

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

- [ ] Deploy the branch to the production host.
- [ ] Apply the database migration in production.
- [ ] Configure `DEMO_LEAD_EMAIL` and SMTP, then verify a real internal notification.
- [ ] Confirm Cloudflare routes the canonical hostname to the current proxy.
- [ ] Verify Google Search Console and Bing Webmaster Tools, then submit the sitemap.
- [ ] Record production Core Web Vitals after deployment.
