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
2. Keep `sales-aito.com` on the Cloudflare Tunnel. Proxy `www.sales-aito.com` through Cloudflare with a redirect-only DNS record and a hostname-scoped 301 to the canonical apex; preserve path and query string. Do not add `www` to the tunnel origin route.
3. Verify the following return HTTPS 200 responses: `/uk`, `/en`, `/uk/pricing`, `/en/pricing`, `/robots.txt`, `/sitemap.xml`, and `/images/sales-aito-ai-operator-hero.png`.
4. Confirm `/` returns one redirect to `/uk` and does not loop.
5. Inspect raw HTML for canonical, reciprocal alternates, one H1, indexable robots metadata, and visible localized body copy.
6. Verify the `sales-aito.com` Domain property in Google Search Console and the site in Bing Webmaster Tools.
7. Submit `https://sales-aito.com/sitemap.xml` to both services.
8. Inspect `/uk`, `/en`, `/uk/integrations`, `/uk/pricing`, and the first article URL.

IndexNow is intentionally deferred until a secure deployment-owned key and publication hook are approved. Sitemap submission remains the discovery mechanism for the first release.

No ranking outcome is guaranteed. Search readiness means the site is crawlable, internally linked, technically consistent, and useful to visitors.

## 2026-10-22 production preflight

- All 20 sitemap URLs returned HTTP 200 with one server-rendered H1, a self-referencing canonical URL, and Ukrainian/English alternates. `/` redirected once to `/uk`; the hero image, robots file, and sitemap returned HTTP 200. The login page emitted `noindex`.
- `www.sales-aito.com` did not resolve in DNS. The canonical apex host worked, but checklist step 2 remains open; adding a DNS record and permanent redirect is a separate live Cloudflare change requiring approval.
- The available Google Search Console account reported no access to `https://sales-aito.com/`; Bing Webmaster Tools was not signed in. Property verification, sitemap submission, and URL inspection remain open. Do not infer search indexing from the public HTTP checks.
- CrUX Vis returned `data not found` for the origin and `/uk` on mobile and desktop. There is no accessible field Core Web Vitals sample yet; retain the laboratory Lighthouse results separately and recheck field data when available.

## 2026-10-22 canonical-host rollout

- Cloudflare has one active Single Redirect named `www to canonical apex`: match `http.host eq "www.sales-aito.com"`, dynamic target `concat("https://sales-aito.com", http.request.uri.path)`, HTTP 301, preserve query string. A separate proxied `www` A record points at the documentation-only address `192.0.2.1`; Cloudflare handles the redirect before an origin request. The existing apex tunnel CNAME was not changed.
- Public DNS resolved `www` to Cloudflare proxy addresses. Both `http://www.sales-aito.com/uk/pricing?from=qa` and `https://www.sales-aito.com/uk/pricing?from=qa` returned one 301 to `https://sales-aito.com/uk/pricing?from=qa`. The apex `/health/live` stayed HTTP 200. Chrome followed the redirect and rendered the pricing page at the canonical URL.
- A fresh local backup `backups/20261022T111348Z` passed checksums for the PostgreSQL dump, MinIO archive and configuration; the PostgreSQL dump and MinIO archive listings were readable. The backup remains local and must not be committed or uploaded.
- Rollback, if needed: remove or disable only this redirect rule and remove only the `www` A record after verifying their exact identities. Leave the apex tunnel record untouched. This would make `www` unavailable again; restore it only after deciding on a replacement route.

## 2026-10-22 Google Search Console verification

- With owner approval, verified the `sales-aito.com` Domain property through a manually added apex DNS TXT record in Cloudflare. The record is DNS-only and must remain in place to retain verification; its value is intentionally absent from this repository. Google was not given access to the Cloudflare account. The existing apex tunnel and `www` redirect records were unchanged.
- Submitted `https://sales-aito.com/sitemap.xml` in that property. Search Console ultimately showed type `Sitemap`, status `Успішно`, last read 2026-10-22, and 20 discovered pages. An initial transient `Не вдалось отримати` status cleared after Google processed the file. Independently, the public endpoint returned HTTP 200 and a parseable XML `urlset` with 20 URLs.
- Successful sitemap processing proves discovery, **not** that any page has been indexed or receives search traffic. URL inspection for the key pages in checklist step 8, Bing verification/submission, and field Core Web Vitals remain open. This was an external DNS/Search Console change only; no application containers were rebuilt or restarted. Do not delete the verification TXT except as an intentional owner-access revocation.

