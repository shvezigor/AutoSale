# Sales AITO Marketing Site Design

Date: 2026-09-17
Status: approved

## 1. Objective

Build a bilingual, search-optimized marketing website for Sales AITO at `https://sales-aito.com/`. The public site explains the product, converts visitors into self-service registrations or demo requests, and establishes a scalable content foundation for future markets and integrations.

The product is positioned as an autonomous AI sales operator for social commerce, not as another generic CRM. Sales AITO is intended to automate the order lifecycle: receive a customer message, conduct a sales conversation, identify products, collect order details, create the order, trigger fulfillment actions, create shipping documents, and contact a supplier when stock is unavailable.

The website must distinguish current product capabilities from planned ones. At launch, Instagram order processing, manager review, the product catalogue, and Google Sheets integration are current capabilities. Facebook, Threads, TikTok, Viber, postal operators, supplier messaging, and further autonomous actions are presented as in development or roadmap items until they are production-ready.

## 2. Audience and Positioning

The primary audience is owners and teams of Ukrainian social-commerce businesses that process roughly 10 or more orders per day. The initial market is Ukraine, while the information architecture, localization model, content system, and brand language must support later geographic expansion.

Primary promise:

> Sales AITO turns customer conversations into completed orders and progressively automates the operational work that follows.

Supporting positioning principles:

- lead with business outcomes rather than model or AI terminology;
- show an end-to-end order workflow rather than a list of disconnected features;
- communicate controlled autonomy, with human review where required;
- label every integration as available, in development, or planned;
- avoid claims that depend on capabilities not yet released;
- present Sales AITO as an operating layer that can expand across channels, delivery services, suppliers, CRM, accounting, and payment systems.

## 3. Conversion Goals

The public website has three primary actions:

1. **Start free** leads to `/register`.
2. **Sign in** leads to `/login` and then to the authenticated workspace.
3. **Book a demo** leads to a short lead form.

The website home page is public at `https://sales-aito.com/`. Authentication is a boundary between the marketing site and the workspace. Public marketing pages, registration, sign-in, and legal pages may be indexed as appropriate. Authenticated workspace routes and user-specific data must never be indexed.

## 4. Chosen Product and Design Approach

The chosen site architecture is **conversion-first platform**. A focused home page sells the core promise, while dedicated pages explain the platform, AI capabilities, integrations, use cases, pricing, and product story. SEO content expands from this foundation instead of launching a large set of thin pages.

The chosen visual direction is **Autonomous Command**:

- dark graphite and deep navy surfaces for AI, automation, and operational-control sections;
- high-contrast off-white reading surfaces for explanations, proof, pricing, and legal content;
- electric lime as the primary action and system-success accent;
- restrained violet illumination for AI and orchestration visuals;
- dense but calm information hierarchy, avoiding generic neon cyberpunk styling;
- interface fragments, workflow diagrams, and abstract system graphics instead of stock photography;
- motion intensity of approximately 3/10, using opacity and transforms and respecting `prefers-reduced-motion`.

The visual system must remain legible for long-form SEO content and pricing comparisons. The marketing identity may be more expressive than the authenticated workspace, but both must share brand name, typography principles, semantic colors, and core controls.

## 5. Homepage Narrative

The approved home-page sequence is:

1. **Header** — brand, platform, capabilities, integrations, pricing, locale switcher, sign-in, and start-free CTA.
2. **Hero** — the promise that sales continue while the team is offline, with start-free and demo actions.
3. **Current proof strip** — Instagram, AI order recognition, manager control, and Google Sheets.
4. **Order lifecycle** — receive the request, conduct the conversation, create the order, and trigger fulfillment.
5. **AITO at work** — show that AI performs controlled business actions rather than only generating text.
6. **Integration status** — clearly separate available, in-development, and roadmap integrations.
7. **Use cases and trust** — explain fit for social shops and growing sales teams, supported by verifiable product evidence.
8. **Pricing preview** — introduce the approved Start, Growth, and Scale plans and 30-day trial.
9. **FAQ** — answer adoption, control, integration, data, and availability questions.
10. **Final CTA** — start free or book a demo.
11. **Footer** — product, resources, company, legal, language, and sign-in links.

The approved starting hypothesis is a 30-day trial, Start at 599 UAH/month, Growth at 1,999 UAH/month, and Scale at 2,999 UAH/month. Exact order, channel, user, and catalogue limits come from `docs/product/2026-09-17-sales-aito-monetization.md`. These are validation prices; changes require updating the monetization artifact and pricing specification before implementation.

## 6. Information Architecture

Initial public page families:

| Page family | Purpose |
|---|---|
| Home | Explain the promise and drive registration or demo conversion |
| Platform | Explain the complete order lifecycle and control model |
| AI capabilities | Explain conversation handling, extraction, order creation, and planned autonomous actions |
| Integrations | Show all integrations with honest availability states |
| Solutions | Address the needs of social shops, small teams, and growing e-commerce operations |
| Pricing | Explain plans, trial, usage boundaries, and upgrade path |
| About | Explain the product vision and trust principles |
| Blog / knowledge base | Capture search demand and educate potential customers |
| Demo | Collect qualified demo requests |
| Legal | Privacy, terms, cookie policy, and data-deletion information |

