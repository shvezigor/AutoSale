# Spec: `release-validation`

## Objective

Prove that the complete Sales AITO marketing initiative is deployable, crawlable, accessible, responsive, and connected safely to the existing authentication and workspace. This module produces release evidence; it does not add unrelated product functionality.

## Tech Stack

- Playwright 1.62
- Vitest and Testing Library
- Next.js production build
- Docker Compose and Caddy
- Browser DevTools accessibility, network, console, and performance inspection
- Google Rich Results Test and Search Console URL Inspection
- Bing Webmaster Tools sitemap submission
- IndexNow verification when enabled

## Commands

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
docker compose build
docker compose config
git diff --check
```

Production endpoint checks:

```powershell
curl.exe -I https://sales-aito.com/
curl.exe -I https://sales-aito.com/uk
curl.exe -I https://sales-aito.com/en
curl.exe -s https://sales-aito.com/robots.txt
curl.exe -s https://sales-aito.com/sitemap.xml
```

## Project Structure

```text
tests/e2e/marketing-site.spec.ts
tests/e2e/marketing-seo.spec.ts
tests/e2e/demo-lead.spec.ts
tests/e2e/marketing-auth-handoff.spec.ts
docs/acceptance/marketing-site-checklist.md
docs/operations/search-indexing.md
docs/operations/marketing-release.md
```

## Code Style

Assertions describe observable user or crawler outcomes and avoid brittle class selectors.

```ts
await page.goto('/uk');
await expect(page.getByRole('heading', { level: 1 })).toContainText('Продажі');
await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
  'href',
  'https://sales-aito.com/uk',
);
```

- Prefer roles, labels, headings, and stable public URLs.
- Mask dynamic timestamps and generated ids in screenshots.
- Record deviations in the acceptance checklist rather than weakening assertions silently.

## Testing Strategy

### Automated release suite

- Run repository tests, typecheck, production build, Playwright, Compose build, and diff checks.
- Crawl the built site from the sitemap and assert 200 status, canonical consistency, one H1, language, metadata, and no broken internal links.
- Verify `/uk`, `/en`, pricing, demo, legal, 404, login, registration, and representative workspace routes.
- Verify no private or account route is present in sitemap or cacheable as public content.

### Browser and accessibility validation

- Test 375, 768, 1024, 1440, and 1920 pixel viewports.
- Complete keyboard-only navigation and form submission.
- Inspect accessibility tree, focus order, labels, contrast, 200% zoom, reduced motion, long translations, loading, empty, and error states.
- Inspect console and network for errors, redirect loops, hydration mismatch, failed assets, and mixed content.

### Search validation

- Inspect raw response HTML, not only the hydrated DOM.
- Validate canonical and reciprocal alternates on representative route pairs.
- Validate sitemap and robots from production.
- Validate supported JSON-LD with Rich Results Test.
- Verify the domain in Search Console and Bing Webmaster Tools, submit the sitemap, and inspect `/uk`, `/en`, one integration page, pricing, and one article.
- If IndexNow is enabled, verify ownership key resolution and a test URL submission response; otherwise record the approved deferral.

### Performance validation

- Use production builds and realistic mobile throttling.
- Target p75 LCP below 2.5 seconds, INP below 200 milliseconds, and CLS below 0.1 for key marketing pages.
- Record image weight, font loading, total client JavaScript, and third-party scripts.

## Boundaries

- **Always:** test production output; capture command results and URLs; investigate failures before changing thresholds; preserve privacy in screenshots/logs; use representative slow and error conditions.
- **Ask first:** change Caddy production host rules; submit external verification tokens; enable analytics or IndexNow in production; relax performance or accessibility acceptance targets.
- **Never:** declare ranking guaranteed; mark a route indexable without inspecting server HTML; disable failing tests to ship; expose credentials in evidence; test destructive production mutations against real customer data.

## Success Criteria

1. `https://sales-aito.com/` resolves without a loop to a public localized page over HTTPS.
2. Ukrainian and English pages, assets, sitemap, robots, legal pages, login, registration, API, health, and webhook boundaries return expected statuses.
3. A visitor can navigate home → pricing → registration and home → demo, and a registered user can sign in to the protected workspace.
4. No protected page, personal data, or session-specific HTML is present in the public cache, sitemap, or search metadata.
5. Automated sitemap crawling finds no broken internal links, conflicting canonicals, invalid alternates, duplicate primary headings, or accidental no-index on public pages.
6. Google Rich Results tests pass for supported visible schema, and representative URLs are inspectable in Search Console.
7. The sitemap is submitted to Google and Bing; IndexNow is verified or explicitly deferred.
8. Keyboard, screen reader, contrast, reduced motion, zoom, and responsive checks pass on all primary page templates.
9. Key pages meet the stated Core Web Vitals targets in the release environment or have a documented blocker approved before launch.
10. Full tests, typecheck, production build, E2E, Compose build/config, and diff checks pass with no relevant console or network errors.

## Open Questions

None. Search-engine verification accounts and production deployment access are external launch prerequisites, not product requirement ambiguity.

