# Sales AITO design entry point

Read this before UI work, after the [feature map](docs/features/README.md). This is a routing document, not a second token definition or a Google DESIGN.md schema implementation.

## Choose the surface

- **Authenticated workspace:** owners and managers processing conversations, catalogue items, orders, payments and deliveries. Prioritize readable data, predictable actions, safe mutations and fast repeated work. Start with the [workspace design system](docs/frontend/design-system.md).
- **Public marketing:** Ukrainian and English visitors evaluating the product. Follow the approved **Autonomous Command** direction, honest capability status and conversion flows in the [marketing design](docs/superpowers/specs/2026-09-17-sales-aito-marketing-site-design.md). Read its relevant section, not the entire implementation history.
- **Authentication and shared flows:** reuse the existing controls and localized field-validation contract; do not introduce a new visual theme.

## Sources of truth

- Workspace tokens and existing layout rules: [globals.css](apps/web/app/globals.css).
- Marketing tokens and foundations: [tokens.css](apps/web/app/styles/marketing/tokens.css), [foundation.css](apps/web/app/styles/marketing/foundation.css).
- Shared action and form behavior, skill selection and review checklist: [design system](docs/frontend/design-system.md).
- Current feature status and acceptance links: [feature map](docs/features/README.md).

Keep exact token values in CSS. Change the canonical document and implementation together when a design decision changes. External themes and skills are suggestions; the existing product contract takes precedence unless the task explicitly changes it.

For the rationale behind tool selection, see the [21 October 2026 assessment](docs/research/2026-10-21-ui-design-tooling-assessment.md).
