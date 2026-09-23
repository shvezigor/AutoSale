# Sales AITO feature map

This is the routing index for product functionality. It is intentionally compact: read this file first, then open only the documents and code areas relevant to the task. Detailed design stays in the linked canonical documents instead of being duplicated here or reconstructed from chat history.

## Status vocabulary

- **Available** — implemented and covered by automated tests; production availability may still depend on credentials or a feature flag.
- **Validation pending** — implemented, but a live provider/account acceptance step remains.
- **Planned** — product direction or marketing promise; no production implementation should be assumed.
- **In progress** — implementation exists in a feature branch, but the full capability and rollout checks are incomplete.

## Capability catalogue

| Capability | Status | Canonical knowledge | Main implementation and verification |
|---|---|---|---|
| Cross-cutting workspace UI | Available | [`UI design system`](../frontend/design-system.md) | `apps/web/app/globals.css`, `apps/web/src/components/loading-button.tsx`, `apps/web/src/components/button-style-contract.spec.ts` |
| Consistent field validation UX across forms | In progress | [`field validation UX`](../superpowers/specs/2026-09-21-field-validation-ux-design.md) | Shared `FormField`, localized constraint helpers and safe API issues are implemented; auth, profile, team, catalogue, order, payment, carrier-credential, all sender-profile and shipment-draft forms are migrated. Remaining integration and demo forms plus browser acceptance remain. |
| Public marketing site, Ukrainian/English SEO, pricing and demo leads | Available | [`marketing design`](../superpowers/specs/2026-09-17-sales-aito-marketing-site-design.md), [`marketing acceptance`](../acceptance/marketing-site-checklist.md), [`search indexing`](../operations/search-indexing.md), [`monetization`](../product/2026-09-17-sales-aito-monetization.md) | `apps/web/app/[locale]`, `apps/web/app/sitemap.ts`, `apps/api/src/demo-leads`, `tests/e2e/marketing-site.spec.ts` |
| Registration, sessions, Google Sign-In, roles, teams and profile | Available | [`authentication`](../operations/authentication.md), [`auth design`](../superpowers/specs/2026-08-27-self-hosted-auth-design.md), [`Google Sign-In`](../integrations/google-sign-in.md) | `apps/api/src/auth`, `apps/api/src/team`, `apps/web/app/(auth)`, `apps/web/app/(workspace)/profile`, `tests/e2e/auth.spec.ts` |
| Meta Instagram OAuth, webhook ingestion and inbox | Validation pending | [`Instagram system design`](../superpowers/specs/2026-08-26-instagram-order-capture-design.md), [`Meta access`](../integrations/meta-access.md), [`OAuth runbook`](../integrations/meta-instagram-oauth.md), [`MVP acceptance`](../acceptance/mvp-checklist.md) | `apps/api/src/meta`, `apps/api/src/integrations/instagram-*`, `apps/worker/src/instagram`, `apps/web/app/(workspace)/conversations` |
| Manual Instagram replies with durable delivery and reconciliation | Validation pending | [`manual replies design`](../superpowers/specs/2026-09-07-instagram-manual-replies-design.md), [`MVP acceptance`](../acceptance/mvp-checklist.md) | `apps/api/src/conversations`, `apps/worker/src/instagram`, `apps/web/src/components/instagram-reply-composer.tsx` |
| AI order recognition, catalogue-safe matching and optional conversational intent detection | Available | [`Instagram order capture design`](../superpowers/specs/2026-08-26-instagram-order-capture-design.md), [`conversational intent design`](../superpowers/specs/2026-09-18-conversational-order-intent-detection-design.md) | `apps/worker/src/orders`, `packages/contracts/src/orders.ts`, `apps/api/src/orders`, `apps/web/src/components/order-settings-form.tsx` |
| Product catalogue, file import, mapping and Google catalogue sync | Available | [`catalogue design`](../superpowers/specs/2026-08-31-product-catalog-import-design.md), [`AI table analysis`](../superpowers/specs/2026-09-06-ai-table-structure-analysis-design.md) | `apps/api/src/catalogue*`, `apps/worker/src/catalogue`, `packages/database/src/catalogue-import-engine.ts`, `tests/e2e/catalogue-hybrid-analysis.spec.ts` |
| Google Sheets connection and exactly-once order export by readable order number | Available | [`Google OAuth design`](../superpowers/specs/2026-09-02-google-sheets-oauth-connection-design.md), [`setup`](../integrations/google-oauth-setup.md), [`access model`](../integrations/google-sheets-access.md) | `apps/api/src/integrations/google-*`, `apps/api/src/settings/google-sheets-*`, `packages/integrations/src/google-*`, `tests/e2e/google-oauth-sheets.spec.ts` |
| Order review, approval, pre-fulfillment correction and audit | Available | [`order capture design`](../superpowers/specs/2026-08-26-instagram-order-capture-design.md) | `apps/api/src/orders`, `apps/web/app/(workspace)/orders`, `apps/web/src/components/order-review-panel.tsx` |
| Procurement, inventory reservation and Telegram supplier/personal notifications | Available | [`procurement design`](../superpowers/specs/2026-09-10-procurement-and-telegram-notifications-design.md), [`deployment notes`](../operations/deployment.md) | `apps/api/src/orders/procurement.controller.ts`, `apps/api/src/integrations/telegram*`, `apps/worker/src/orders/procurement-backfill.reconciler.ts`, `apps/worker/src/telegram`, `packages/database/src/procurement-store.ts` |
| Delivery adapters: Nova Poshta, Meest and Ukrposhta | Available | [`delivery design`](../superpowers/specs/2026-09-10-delivery-carriers-and-nova-poshta-design.md), [`Ukrposhta research`](../research/ukrposhta-api-integration-research.md) | `apps/api/src/delivery`, `apps/worker/src/delivery`, `packages/integrations/src/{nova-poshta,meest,ukrposhta}*` |
| Order commercial terms, legal entities, bank accounts and audited payment facts | Available | [`commercial terms and bank accounts design`](../superpowers/specs/2026-09-19-order-commercial-terms-and-bank-accounts-design.md), [`payment facts design`](../superpowers/specs/2026-09-20-order-payment-facts-design.md), [`commercial acceptance`](../acceptance/order-commercial-terms-checklist.md), [`payment acceptance`](../acceptance/order-payment-facts-checklist.md) | `packages/database/src/{commercial-terms,order-payments}.ts`, `apps/api/src/commercial-settings`, `apps/api/src/orders/{commercial-terms,payments}*`, `apps/web/src/components/{commercial-settings-hub,order-commercial-terms-card,order-payments-card}.tsx`, `tests/e2e/order-payment-facts.spec.ts`; manual facts are available, while automated reconciliation and refunds remain future work. |
| Operational dashboard and notifications | Available | [`dashboard spec`](../specs/SPEC-operational-dashboard.md), [`notifications design`](../superpowers/specs/2026-09-04-global-notifications-ui-design.md) | `apps/api/src/dashboard`, `apps/api/src/notifications`, `apps/web/app/(workspace)/dashboard`, `tests/e2e/dashboard.spec.ts` |
| Ukrainian/English workspace localization | Available | [`localization design`](../superpowers/specs/2026-09-14-user-profile-localization-table-sorting-design.md) | `apps/web/src/i18n`, locale-aware components and route tests |
| Production hosting and deployment | Planned | [`Hetzner production runbook`](../operations/hetzner-production.md), [`hosting ADR`](../adr/0001-hetzner-single-host-production.md), [`provider analysis`](../research/2026-09-18-hosting-provider-analysis.md) | `compose.yaml`, `.github/workflows/ci-deploy.yml`, `infra/scripts/{deploy,deploy-commit,backup,restore}.sh`; remote host not provisioned yet |
| Facebook, Threads, TikTok and Viber sales channels | Planned | [`omnichannel API research`](../research/omnichannel-order-automation-api-research.md) | No production adapter yet. Extend the provider-neutral conversation/order model; do not copy the Instagram pipeline wholesale. |
| Email services and additional business integrations | Planned | Product backlog and future provider specs | No production implementation yet. |
| Paid subscriptions and billing | Planned | [`monetization hypothesis`](../product/2026-09-17-sales-aito-monetization.md) | Pricing is published; billing/subscription enforcement is not implemented. Trial: one month. Proposed plans: Start 599 UAH, Growth 1999 UAH, Scale 2999 UAH. |

## How to add or change a feature

1. Search this index and the repository for equivalent behavior.
2. Update an existing canonical spec when extending a capability. Create a new focused spec only when the capability or decision is genuinely new.
3. Record scope, non-scope, user flow, data/contracts, invariants, failure handling, telemetry, rollout and tests.
4. Link the spec, code ownership, tests and operational guide from this index.
5. Keep status evidence-based. Provider credentials, app review or a live acceptance gap means **Validation pending**, even when code is complete.
6. Update README when the project-level architecture, setup, commands or public capability summary changes.

## Documentation ownership

- `docs/features/README.md` — routing and current status only.
- `docs/superpowers/specs/` — canonical feature behavior and design.
- `docs/superpowers/plans/` — historical implementation sequence; not the source of current behavior.
- `docs/integrations/` — provider setup and access requirements.
- `docs/operations/` — deployment, backup, observability and recovery.
- `docs/acceptance/` — verified evidence and remaining live checks.
- `docs/research/` — time-sensitive external research; verify sources before implementation.
- ADR directory, when introduced — expensive-to-reverse architectural decisions and their rationale.
