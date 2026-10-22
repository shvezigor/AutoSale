# Sales AITO search indexing

## Canonical public surface

- Production origin: `https://sales-aito.com`
- Default locale: Ukrainian at `/uk`
- English locale: `/en`
- Locale roots and translated pages use self-referencing canonical URLs without a trailing slash.
- Ukrainian, English, and `x-default` alternates are emitted in server HTML.
- Public URLs are listed in `/sitemap.xml`; private workspace, account, and admin routes are excluded.
- The sitemap omits `<lastmod>` until a reliable per-page date of the last significant content update is available; it must not advertise a shared release date as every page's modification date.
- `/robots.txt` allows public pages and assets, points to the sitemap, and disallows private route families.

Core page content, headings, canonical links, alternates, JSON-LD, and navigation are server-rendered. The language switch performs a full document navigation so `<html lang>` changes correctly.

## Release checklist

1. Set `APP_PUBLIC_URL=https://sales-aito.com` in production.
2. Route `sales-aito.com` and `www.sales-aito.com` to the Cloudflare Tunnel service, with one hostname redirecting permanently to the chosen canonical host.
3. Verify the following return HTTPS 200 responses: `/uk`, `/en`, `/uk/pricing`, `/en/pricing`, `/robots.txt`, `/sitemap.xml`, and `/images/sales-aito-ai-operator-hero.png`.
4. Confirm `/` returns one redirect to `/uk` and does not loop.
5. Inspect raw HTML for canonical, reciprocal alternates, one H1, indexable robots metadata, and visible localized body copy.
6. Verify `https://sales-aito.com` in Google Search Console and Bing Webmaster Tools.
7. Submit `https://sales-aito.com/sitemap.xml` to both services.
8. Inspect `/uk`, `/en`, `/uk/integrations`, `/uk/pricing`, and the first article URL.

IndexNow is intentionally deferred until a secure deployment-owned key and publication hook are approved. Sitemap submission remains the discovery mechanism for the first release.

No ranking outcome is guaranteed. Search readiness means the site is crawlable, internally linked, technically consistent, and useful to visitors.

## 2026-10-22 production preflight

- All 20 sitemap URLs returned HTTP 200 with one server-rendered H1, a self-referencing canonical URL, and Ukrainian/English alternates. `/` redirected once to `/uk`; the hero image, robots file, and sitemap returned HTTP 200. The login page emitted `noindex`.
- `www.sales-aito.com` did not resolve in DNS. The canonical apex host worked, but checklist step 2 remains open; adding a DNS record and permanent redirect is a separate live Cloudflare change requiring approval.
- The available Google Search Console account reported no access to `https://sales-aito.com/`; Bing Webmaster Tools was not signed in. Property verification, sitemap submission, and URL inspection remain open. Do not infer search indexing from the public HTTP checks.
- CrUX Vis returned `data not found` for the origin and `/uk` on mobile and desktop. There is no accessible field Core Web Vitals sample yet; retain the laboratory Lighthouse results separately and recheck field data when available.