The first release should create dedicated pages only where unique, useful content exists. Integration and solution templates must not generate thin or duplicate pages.

## 7. Localization and Routes

Ukrainian and English are first-release languages. The implementation must make additional locales additive rather than requiring route or component rewrites.

Marketing routes use explicit locale prefixes:

```text
/uk
/en
/uk/platform
/en/platform
/uk/features/ai-sales-operator
/en/features/ai-sales-operator
/uk/integrations
/en/integrations
/uk/solutions
/en/solutions
/uk/pricing
/en/pricing
/uk/about
/en/about
/uk/blog
/en/blog
/uk/demo
/en/demo
```

The root route `/` selects a locale using a stored preference and then the request language, defaulting to Ukrainian. Search engines receive canonical URLs for concrete locale routes rather than the locale-selection route. The language switcher preserves the equivalent current page where a translation exists and falls back to the target-language home page only when no equivalent exists.

Authentication routes remain stable at `/login` and `/register`. The chosen locale is passed through a safe preference mechanism so the auth experience can render in the visitor's language. Successful sign-in enters the protected workspace; it never returns the user to a marketing page unless explicitly requested.

## 8. Marketing Component Architecture

Recommended organization:

```text
apps/web/app/
  [locale]/
    (marketing)/
      page.tsx
      platform/
      features/
      integrations/
      solutions/
      pricing/
      about/
      blog/
      demo/
  (auth)/
  (workspace)/ or existing protected routes

apps/web/src/marketing/
  components/
    marketing-shell.tsx
    marketing-header.tsx
    marketing-footer.tsx
    locale-switcher.tsx
    hero.tsx
    order-lifecycle.tsx
    aito-workflow.tsx
    integration-status-grid.tsx
    use-case-grid.tsx
    pricing-preview.tsx
    faq.tsx
    demo-form.tsx
  content/
    uk/
    en/
  seo/
  types/
```

Marketing components consume typed content and status records. They do not embed scattered translated strings, pricing limits, or integration availability inside JSX. Page templates provide stable layouts for features, integrations, solutions, and articles without forcing all pages to have identical content structure.

The authenticated application remains functionally independent. Marketing work must not change existing API contracts, tenant boundaries, order processing, role permissions, or integration behavior.

## 9. Content Model

The first release uses repository-owned, type-checked content:

- locale dictionaries for navigation, shared actions, errors, and accessibility labels;
- structured page content for core marketing pages;
- a single integration registry containing slug, availability state, supported actions, last-reviewed date, and localized descriptions;
- a single pricing registry after monetization approval;
- MDX articles with localized metadata, publication state, author, dates, and related-page links;
- centralized SEO metadata helpers.

The content interface must permit a future CMS adapter without changing presentation components. A CMS is not required for the first release.

## 10. Demo Lead Flow

The demo form collects only information required to qualify and contact a lead:

- name;
- company or shop name;
- email or phone;
- approximate order volume;
- optional note;
- locale;
- explicit consent to the privacy policy.

Flow:

```text
Browser form
  -> server-side schema validation
  -> abuse and rate-limit check
  -> tenant-independent DemoLead record in PostgreSQL
  -> notification delivery attempt
  -> success response
```

The database write is the durable acceptance point. A failed notification does not discard the lead; it records a retryable delivery state. Duplicate protection must avoid blocking legitimate repeat contact while limiting automated spam. Validation errors are localized and attached to their fields. Network or server failures preserve entered non-sensitive values in the browser and offer a retry.

No marketing form creates a tenant, changes subscription state, or grants workspace access.

## 11. Search Architecture

Every indexable page requires:

- one clear search intent and one primary H1;
- unique localized title and meta description;
- self-referencing canonical URL;
- reciprocal `hreflang` entries for available translations and `x-default` where appropriate;
- server-rendered meaningful content;
- contextual internal links to related platform, feature, integration, solution, pricing, and article pages;
- Open Graph and social preview metadata;
- inclusion in a generated sitemap only when published and indexable.

Structured data is limited to what the visible page supports:

- `Organization` on the corporate site;
- `SoftwareApplication` or an appropriate software product type on product pages;
- `FAQPage` only for visible FAQ content;
- `BreadcrumbList` on nested pages;
- article schema for published resources.

Workspace, account, reset, invitation, admin, and user-specific routes must send no-index directives and remain absent from sitemaps. `robots.txt` is not used as the only protection for private content; authentication remains mandatory.

Keyword targets and editorial priorities will be based on current Ukrainian and English search evidence before final copy is written. Search terms must not force inaccurate claims about unavailable integrations.

## 12. Performance and Accessibility

