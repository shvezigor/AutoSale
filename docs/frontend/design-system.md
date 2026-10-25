# Workspace UI design system

This is the canonical workspace UI contract and UI development workflow. New UI work must use the shared variants and must not fall back to browser-default buttons. The root [DESIGN.md](../../DESIGN.md) routes agents here; it does not duplicate tokens.

## Product context and visual ownership

The workspace serves owners and managers repeatedly reviewing conversations, products and orders. Preserve the existing light surfaces, violet action accent, compact navigation and readable operational hierarchy. Exact colors, spacing, radii and typography rules live in [globals.css](../../apps/web/app/globals.css); font loading lives in [layout.tsx](../../apps/web/app/layout.tsx). Reuse the nearest existing component before adding a new abstraction or isolated style.

The public site has its own approved [Autonomous Command design](../superpowers/specs/2026-09-17-sales-aito-marketing-site-design.md), scoped `--m-*` tokens and marketing components. Its expressive graphics do not define the workspace layout. Public capability claims must follow the feature index. Check Ukrainian text and glyph rendering as well as English wherever both locales are supported.

Existing token values describe the current implementation; they are not proof that every combination meets accessibility requirements. Measure the actual foreground/background and interaction states affected by a change.

## Workspace navigation loading contract

The persistent sidebar does not prefetch every destination when it enters the viewport. `PrimaryNavigation` disables automatic `Link` prefetch and asks Next.js to prefetch a destination once when the user hovers or keyboard-focuses that link. A click still navigates normally, including on touch devices without hover. The active destination is not prefetched again. Order-list detail links likewise avoid automatic prefetch for every visible row; their click behavior is unchanged. This prevents a full page load from multiplying authenticated server requests across unrelated pages while preserving intent-based preparation for pointer and keyboard navigation. Keep this contract in the component tests when adding sidebar destinations or dense lists.

Workspace route fallbacks use `RouteSkeleton` with a real section heading and a localized, visible description of what is loading. The Orders, Catalogue and Team placeholders resemble a toolbar and rows; Settings, Conversations, order detail and Dashboard use their own structural silhouettes. Placeholder shapes contain no invented values or interactive controls. A 320 ms visual reveal delay avoids flashing a skeleton on fast navigation; after three seconds, the status text honestly says that loading is taking longer, without a fake percentage or speculative cause. The status remains available to assistive technology, while decorative shapes are hidden from it. Respect reduced-motion preferences. A real failure exits the loading boundary to the existing localized error/retry screen; the fallback itself must not invent an error. Keep these contracts in `route-skeleton.spec.tsx` and the affected route-loading tests.

The Dashboard/Orders navigation-timing probe is invisible to ordinary users and does not replace loading feedback. It is enabled only per test tab through `?navTiming=1`, reports a fixed route label and click-to-painted-content duration to that tab's console, and can be cleared with `?navTiming=0`. Its privacy and interpretation limits live in the [observability runbook](../operations/observability.md); performance conclusions require paired browser and proxy evidence, not the probe alone.

## Selecting design assistance

Start with the repository contract. Load one relevant design skill at a time, plus a focused implementation or browser-testing skill when needed; do not combine competing theme generators by default.

| Work | Guidance | Boundary |
|---|---|---|
| Workspace forms, tables, inbox and responsive interactions | `ui-ux-pro-max`, when available, for targeted UX/accessibility guidance | Preserve existing tokens and business workflows; skip palette generation for routine fixes. |
| Public landing page composition or an explicitly requested visual redesign | `design-taste-frontend`, when available | Apply the approved marketing direction; its landing-page guidance is not a dashboard specification. |
| Existing UI quality review | Follow the audit and acceptance sequence below | Aesthetic suggestions require a concrete usability or visual-consistency reason. |
| New motion or a third-party visual component | Evaluate against a named interaction and measured cost | Prefer existing CSS for simple feedback. Assess bundle cost, framework compatibility, licensing and reduced-motion behavior before adoption. |

Skills installed in one developer's environment are optional aids, not repository dependencies. If absent, follow this document and the affected feature's acceptance record. Do not install a new design stack just to perform a review. Never remove a product color or component solely because a generic skill calls it an AI design pattern.

## UI implementation and review sequence

1. **Establish the task.** Name the surface, user, primary action and affected screens. Find its component, CSS, localization, contract and acceptance tests through the feature index. For a material visual change, inspect the current page and capture a baseline using fictional or authorized data.
2. **Audit the affected scope.** Record concrete findings: location, user impact, severity and proposed correction. Review hierarchy, text readability, keyboard interaction, focus, mobile layout and real loading/empty/error/success states. An aesthetic score alone is not evidence.
3. **Implement the smallest coherent correction.** Reuse tokens, shared controls and field validation. Preserve entered data, selection and scroll context where the interaction requires them. Keep essential content in semantic HTML; motion must not be required to read or operate the flow.
4. **Verify behavior and visuals.** Run the relevant automated tests and the browser acceptance matrix below. Check the final result against the baseline and resolve regressions. A passing source contract or screenshot alone is insufficient for changed user behavior.
5. **Record evidence.** Update the affected canonical feature and its acceptance record. State environment, commit, viewport/locale, scenario, result and screenshot location when visuals matter. Record blocked steps explicitly; do not mark a live gate complete from a local fixture.

