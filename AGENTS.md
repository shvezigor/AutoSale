# Sales AITO repository instructions

Before planning, implementing, debugging, or documenting product behavior, use the project skill at `.codex/skills/feature-knowledge/SKILL.md`.

Start from `docs/features/README.md`. Load only the documentation and source entry points for the capability being changed. Search for an existing contract, service, adapter, queue, database model, UI flow, and tests before introducing another implementation.

Update the canonical feature documentation and feature index in the same change whenever behavior, status, setup, invariants, or ownership changes. Do not rely on chat history as project documentation.

Work in a short-lived `codex/*` branch created from current `master`. Verify and commit scoped increments. Merge into `master`, push it, then delete the merged branch and clean worktree after proving that no unique tracked or untracked work remains.

Never commit `.env`, credentials, OAuth tokens, database dumps, runtime PID/token files, build output, or production personal data. Test fixtures must contain clearly fictional data.

## UI design rule

- Use the shared `primary-button`, `secondary-button`, `danger-button`, `text-button`, or `icon-button` variants. Never introduce browser-default action buttons or the legacy `button-primary`, `button-secondary`, or `secondary` tokens.
- Use `LoadingButton` for async mutations; it defaults to the primary variant, so pass an explicit shared variant for secondary or destructive actions.
- When adding a new variant or contextual exception, update `docs/frontend/design-system.md` and the button contract test in the same change.

## Form validation rule

- User-editable forms must show localized errors next to the invalid field after submit, mark it with `aria-invalid`/`aria-describedby`, focus the first invalid control, preserve entered values, and clear only the edited field's error. Use shared `FormField`, `FieldError`, and `form-validation.ts` helpers.
- Keep permission, conflict, provider outage, and unknown server failures at form level. Never display raw API/Zod messages or credentials.
- Forms without independently invalid inputs may use `data-validation-context="non-field"` only when listed with a reason in `form-validation-contract.spec.ts`. Update the test and `docs/frontend/design-system.md` when adding such an exception.
