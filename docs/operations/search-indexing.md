# Sales AITO search indexing

## Canonical public surface

- Production origin: `https://sales-aito.com`
- Default locale: Ukrainian at `/uk`
- English locale: `/en`
- Locale roots and translated pages use self-referencing canonical URLs without a trailing slash.
- Ukrainian, English, and `x-default` alternates are emitted in server HTML.
- Public URLs are listed in `/sitemap.xml`; private workspace, account, and admin routes are excluded.
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
