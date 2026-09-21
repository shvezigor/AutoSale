# Workspace UI design system

This is the canonical rule for action controls in the AutoSale workspace. New UI work must use the shared variants and must not fall back to browser-default buttons.

## Action variants

- `primary-button` — the main action in a section (create, save, calculate, confirm).
- `secondary-button` — a reversible or supporting action (edit, cancel, retry).
- `danger-button` — destructive actions that need an explicit warning.
- `text-button` and `icon-button` — low-emphasis navigation or compact controls.
- A contextual variant is allowed only when its selector and purpose are documented next to the component.

All variants use the shared height, radius, typography, focus ring, hover and disabled states from `apps/web/app/globals.css`. Do not use `button-primary`, `button-secondary`, `secondary`, or an unstyled native `<button>` for an action.

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