## 2026-10-22 URL inspection follow-up

- Search Console inspection of the checklist's five URLs showed `/uk` and `/en` indexed. For `/uk`, the last recorded smartphone-Googlebot crawl was 2026-10-17, with successful retrieval, indexing allowed, and Google choosing the declared canonical URL.
- `/uk/integrations` and `/uk/blog/how-to-automate-instagram-orders` were unknown to Google's index; `/uk/pricing` was discovered via the sitemap but not yet indexed. A live Search Console test found all three publicly accessible and eligible for indexing. Submitted each once to Google's priority crawl queue; Search Console confirmed each request. Queue acceptance is **not** indexing, and repeated requests do not improve priority. Recheck their indexed status later without resubmitting unless the pages materially change.
- The Search Console Core Web Vitals report had insufficient usage data for both mobile and desktop over the preceding 90 days. Do not substitute Lighthouse laboratory results for field LCP/INP/CLS or claim the performance gate is closed.
- Bing Webmaster Tools was accessible through the existing signed-in account. `sales-aito.com` was initially added manually as an unverified site; the subsequent verification and submission are recorded below. Google Search Console permissions were not imported.

## 2026-10-22 Bing verification and sitemap submission

- With owner approval, added a dedicated DNS-only CNAME in Cloudflare for Bing Webmaster Tools. Public DNS resolved the verification hostname to Bing's target. The Bing User management screen then reported `You are a verified administrator` and `Verified by: DNS`. The verification hostname/value are intentionally omitted from this repository; retain the CNAME while this ownership method is required. Existing apex tunnel, `www` redirect record and Google verification TXT were unchanged. Bing was not granted Google Search Console access.
- Submitted `https://sales-aito.com/sitemap.xml` once. Bing confirmed successful submission for processing. Its sitemap list showed one known sitemap, zero sitemap errors or warnings, status `Processing`, and zero URLs discovered at the time of verification. Submission and verified ownership do **not** establish that Bing has crawled or indexed any page. Recheck sitemap processing and URL discovery before closing that gate; do not resubmit merely because processing is pending.
- The public sitemap endpoint and `/health/live` returned HTTP 200 after the DNS change. This was an external DNS/Bing account change only; no application image, container or database migration was deployed. To revoke this verification method, identify and remove only the dedicated Bing CNAME after confirming the desired owner-access consequence; preserve all other DNS records.

## 2026-10-22 Bing sitemap and URL inspection follow-up

- Bing processed `https://sales-aito.com/sitemap.xml` successfully: one known sitemap, zero errors or warnings, 20 discovered URLs, and a successful last crawl on 2026-10-22. Discovery still does not establish indexing.
- Bing Index inspection marked `/uk` indexed successfully. `/en` and `/uk/pricing` were discovered but not crawled. `/uk/integrations` and `/uk/blog/how-to-automate-instagram-orders` had a stored `Indexing allowed? No` result, while their current public HTML returned HTTP 200 with `robots: index, follow`, a self-canonical URL and no `X-Robots-Tag` denial. Bing's **Live URL** tests found these pages indexable. The stored index status can lag the live page; do not infer that the current site blocks Bingbot from the old record alone.
- Submitted one Bing indexing request each for `/en`, `/uk/integrations`, and `/uk/pricing` after their live tests; Bing confirmed each submission. The article's first live test found a browser title too long. Web-only release `c48e3df` shortened localized metadata titles while preserving the full editorial H1; the production browser showed 50/52-character Ukrainian/English titles, and Bing's refreshed live test reported `URL can be indexed by Bing` with `No SEO/GEO issues found`. Bing then accepted one indexing request for the article. None of these requests proves later indexing; recheck stored status without duplicate submissions. Bing's missing-alt notice on the home hero is not a reason to replace its intentional decorative `alt=""`: the adjacent visible copy supplies the meaning and an empty alt prevents redundant screen-reader output.
