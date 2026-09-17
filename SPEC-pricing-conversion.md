# Spec: `pricing-conversion`

## Objective

Explain Sales AITO's approved pricing hypothesis clearly in Ukrainian and English, connect each plan to an appropriate registration or demo action, and measure purchase intent without implementing payments or subscription enforcement.

Primary user: a prospective tenant owner comparing whether the product fits the business's current order volume. Business success is validated plan interest and trial activation, not merely pricing-page views.

## Tech Stack

- `localized-content-seo`
- Typed pricing registry in the Next.js application
- Existing registration and sign-in routes
- Privacy-aware first-party analytics events persisted through an existing or minimal local telemetry boundary
- No payment provider in this module

## Commands

```powershell
pnpm --filter @autosale/web test
pnpm --filter @autosale/web typecheck
pnpm --filter @autosale/web build
pnpm test:e2e
git diff --check
```

## Project Structure

```text
apps/web/app/(marketing)/[locale]/pricing/page.tsx
apps/web/src/marketing/content/pricing.ts
apps/web/src/marketing/components/
  pricing-grid.tsx
  pricing-comparison.tsx
  pricing-faq.tsx
  pricing-cta.tsx
apps/web/src/marketing/analytics/conversion-events.ts
```

The public pricing registry is presentation data. It does not grant entitlements and is never used as a server authorization source.

## Code Style

Prices and limits are integers in a typed registry; localized display is derived.

```ts
export const pricingPlans = [
  { id: 'start', monthlyUah: 599, orders: 300, channels: 1, users: 3, products: 2_000 },
  { id: 'growth', monthlyUah: 1_999, orders: 1_500, channels: 3, users: 10, products: 10_000 },
  { id: 'scale', monthlyUah: 2_999, orders: 5_000, channels: 'all-available', users: 25, products: 50_000 },
] as const;
```

- The 30-day trial is described once in shared structured content.
- Annual display derives from the approved 20% discount and explicitly states billing period.
- Available and roadmap capabilities are rendered in separate groups.
- A plan CTA carries a non-authoritative plan-interest parameter to registration or demo; server authorization ignores it.

## Testing Strategy

- Registry tests verify approved prices, limits, unique ids, annual calculation, and locale formatting.
- Component tests verify headings, comparison semantics, roadmap labels, CTA URLs, keyboard behavior, and mobile layout.
- Metadata and structured-data tests ensure visible pricing and software data agree and avoid unsupported offer claims.
- Analytics tests verify a single event per deliberate plan action without contact data or cross-site identifiers.
- E2E covers pricing discovery from home, monthly/annual display, plan selection to registration, Scale/Enterprise demo routing, and both locales.

## Boundaries

- **Always:** show prices in UAH; explain VAT/tax treatment only after accounting approval; show exact volume limits; state that only available channels are included; distinguish plan-interest tracking from a purchase.
- **Ask first:** change price, discount, order limit, user limit, trial start rule, or plan names; add a payment provider; add comparative competitor claims.
- **Never:** claim checkout or subscription activation exists; hide renewal terms; advertise unavailable integrations as included; use dark patterns, preselected paid consent, fake scarcity, or surprise overages; use public pricing config as an entitlement check.

## Success Criteria

1. Trial displays as 30 days, no card required, with activation beginning at first supported channel connection or first completed catalogue import.
2. Monthly plan prices are Start 599 UAH, Growth 1,999 UAH, and Scale 2,999 UAH.
3. Included orders, channels, users, and catalogue products match the approved monetization artifact.
4. Annual display applies a 20% discount with unambiguous total and effective monthly amount.
5. Plan CTAs preserve locale and lead to working registration or demo flows.
6. Pricing copy separates current capabilities from roadmap capabilities.
7. Analytics records pricing view, plan-interest click, registration arrival, trial activation, and demo intent without storing message or customer content.
8. The first validation cohort can calculate registration-to-activation, activation-to-plan-intent, selected tier, and projected direct-cost ratio.
9. Web tests, typecheck, build, E2E, metadata, accessibility, and responsive checks pass.

## Open Questions

Tax display, payment methods, invoicing, and subscription enforcement are explicitly assigned to the shared billing backlog and are not unresolved requirements for this module.

