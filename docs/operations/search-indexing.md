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

## 2026-10-22 later index and field-metric check

- Google Search Console URL Inspection now reports `/uk/integrations` and `/uk/pricing` as indexed and eligible to appear in Search. The integrations detail reports a successful smartphone Googlebot crawl on 2026-10-22 at 14:42:54, with crawling and indexing allowed and the declared canonical URL selected. The article `/uk/blog/how-to-automate-instagram-orders` remains unknown to Google's index, without a recorded crawl. Do not resubmit it merely because this status is pending.
- Bing's stored Index results remain non-indexed for `/en`, `/uk/integrations`, `/uk/pricing`, and the article. `/en` and `/uk/pricing` are discovered but not crawled; `/uk/integrations` and the article still show older successful fetches with `Indexing allowed? No`. The article's stored crawl was at 15:00, before the 15:14 passing live test of the updated page. These stored results do not contradict the later live indexability checks or establish that the current HTML blocks indexing. No duplicate indexing request was sent.
- Search Console's Core Web Vitals report still says there is insufficient usage data over the preceding 90 days for both mobile and desktop. Field LCP, INP and CLS remain unmeasured; the production performance gate is open. Recheck when usage data appears rather than presenting the existing Lighthouse laboratory readings as field results.

## 2026-10-23 indexing and laboratory-performance follow-up

- Google Search Console still reports `/uk/blog/how-to-automate-instagram-orders` as an unknown URL with no recorded crawl. Bing's stored index inspection still shows `/en` and `/uk/pricing` discovered but not crawled; `/uk/integrations` and the article still show older successful fetches with `Indexing allowed? No`. These statuses are not a fresh live-page denial. No duplicate indexing requests or sitemap submissions were made.
- Search Console still has insufficient 90-day usage data for mobile and desktop Core Web Vitals. A separate [PageSpeed Insights report](https://pagespeed.web.dev/analysis/https-sales-aito-com/uyw8otytj3?form_factor=mobile) with Lighthouse 13.5.0 for `https://sales-aito.com/` redirected to `/uk` at 11:11 Kyiv on 23 October. Its first-load, simulated slow-4G **mobile laboratory** result was performance 95/100, FCP 1.1 s, LCP 2.7 s, total blocking time 60 ms, CLS 0 and Speed Index 3.8 s. The **desktop laboratory** result was 100/100, FCP 0.3 s, LCP 0.6 s, total blocking time 20 ms, CLS 0 and Speed Index 0.5 s. Both reported no real-user data. These single synthetic runs are not a field distribution, do not prove an improvement over an equivalent baseline, and do not close the production Core Web Vitals gate. Mobile LCP exceeds the 2.5 s good threshold in this run; repeat under comparable conditions and inspect its attribution before changing assets or CSS.

Follow-up on 23 October: a fresh [redirected-root mobile run](https://pagespeed.web.dev/analysis/https-sales-aito-com/04cuxqsrzl?form_factor=mobile) reported performance 92, FCP 1.1 s, LCP 2.2 s, TBT 310 ms and CLS 0. A separate direct [`/uk` mobile run](https://pagespeed.web.dev/analysis/https-sales-aito-com-uk/20yg6kcfg5?form_factor=mobile) reported performance 95, FCP 1.1 s, LCP 2.7 s, TBT 40 ms and CLS 0. Reopening the first report with a new report URL repeated its earlier numbers, so it is not counted as an independent sample. All are Lighthouse first-load simulated slow-4G tests, and PageSpeed still says there are no real-user data. In the two inspected LCP breakdowns, the LCP element was the hero `<img>` and 0.97–1.98 s was attributed to element render delay. The image appears in initial HTML with a preload and without `loading="lazy"`; public HTML inspection found no `fetchpriority="high"` hint, matching the earlier reverted experiment. The reports also flagged a render-blocking first-party CSS chunk of about 30 KiB (estimated 380–560 ms savings) and about 29 KiB of unused CSS. Repository inspection found that the root layout imports the 194 KiB source `globals.css` for both public and workspace routes. Route-scoped CSS is a candidate to test, **not** an established cause or proven fix. The previous 22 October hero-priority change was reverted after equivalent production laboratory runs failed to improve LCP; no new optimization or deployment was made here. Retain the field Core Web Vitals gate until enough real-user data exist, then test one scoped change against repeated like-for-like runs and browser regressions.

## 2026-10-23 later index and field-data check

- Google Search Console URL Inspection now reports `/uk/blog/how-to-automate-instagram-orders` as indexed and eligible to appear in Search. Its recorded smartphone Googlebot crawl was on 23 October at 23:33 Kyiv time: page fetch succeeded, crawling and indexing were allowed, and Google selected the declared canonical URL. This closes the article's Google indexing recheck, not a ranking or traffic outcome.
- Bing Webmaster Tools' stored Index result now reports the same article as `Indexed successfully`. It still flags `Title too long` from a recorded crawl at 15:00 on 22 October, before the 15:14 live test passed after the title fix. Treat that SEO issue as a stale stored finding until Bing recrawls; do not undo the accessible editorial H1 or resubmit the unchanged article.
- Bing still reports `/en` and `/uk/pricing` as discovered but not crawled. `/uk/integrations` still shows a stored 17 October crawl with `Indexing allowed? No`; a fresh Live URL test at 23:38 on 23 October found that the current page can be indexed by Bing and reported no SEO/GEO issues. The live test does not replace Bing's stored index status. These three indexing gates remain open. No repeat indexing request or sitemap submission was made.
- Search Console's overview still shows no mobile or desktop Core Web Vitals data. Field LCP, INP and CLS remain unavailable; the laboratory runs above are not substitutes. No performance code or deployment changed in this check.
