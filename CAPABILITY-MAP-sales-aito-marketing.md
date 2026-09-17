# Capability Map: Sales AITO Public Website

Date: 2026-09-17
Status: approved

| Module id | Responsibility | Depends on |
|---|---|---|
| `marketing-foundation` | Public shell, Autonomous Command design tokens, header/footer, `/uk` and `/en`, locale switching, and safe links to sign-in and registration | — |
| `localized-content-seo` | Home, Platform, AI Features, Integrations, Solutions, About, localized metadata, structured data, sitemap, robots, and blog foundation | `marketing-foundation` |
| `demo-leads` | Demo form, server validation, PostgreSQL persistence, rate limiting, email notification, and retryable delivery | `marketing-foundation` |
| `pricing-conversion` | 30-day trial, 599/1,999/2,999 UAH plans, comparison UI, conversion CTAs, and purchase-intent analytics | `localized-content-seo` |
| `release-validation` | Browser QA, accessibility, Core Web Vitals, SEO audit, and public-site-to-authenticated-workspace verification | `marketing-foundation`, `localized-content-seo`, `demo-leads`, `pricing-conversion` |

Build order:

```text
marketing-foundation
  -> localized-content-seo + demo-leads
  -> pricing-conversion
  -> release-validation
```

Recurring payments, subscription enforcement, invoices, taxes, refunds, dunning, and overage billing are tracked separately in the shared backlog and are not part of this initiative.