The site should meet these implementation constraints:

- prefer server components and static generation for public content;
- keep client JavaScript limited to navigation, locale controls, forms, and purposeful interaction;
- use `next/font` or self-hosted fonts with stable metrics;
- optimize all product imagery and provide explicit dimensions;
- avoid autoplay video and heavy animation frameworks in the first release;
- maintain visible keyboard focus, logical heading order, landmarks, and a skip link;
- provide at least 44-by-44-pixel touch targets for primary controls;
- ensure contrast remains compliant on dark, lime, violet, and muted surfaces;
- never use color alone to express integration or lead status;
- support reduced motion and 200% zoom.

Performance acceptance should target green Core Web Vitals under realistic mobile conditions and no avoidable layout shift from fonts, images, or interactive sections.

## 13. Failure and Empty States

- Missing translations fail during validation or build for core pages rather than silently shipping mixed-language content.
- Missing optional article translations omit the unavailable alternate instead of linking to a false equivalent.
- Invalid integration or pricing configuration fails type and schema validation.
- Demo-form validation is specific, localized, and non-destructive to entered values.
- Demo notification failure is operationally visible and retryable while the saved lead remains successful.
- A missing marketing route uses a branded localized 404 with paths back to the platform, pricing, and home pages.
- Planned integrations display a descriptive status and available alternatives, not dead action buttons.

## 14. Testing Strategy

### Unit and schema tests

- locale completeness and route equivalence;
- integration status registry;
- pricing registry after monetization approval;
- metadata, canonical, and `hreflang` generation;
- demo-lead validation and notification state transitions.

### Component tests

- header, mobile navigation, locale switcher, and footer;
- CTA destinations and accessible names;
- integration state presentation without color-only meaning;
- demo form validation, pending, success, and retry states;
- pricing comparison semantics and responsive behavior.

### End-to-end tests

- public root to Ukrainian or English home;
- locale switching while preserving page intent;
- home to registration;
- home to sign-in and authenticated workspace;
- home to pricing to registration;
- successful and failed demo submission;
- private routes absent from public navigation and indexing outputs;
- mobile navigation and keyboard-only primary flows.

### SEO and visual verification

- metadata, canonical, alternate links, sitemap, robots, and JSON-LD;
- screenshots at 375, 768, 1024, 1440, and 1920 pixels;
- no horizontal overflow except explicitly controlled content;
- Lighthouse and browser console checks;
- reduced-motion, long-content, missing-content, slow-network, and error states.

## 15. Deployment Boundary

The existing Caddy boundary already sends application traffic to the Next.js web service and `/api/*`, `/health/*`, and `/webhooks/*` to the API. Implementation must preserve that boundary while ensuring the production host `sales-aito.com` serves the localized public site at the root and issues HTTPS correctly in the actual deployment environment.

Deployment acceptance includes:

- `https://sales-aito.com/` opens the marketing experience;
- locale selection resolves to an indexable `/uk` or `/en` route;
- sign-in opens the existing auth flow and then the protected workspace;
- registration remains self-service;
- API, webhook, health, legal, and Meta/Google verification paths are not broken;
- no authenticated content is cached as public marketing content.

## 16. Scope Boundaries

Included in this initiative:

- bilingual marketing site and reusable public-page system;
- approved Autonomous Command visual language;
- search and structured-data foundation;
- demo lead capture and admin notification;
- pricing presentation after monetization rules are approved;
- links into existing registration, sign-in, and workspace flows;
- public legal and trust content required by active integrations.

Not included as working product capability merely because it appears in marketing content:

- Facebook, Threads, TikTok, or Viber ingestion;
- autonomous customer replies not already implemented;
- postal-label creation;
- supplier messaging;
- payments, CRM, accounting, or international-market integrations;
- a full CMS;
- product subscription enforcement or billing unless separately designed and approved.

The marketing site may describe the product direction, but unavailable functionality must remain visibly labeled as in development or planned.

## 17. Acceptance Criteria

1. `https://sales-aito.com/` opens the public Sales AITO website, not an authenticated workspace screen.
2. Ukrainian and English versions exist with a persistent locale switcher and extensible locale architecture.
3. Start-free, sign-in, and demo CTAs lead to working destinations.
4. Sign-in enters the protected workspace after successful authentication.
5. Current and planned integrations are visually and semantically distinct.
6. The site communicates the autonomous AI sales-operator vision without claiming unreleased features as available.
7. Demo submissions are durably stored before notification and support retryable delivery.
8. Every indexable page has validated localized metadata, canonical links, alternates, internal links, and appropriate structured data.
9. Private and account routes are excluded from sitemaps and marked no-index.
10. The marketing experience is usable with keyboard navigation, reduced motion, 200% zoom, and mobile screens from 375 pixels wide.
11. Existing authenticated workflows, APIs, roles, integrations, privacy routes, and webhook behavior remain functional.
12. Tests, type checking, production build, SEO checks, and browser verification pass before completion.