### Browser acceptance matrix for affected UI

- Check 320, 768, 1024 and 1440 px widths, plus any breakpoint implicated by the change. Text and actions must remain reachable; long product names, amounts and localized errors must wrap or have an intentional accessible overflow treatment. Horizontal scrolling may be local to a data table, not accidental document overflow.
- Operate the complete flow with a keyboard, including opening and closing overlays, visible focus and focus return. Inspect accessible names, labels and errors. Check 200% zoom and touch interactions without relying on hover.
- Exercise applicable loading, empty, validation, permission/provider failure and success states. Verify saved state after reload and the result on downstream screens. Use fictional fixtures for failure injection; do not induce production outages or send customer messages without authorization.
- Check supported locales on the changed surface. For motion changes, test `prefers-reduced-motion`, cleanup on navigation and layout stability. For new assets or dependencies, compare route payload and browser performance with the baseline and record the result.
- Capture the final browser state for material visual changes. Follow the repository's post-deployment acceptance rule in the target environment; blocked credentials or accounts remain explicit gaps.

### Existing verification entry points

| Concern | Existing coverage |
|---|---|
| Shared actions | `apps/web/src/components/button-style-contract.spec.ts` |
| Field validation inventory and behavior | `apps/web/src/components/form-validation-contract.spec.ts`, `tests/e2e/field-validation-accessibility.spec.ts` |
| Inbox scroll ownership | `apps/web/src/components/conversation-viewport-contract.spec.ts`, `tests/e2e/conversation-inbox.spec.ts` |
| Responsive header and orders | `tests/e2e/app-header-responsive.spec.ts`, `tests/e2e/orders-mobile-layout.spec.ts` |
| Public site and demo form | `tests/e2e/marketing-site.spec.ts`, `apps/web/src/marketing/components/demo-form.spec.tsx` |

These are entry points, not a claim that the entire matrix is already automated or verified. Extend the relevant existing test when behavior changes; do not create duplicate acceptance suites solely to mirror this checklist.

## Action variants

- `primary-button` — the main action in a section (create, save, calculate, confirm).
- `secondary-button` — a reversible or supporting action (edit, cancel, retry).
- `danger-button` — destructive actions that need an explicit warning.
- `text-button` and `icon-button` — low-emphasis navigation or compact controls.
- A contextual variant is allowed only when its selector and purpose are documented next to the component.

All variants use the shared height, radius, typography, focus ring, hover and disabled states from `apps/web/app/globals.css`. Do not use `button-primary`, `button-secondary`, `secondary`, or an unstyled native `<button>` for an action.
The global `.icon-button` rule supplies the visual base, hover, focus and disabled states. Conversation triage keeps its menu trigger at least 44 × 44 px through `.conversation-status-control .icon-button` so the row action remains usable on touch screens; existing dialog-specific dimensions remain scoped to those dialogs.

## Async actions

Use `LoadingButton` for mutations and other network actions. It defaults to `primary-button`; pass `className="secondary-button"` or `className="danger-button"` when the action is not primary. Pending state must disable the control and expose its busy state.

## Responsive and accessible behavior

Controls must remain keyboard reachable, show a visible `:focus-visible` ring, and remain usable at the mobile breakpoint. Keep labels meaningful; do not communicate state by color alone. Every new variant or exception requires an update to this document and the button contract test.

The contract is checked by `apps/web/src/components/button-style-contract.spec.ts`.

## Form validation

Use `FormField` and `FieldError` from `apps/web/src/components/form-field.tsx` for user-editable controls. The field owns its stable label, hint, error id, `aria-invalid`, and `aria-describedby` relationship. Shared lifecycle helpers live in `form-validation.ts`.

- Do not show an error before the first submit attempt.
- After an invalid submit, show every known field error and focus the first invalid editable control.
- Clear only the changed field's error while preserving all other errors and entered values.
- Translate browser constraints through the application dictionaries; do not expose browser, provider, Zod, or database prose.
- Keep network, permission, conflict, provider availability, and unknown failures at form level.
- Field messages must wrap without horizontal overflow on mobile and must not rely on color alone.

The repository form contract inventories production TSX forms. Catalogue and order search forms are explicit `data-validation-context="non-field"` exceptions: their free-text queries have no independently invalid value. Google Picker settings are not native form controls; they select real provider files/tabs and report picker or access failures at integration level.
