# Spec: `marketing-foundation`

## Objective

Create the public, bilingual Sales AITO shell and Autonomous Command design foundation inside the existing Next.js application. A visitor opening `https://sales-aito.com/` must reach an indexable Ukrainian or English marketing page, switch languages, start registration, sign in, or request a demo without disrupting the existing authenticated workspace.

Primary users are prospective tenant owners and managers. Success means the public and authenticated parts share one brand while retaining separate navigation, indexing, and access boundaries.

## Tech Stack

- Next.js 16.3 App Router
- React 19.2
- TypeScript 5.9
- Existing vanilla CSS approach, split into focused marketing token, foundation, and component styles
- Next.js Server Components and Metadata APIs
- No new UI or animation dependency in this module

## Commands

```powershell
pnpm --filter @autosale/web test
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
pnpm test:e2e
git diff --check
```

Local full stack:

```powershell
docker compose up --build
```

## Project Structure

```text
apps/web/app/
  (public-root)/
    layout.tsx                 # root locale selection boundary
    page.tsx                   # safe redirect to /uk or /en
  (marketing)/
    [locale]/
      layout.tsx               # localized root HTML and marketing shell
      page.tsx                 # localized home route
  (application)/               # existing auth/workspace pages, URLs unchanged
    layout.tsx
  globals.css                  # application-global compatibility only
  styles/marketing/
    tokens.css
    foundation.css
    utilities.css

apps/web/src/marketing/
  components/
    marketing-header.tsx
    marketing-footer.tsx
    locale-switcher.tsx
  content/
    locales.ts
  routing/
    locale-paths.ts
```

Route groups may reorganize files but must not change the URLs of `/login`, `/register`, existing workspace routes, API paths, webhook paths, or health endpoints. If multiple root layouts are used to produce a correct `<html lang>` per locale, navigation between marketing and workspace may perform a full document load.

## Code Style

Use explicit types, server components by default, and semantic variants instead of raw colors in JSX.

```tsx
type MarketingCtaProps = {
  href: string;
  label: string;
  tone?: 'primary' | 'secondary';
};

export function MarketingCta({ href, label, tone = 'primary' }: MarketingCtaProps) {
  return <Link className={`marketing-cta marketing-cta--${tone}`} href={href}>{label}</Link>;
}
```

- Components use kebab-case filenames and PascalCase exports.
- CSS uses semantic custom properties such as `--marketing-action`, not component-local raw hex values.
- Essential navigation uses real links with descriptive accessible names.
- Client components are limited to controls that require browser state.

## Testing Strategy

- Unit tests validate supported locale parsing and equivalent-path generation.
- Component tests cover desktop/mobile header, footer, locale switcher, CTA destinations, focus states, and accessible names.
- Route tests verify `/` locale behavior, `/uk`, `/en`, invalid locales, and preserved auth/workspace URLs.
- E2E tests navigate from marketing to registration, sign-in, and an authenticated workspace.
- Browser checks cover 375, 768, 1024, 1440, and 1920 pixel widths, keyboard navigation, 200% zoom, reduced motion, and no horizontal overflow.

## Boundaries

- **Always:** render essential content and navigation in server HTML; provide a correct `lang`; use semantic landmarks; preserve visible focus; preserve current auth/session behavior; keep at least 44px touch targets.
- **Ask first:** add a UI/i18n/animation dependency; change existing route URLs; change authentication redirects; replace the authenticated workspace design system.
- **Never:** hide core content behind client-only rendering; infer locale from IP; remove direct links to either locale; expose private workspace content in public caches; use roadmap integrations as visual proof of current availability.

## Success Criteria

1. `https://sales-aito.com/` resolves to the public Sales AITO experience, defaulting to Ukrainian for a crawler or visitor without a preference.
2. `/uk` and `/en` return meaningful server-rendered HTML with the correct document language.
3. The locale switcher uses crawlable links and preserves the equivalent page where available.
4. Header CTAs link to `/register`, `/login`, and the localized demo page.
5. Existing login, registration, conversation, order, catalogue, team, settings, admin, legal, API, health, and webhook routes retain their behavior.
6. Marketing navigation is usable with keyboard, screen reader, touch, reduced motion, and 200% zoom.
7. Autonomous Command tokens support both dark product-story sections and light long-form reading sections without contrast failures.
8. The web test, typecheck, build, E2E smoke suite, and `git diff --check` pass.

## Open Questions

None. Any new locale or route-family decision updates this spec before implementation.

