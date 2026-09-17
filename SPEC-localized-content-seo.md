# Spec: `localized-content-seo`

## Objective

Deliver useful Ukrainian and English marketing pages that search engines can crawl, render, understand, and index. The module must target real user questions, provide honest current-versus-roadmap product information, and create a reusable foundation for additional languages and editorial content.

Search readiness is a release criterion, but ranking is not promised. Success means the site supplies technically correct, useful, accessible content and observable indexing signals to Google and other search services.

## Tech Stack

- `marketing-foundation`
- Next.js 16 Metadata API, `robots.ts`, `sitemap.ts`, and generated Open Graph images
- TypeScript content schemas and repository-owned content
- MDX only if it can be introduced without an unnecessary runtime CMS; otherwise typed React/content modules for the first articles
- JSON-LD rendered in server HTML and escaped safely
- Google Search Console, Bing Webmaster Tools, and optional IndexNow submission during release operations

Primary implementation references:

- Google multilingual guidance: `https://developers.google.com/search/docs/advanced/crawling/managing-multi-regional-sites`
- Google canonical guidance: `https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls`
- Google sitemap guidance: `https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap`
- Google JavaScript SEO: `https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics`
- Next.js metadata: `https://nextjs.org/docs/app/getting-started/metadata-and-og-images`
- IndexNow protocol: `https://www.indexnow.org/documentation`

## Commands

```powershell
pnpm --filter @autosale/web test
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
pnpm test:e2e
git diff --check
```

Production-response inspection after deployment:

```powershell
curl.exe -I https://sales-aito.com/uk
curl.exe -s https://sales-aito.com/uk
curl.exe -s https://sales-aito.com/sitemap.xml
curl.exe -s https://sales-aito.com/robots.txt
```

## Project Structure

```text
apps/web/app/(marketing)/[locale]/
  page.tsx
  platform/page.tsx
  features/ai-sales-operator/page.tsx
  integrations/page.tsx
  solutions/page.tsx
  about/page.tsx
  blog/page.tsx
  blog/[slug]/page.tsx

apps/web/app/
  robots.ts
  sitemap.ts
  opengraph-image.tsx

apps/web/src/marketing/
  content/
    uk/
    en/
    integration-registry.ts
    article-registry.ts
  seo/
    metadata.ts
    alternates.ts
    json-ld.ts
    indexability.ts
  components/
    hero.tsx
    order-lifecycle.tsx
    aito-workflow.tsx
    integration-status-grid.tsx
    use-case-grid.tsx
    faq.tsx
    breadcrumbs.tsx
```

## Code Style

Content has stable ids and explicit locale coverage. Indexability is data, not an ad hoc page decision.

```ts
type IntegrationStatus = 'available' | 'in-development' | 'roadmap';

export type IntegrationContent = {
  id: string;
  status: IntegrationStatus;
  lastReviewedAt: string;
  name: Record<'uk' | 'en', string>;
  summary: Record<'uk' | 'en', string>;
};
```

- Every indexable route has one primary intent, one H1, unique title, description, canonical, and localized alternates.
- Canonicals are absolute HTTPS URLs and point to the same-language page.
- `hreflang` relationships are reciprocal for translations that actually exist.
- Structured data mirrors visible content and never adds unsupported ratings, prices, availability, or claims.
- Body translations must be substantive; translating only navigation does not create an indexable alternate.

## Testing Strategy

- Schema tests reject missing core translations, duplicate slugs, duplicate primary intents, invalid statuses, missing review dates, and malformed metadata.
- Route tests inspect initial server HTML for title, description, H1, canonical, `hreflang`, robots, crawlable internal links, JSON-LD, and visible localized content.
- Sitemap tests ensure only canonical, published, indexable, absolute HTTPS URLs are included and all alternates are valid.
- Robots tests ensure public assets/pages are crawlable while workspace and account routes are no-index and absent from the sitemap.
- JSON-LD tests parse every emitted block and validate required fields against the chosen schema type.
- E2E tests verify language switching, breadcrumbs, internal links, 404 behavior, and no client-side dependency for core content.
- Release validation uses Google Rich Results Test where applicable and Google Search Console URL Inspection on representative Ukrainian and English pages.

## Boundaries

- **Always:** server-render core content; use separate locale URLs; expose direct internal links; use self-referencing canonicals; keep sitemap/canonical/internal links consistent; label integration status visibly in text; update `lastReviewedAt` when availability claims change.
- **Ask first:** add an indexable page family; create programmatic integration/solution pages at scale; change public slugs; add a CMS; add IndexNow secrets or deployment hooks.
- **Never:** generate thin pages for every keyword; cloak or vary primary content by crawler; use IP-based localization; block canonical public pages in robots; publish fake testimonials, ratings, customer counts, or unavailable features; rely on JavaScript to insert essential canonical or body content after load.

## Success Criteria

1. Ukrainian and English home, platform, AI capability, integrations, solutions, about, and blog-index routes return 200 with meaningful server HTML.
2. Every published page has unique localized metadata, self-canonical, valid reciprocal alternates, one H1, crawlable contextual links, and an explicit indexability decision.
3. `sitemap.xml` lists absolute canonical public URLs and localized alternates and excludes auth, workspace, admin, preview, and unpublished routes.
4. `robots.txt` references the sitemap and does not accidentally block public CSS, JavaScript, images, or canonical marketing pages.
5. Authenticated and account-management routes emit `noindex` and remain protected independently of robots rules.
6. Organization, SoftwareApplication, FAQ, Breadcrumb, and Article structured data are emitted only on pages with matching visible content and pass parser tests.
7. Integration pages and sections distinguish `available`, `in-development`, and `roadmap` in visible text and metadata.
8. The Ukrainian and English home pages are verified in Search Console after deployment; the sitemap is submitted to Google and Bing.
9. IndexNow support is either enabled for published-content changes or documented as intentionally deferred with sitemap submission retained for other search services.
10. There are no orphan indexable pages, broken internal links, conflicting canonicals, mixed-language core content, or accidental staging URLs.

## Open Questions

None for the first release. Keyword clusters and article priorities must be refreshed from current search evidence before final production copy is accepted.

