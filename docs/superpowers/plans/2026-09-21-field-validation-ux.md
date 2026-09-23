# Field Validation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every user-editable AutoSale form show localized, accessible errors under the exact invalid fields after the first submit, focus the first invalid control, and reserve form-level alerts for non-field failures.

**Architecture:** Introduce small shared frontend primitives for field presentation and validation lifecycle, then migrate forms in vertical slices. Add an additive safe API issue contract for server-only validation rules; each migrated client maps allowlisted issue codes to local translations while retaining form-level handling for conflicts, provider failures, network errors, and unknown codes.

**Tech Stack:** React 19, Next.js 16, TypeScript 5.9, Vitest, Testing Library, NestJS, Zod contracts, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-21-field-validation-ux-design.md`

## Global Constraints

- No field error is visible before the first submit attempt.
- After the first submit, all known invalid fields show localized text directly below the control and the first invalid control receives focus.
- Editing a field clears only that field's error; validation may run again on blur or the next submit.
- Field errors use `aria-invalid` and `aria-describedby`; color is never the only signal.
- Raw provider responses, Zod issues, Prisma errors, personal values, IBANs, credentials, tokens, and stack traces never reach user-visible copy or telemetry.
- Unknown, network, provider, authorization, rate-limit, conflict, and server errors remain form-level alerts.
- Ukrainian and English message trees stay type-compatible.
- Do not add a form library; use the existing React state and shared project primitives.
- Every production change follows red-green TDD and every task ends with a scoped commit.

---

### Task 1: Shared field presentation and validation lifecycle

**Files:**
- Create: `apps/web/src/components/form-field.tsx`
- Create: `apps/web/src/components/form-field.spec.tsx`
- Create: `apps/web/src/components/form-validation.ts`
- Create: `apps/web/src/components/form-validation.spec.ts`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `docs/frontend/design-system.md`

**Interfaces:**
- Produces: `FieldErrors<TField extends string> = Partial<Record<TField, string>>`
- Produces: `clearFieldError<TField>(errors, field): FieldErrors<TField>`
- Produces: `focusFirstInvalid(form: HTMLFormElement, fields: readonly string[]): void`
- Produces: `nativeConstraintMessage(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, t: Translator): string | null`
- Produces: `<FieldError id message />` with stable accessible markup.
- Produces: `<FormField id label error hint required>{control}</FormField>` that clones one form control with accessible attributes.

- [x] **Step 1: Write failing presentation tests**

Add component tests that render one input inside `FormField` and assert literal behavior:

```tsx
render(<FormField id="email" label="Email" error="Введіть email" required><input /></FormField>);
const input = screen.getByLabelText('Email');
expect(input).toHaveAttribute('aria-invalid', 'true');
expect(input).toHaveAttribute('aria-describedby', 'email-error');
expect(screen.getByText('Введіть email')).toHaveAttribute('id', 'email-error');
```

Add a second test proving hint and error ids are both referenced and the error is absent when `error` is null. Add a focused `FieldError` test that verifies the stable id and announced text without rendering an empty alert when `message` is null.

- [x] **Step 2: Run the presentation test and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/form-field.spec.tsx`

Expected: FAIL because `form-field.tsx` does not exist.

- [x] **Step 3: Implement `FormField` minimally**

Use `cloneElement` for one `input`, `select`, or `textarea`; merge existing `aria-describedby` with `${id}-hint` and `${id}-error`. Delegate the message markup to `FieldError`, render `.form-field__error` below the control, and mark it with `role="alert"` only when it first appears.

- [x] **Step 4: Write failing lifecycle tests**

Cover these literal outcomes in `form-validation.spec.ts`:

```ts
expect(clearFieldError({ email: 'bad', phone: 'bad' }, 'email')).toEqual({ phone: 'bad' });
expect(nativeConstraintMessage(requiredEmptyInput, ukTranslator)).toBe('Заповніть це поле.');
expect(nativeConstraintMessage(invalidEmailInput, enTranslator)).toBe('Enter a valid email address.');
```

Render a real form in the focus test, pass `['phone', 'email']`, and assert `document.activeElement` is the first enabled control with an error.

- [x] **Step 5: Run lifecycle tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/form-validation.spec.ts`

Expected: FAIL because the exported helpers do not exist.

- [x] **Step 6: Implement lifecycle helpers and base translations**

Map `ValidityState` in this priority: `valueMissing`, `typeMismatch`, `tooShort`, `tooLong`, `rangeUnderflow`, `rangeOverflow`, `stepMismatch`, `patternMismatch`, then generic invalid. Use `data-field` or `name` to locate controls for focus; escape selector values with `CSS.escape` when available and fall back to iterating `form.elements`.

- [x] **Step 7: Add canonical styles**

Add `.form-field`, `.form-field__label`, `.form-field__hint`, `.form-field__error`, and `[aria-invalid="true"]` styles using existing `--danger`, `--border`, and focus tokens. Add a mobile rule that preserves wrapping and prevents horizontal overflow.

- [x] **Step 8: Verify and commit Task 1**

Run:

```powershell
pnpm --filter @autosale/web exec vitest run src/components/form-field.spec.tsx src/components/form-validation.spec.ts src/i18n/completeness.spec.ts
pnpm --filter @autosale/web typecheck
git diff --check
```

Commit: `feat(web): add shared field validation primitives`

---

### Task 2: Safe structured validation issues from API to web

**Files:**
- Create: `packages/contracts/src/validation-errors.ts`
- Create: `packages/contracts/src/validation-errors.spec.ts`
- Create: `apps/api/src/common/validation-error.ts`
- Create: `apps/api/src/common/validation-error.spec.ts`
- Create: `apps/web/src/api/validation-errors.ts`
- Create: `apps/web/src/api/validation-errors.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`
- Modify: `apps/api/src/commercial-settings/commercial-settings.controller.ts`
- Modify: `apps/api/src/commercial-settings/commercial-settings.controller.spec.ts`
- Modify: `apps/web/src/api/commercial-settings.ts`

**Interfaces:**
- Produces: `ValidationIssue { field: string; code: string }`
- Produces: `ValidationFailure { statusCode: 400; code: 'VALIDATION_FAILED'; issues: ValidationIssue[] }`
- Produces: `validationBadRequest(zodError, allowlist): BadRequestException`
- Produces: `parseValidationFailure(response): Promise<ValidationFailure | null>`
- Consumes in later tasks: stable field/code pairs; never server prose.

- [x] **Step 1: Write failing contract tests**

Assert a valid payload parses and these payloads fail: field path outside `[A-Za-z0-9_.\[\]-]`, empty code, extra personal-value property, more than 32 issues.

- [x] **Step 2: Run contract tests and verify RED**

Run: `pnpm --filter @autosale/contracts exec vitest run src/validation-errors.spec.ts`

Expected: FAIL because the contract does not exist.

- [x] **Step 3: Implement bounded contracts**

Use strict Zod objects, `field` max 120, `code` max 80, and issue array max 32. Export inferred TypeScript types from `src/index.ts`, and add an explicit `./validation-errors` subpath in `package.json` following the existing source/development/dist export pattern.

- [x] **Step 4: Write failing API mapping tests**

Create a Zod object with `iban` and `currency`, parse invalid input, and assert `validationBadRequest(error, { iban: 'INVALID_IBAN', currency: 'INVALID_CURRENCY' }).getResponse()` equals:

```ts
{ statusCode: 400, code: 'VALIDATION_FAILED', issues: [
  { field: 'iban', code: 'INVALID_IBAN' },
  { field: 'currency', code: 'INVALID_CURRENCY' },
] }
```

Assert an unallowlisted path becomes `{ field: '_form', code: 'INVALID_INPUT' }` without the submitted value or Zod message.

- [x] **Step 5: Implement API helper and migrate commercial settings controller**

Map legal entity fields and bank account fields explicitly. Preserve owner/tenant guards and status codes. Update controller tests to assert structured issues for invalid IBAN and invalid currency.

- [x] **Step 6: Write failing web parser tests**

Mock a `400` response containing safe issues and assert the parser returns them. Mock malformed JSON, unknown codes, `409`, and `500`; assert it returns null so callers keep form-level handling.

- [x] **Step 7: Implement the web parser and typed API error**

`commercial-settings.ts` should throw `ValidationApiError` only for a parsed `VALIDATION_FAILED` response and retain a generic safe error for all other statuses.

- [x] **Step 8: Verify and commit Task 2**

Run:

```powershell
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/api exec vitest run src/common/validation-error.spec.ts src/commercial-settings/commercial-settings.controller.spec.ts
pnpm --filter @autosale/web exec vitest run src/api/validation-errors.spec.ts
pnpm typecheck
git diff --check
```

Commit: `feat(api): expose safe field validation issues`

---

### Task 3: Authentication, onboarding, profile, and team forms

**Files:**
- Modify: `apps/web/src/components/auth-form.tsx`
- Modify: `apps/web/src/components/auth-form.spec.tsx`
- Modify: `apps/web/src/components/google-onboarding-form.tsx`
- Modify: `apps/web/src/components/google-onboarding-form.spec.tsx`
- Modify: `apps/web/src/components/profile-editor.tsx`
- Modify: `apps/web/src/components/profile-editor.spec.tsx`
- Modify: `apps/web/src/components/team-management.tsx`
- Modify: `apps/web/src/components/team-management.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.controller.spec.ts`
- Modify: `apps/api/src/auth/google-sign-in.controller.ts`
- Modify: `apps/api/src/auth/google-sign-in.controller.spec.ts`
- Modify: `apps/api/src/auth/profile.controller.ts`
- Modify: `apps/api/src/auth/profile.controller.spec.ts`
- Modify: `apps/api/src/team/team.controller.ts`
- Modify: `apps/api/src/team/team.controller.spec.ts`

**Interfaces:**
- Consumes: `FormField`, `FieldErrors`, `nativeConstraintMessage`, `clearFieldError`, `focusFirstInvalid`, `ValidationApiError`.
- Produces: all identity/account forms on the shared validation lifecycle.

- [x] **Step 1: Add failing auth/onboarding tests**

Cover empty email, malformed email, password under 12 characters, password mismatch, and short workspace name. Assert no fetch occurs, each message is under its control, and the first invalid control has focus after submit.

- [x] **Step 2: Run auth/onboarding tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/auth-form.spec.tsx src/components/google-onboarding-form.spec.tsx`

Expected: FAIL because the forms currently rely on native validation and form-level errors.

- [x] **Step 3: Migrate auth and onboarding forms**

Add `noValidate`, collect all client issues on submit, render with `FormField`, clear per field on change, and keep invalid credentials / expired token / Google provider failures as form-level alerts.

- [x] **Step 4: Add failing profile/team tests**

Cover invalid phone, incomplete password trio, mismatched passwords, wrong email format, and missing invite email. Ensure invalid current password remains a form-level security message rather than exposing backend detail.

- [x] **Step 5: Migrate profile and team forms**

Keep avatar MIME/size errors attached to the avatar control. Preserve existing values on failure. Use domain messages for phone/password and base messages for email/required.

- [x] **Step 6: Verify and commit Task 3**

Run:

```powershell
pnpm --filter @autosale/web exec vitest run src/components/auth-form.spec.tsx src/components/google-onboarding-form.spec.tsx src/components/profile-editor.spec.tsx src/components/team-management.spec.tsx src/i18n/completeness.spec.ts
pnpm --filter @autosale/web typecheck
git diff --check
```

Commit: `feat(web): add field errors to account forms`

---

### Task 4: Catalogue, orders, commercial settings, and payments

**Files:**
- Modify: `apps/web/src/components/product-editor.tsx`
- Modify: `apps/web/src/components/product-editor.spec.tsx`
- Modify: `apps/web/src/components/catalogue-import-wizard.tsx`
- Modify: `apps/web/src/components/catalogue-import-wizard.spec.tsx`
- Modify: `apps/web/src/components/commercial-settings-hub.tsx`
- Modify: `apps/web/src/components/commercial-settings-hub.spec.tsx`
- Modify: `apps/web/src/components/order-review-panel.tsx`
- Modify: `apps/web/src/components/order-review-panel.spec.tsx`
- Modify: `apps/web/src/components/order-commercial-terms-card.tsx`
- Modify: `apps/web/src/components/order-commercial-terms-card.spec.tsx`
- Modify: `apps/web/src/components/order-payments-card.tsx`
- Modify: `apps/web/src/components/order-payments-card.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/api/src/catalogue/catalogue.controller.ts`
- Modify: `apps/api/src/catalogue/catalogue.controller.spec.ts`
- Modify: `apps/api/src/catalogue-import/catalogue-import.controller.ts`
- Modify: `apps/api/src/catalogue-import/catalogue-import.controller.spec.ts`
- Modify: `apps/api/src/commercial-settings/commercial-settings.controller.ts`
- Modify: `apps/api/src/commercial-settings/commercial-settings.controller.spec.ts`
- Modify: `apps/api/src/orders/orders.controller.ts`
- Modify: `apps/api/src/orders/orders.controller.spec.ts`
- Modify: `apps/api/src/orders/commercial-terms.controller.ts`
- Modify: `apps/api/src/orders/commercial-terms.controller.spec.ts`
- Modify: `apps/api/src/orders/payments.controller.ts`
- Modify: `apps/api/src/orders/payments.controller.spec.ts`

**Interfaces:**
- Consumes all shared validation primitives and safe API issues.
- Produces domain validators for SKU/name/aliases, legal entity/account/IBAN/currency, order correction, commercial selection, payment amount/date/account/carrier, and cancellation reason.

- [x] **Step 1: Write failing product/import tests**

Assert SKU and name required errors appear below fields, duplicate aliases attach to aliases, missing mapping attaches to the mapping group, and an invalid source file attaches to the file picker while background analysis failures remain panel-level.

- [x] **Step 2: Migrate product and catalogue import UI**

Replace `validation-error` footer-only state with field errors. Preserve successful save/import states and job/provider errors.

- [x] **Step 3: Write failing commercial and order tests**

Cover all legal-entity required fields, IBAN, ISO currency, unresolved catalogue selection, invalid quantity, incompatible legal entity/account, and locked terms. Assert locked/fulfilment conflicts remain form-level.

- [x] **Step 4: Migrate commercial settings and order editing**

Replace the IBAN-only local state with `FieldErrors` for every editable field. Map safe API issues by allowlist. For order item arrays, use stable paths such as `items.${item.id}.quantity`, never list indices that change after rendering.

- [x] **Step 5: Write failing payment tests**

Cover amount below `0.01`, invalid/future date, missing bank account for bank transfer, missing COD carrier, and cancellation reason under three characters. Assert the first bad field is focused and API is not called.

- [x] **Step 6: Migrate payment forms**

Attach service-returned safe codes to amount/date/account/carrier when applicable. Keep pricing-not-ready, idempotency conflict, already-cancelled, network and permission errors form-level.

- [x] **Step 7: Verify and commit Task 4**

Run:

```powershell
pnpm --filter @autosale/web exec vitest run src/components/product-editor.spec.tsx src/components/catalogue-import-wizard.spec.tsx src/components/commercial-settings-hub.spec.tsx src/components/order-review-panel.spec.tsx src/components/order-commercial-terms-card.spec.tsx src/components/order-payments-card.spec.tsx
pnpm --filter @autosale/api exec vitest run src/catalogue/catalogue.controller.spec.ts src/commercial-settings/commercial-settings.controller.spec.ts src/orders/orders.controller.spec.ts src/orders/commercial-terms.controller.spec.ts src/orders/payments.controller.spec.ts
pnpm typecheck
git diff --check
```

Commit: `feat(web): add field errors to commerce forms`

---

### Task 5: Delivery and integration settings

**Files:**
- Modify: `apps/web/src/components/delivery-settings-card.tsx`
- Modify: `apps/web/src/components/delivery-settings-card.spec.tsx`
- Modify: `apps/web/src/components/meest-settings-card.tsx`
- Modify: `apps/web/src/components/meest-settings-card.spec.tsx`
- Modify: `apps/web/src/components/ukrposhta-settings-card.tsx`
- Modify: `apps/web/src/components/ukrposhta-settings-card.spec.tsx`
- Modify: `apps/web/src/components/shipment-review-dialog.tsx`
- Modify: `apps/web/src/components/shipment-review-dialog.spec.tsx`
- Modify: `apps/web/src/components/telegram-settings-card.tsx`
- Modify: `apps/web/src/components/telegram-settings-card.spec.tsx`
- Modify: `apps/web/src/components/telegram-supplier-settings.tsx`
- Modify: `apps/web/src/components/telegram-supplier-settings.spec.tsx`
- Modify: `apps/web/src/components/google-sheets-settings-form.tsx`
- Modify: `apps/web/src/components/google-sheets-settings-form.spec.tsx`
- Modify: `apps/web/src/components/catalogue-source-settings.tsx`
- Modify: `apps/web/src/components/catalogue-source-settings.spec.tsx`
- Modify: `apps/web/src/components/instagram-reply-composer.tsx`
- Modify: `apps/web/src/components/instagram-reply-composer.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/api/src/delivery/delivery.controller.ts`
- Modify: `apps/api/src/delivery/delivery.controller.spec.ts`
- Modify: `apps/api/src/integrations/telegram.controller.ts`
- Modify: `apps/api/src/integrations/telegram.controller.spec.ts`
- Modify: `apps/api/src/settings/google-sheets-settings.controller.ts`
- Modify: `apps/api/src/settings/google-sheets-settings.controller.spec.ts`
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.controller.ts`
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.controller.spec.ts`

**Interfaces:**
- Consumes shared validation primitives and safe API issue mapping.
- Produces field errors for credentials, sender profile, location, parcel dimensions/weight/value, recipient data, message text, sheet/tab selection, and supplier selection.

- [x] **Step 1: Add failing carrier settings tests**

For each carrier assert malformed/missing credentials and incomplete sender profile attach to the exact field. Provider rejection after syntactically valid credentials remains a card-level alert.

- [x] **Step 2: Migrate carrier settings forms**

Keep credentials masked and never echo rejected secrets in field messages. A server issue may identify `apiKey` or `sender.phone`, but UI copy is selected locally.

- [x] **Step 3: Add failing shipment tests**

Cover missing recipient name/phone, location, parcel weight/dimensions, declared value and COD over declared value. Assert dependent errors clear only when the relevant field changes.

- [x] **Step 4: Migrate shipment forms**

Keep quote/provider availability errors dialog-level. Focus the first invalid editable control after create/quote submit.

- [x] **Step 5: Add and implement integration field tests**

Telegram/Instagram message text, supplier selection, Google spreadsheet/tab, and catalogue source controls receive local field errors. OAuth cancellation, revoked access, picker launch failure, webhook/provider outage, and background sync failure remain integration-level alerts.

- [x] **Step 6: Verify and commit Task 5**

Run:

```powershell
pnpm --filter @autosale/web test
pnpm --filter @autosale/api exec vitest run src/delivery/delivery.controller.spec.ts
pnpm typecheck
git diff --check
```

Commit: `feat(web): add field errors to delivery integrations`

---

### Task 6: Public demo form and final repository contract

**Files:**
- Modify: `apps/web/src/marketing/components/demo-form.tsx`
- Create or modify: `apps/web/src/marketing/components/demo-form.spec.tsx`
- Modify: `apps/api/src/demo-leads/demo-leads.controller.ts`
- Modify: `apps/api/src/demo-leads/demo-leads.controller.spec.ts`
- Create: `apps/web/src/components/form-validation-contract.spec.ts`
- Modify: `AGENTS.md`
- Modify: `docs/frontend/design-system.md`
- Modify: `docs/features/README.md`
- Modify: `docs/acceptance/marketing-site-checklist.md` if it contains demo-form acceptance.

**Interfaces:**
- Consumes shared validation primitives and API issue contract.
- Produces final guardrail that inventories user-editable forms and requires shared field error presentation or an explicit contextual exception.

- [x] **Step 1: Write failing demo-form tests**

Cover name/company length, invalid email/phone, missing order volume and consent. Assert values survive failed submission, the first field is focused, and notification/service failure remains form-level.

- [x] **Step 2: Migrate demo form and API issues**

Return only safe codes for `name`, `company`, `email`, `phone`, `orderVolume`, and `privacyConsent`. Do not reveal idempotency internals or notifier errors.

- [x] **Step 3: Write failing repository contract test**

Inventory production TSX files containing `<form`. Require each form to either import `FormField`/validation lifecycle or include a nearby `data-validation-context="non-field"` marker. The marker is allowed only for forms whose controls cannot be independently invalid; list each exception in the test fixture with a reason.

- [x] **Step 4: Run the contract test and close every remaining gap**

Run: `pnpm --filter @autosale/web exec vitest run src/components/form-validation-contract.spec.ts`

Expected first run: FAIL listing unmigrated forms. Inspect each file and either migrate it with a focused component test or add a justified non-field exception. Do not add blanket directory exceptions.

- [x] **Step 5: Update rules and feature status**

Add the field-error standard to `AGENTS.md` and `docs/frontend/design-system.md`. Change the feature index status from `Planned` to `Available` only after the audit test, full suite and browser acceptance pass.

- [x] **Step 6: Verify and commit Task 6**

Run:

```powershell
pnpm --filter @autosale/web test
pnpm --filter @autosale/api test
pnpm --filter @autosale/contracts test
pnpm typecheck
pnpm build
git diff --check
```

Commit: `feat(web): enforce field validation UX`

---

### Task 7: Browser acceptance, merge, deploy, and production smoke

**Files:**
- Modify only if evidence requires it: affected component/spec and acceptance documentation.
- Do not commit screenshots, browser profiles, `.env`, backups, tokens, runtime artifacts, or production personal data.

**Interfaces:**
- Consumes all completed tasks.
- Produces verified `master`, production deployment, and an evidence-backed completion report.

- [ ] **Step 1: Run browser acceptance at required widths**

Test representative forms at 320, 768, 1024 and 1440 px: registration, profile, product editor, bank account, payment, shipment and public demo. For each, submit empty/invalid data, verify focus and field text, correct one field, verify only its error disappears, and confirm values remain.

- [ ] **Step 2: Run accessibility smoke**

Keyboard-submit each representative form, inspect accessible names/descriptions, ensure `aria-invalid` changes with state, and confirm no horizontal scrolling caused by messages.

- [x] **Step 3: Run final verification**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short --branch
```

Expected: every command exits `0`, no failing tests, and only intentional tracked files are present.

- [ ] **Step 4: Merge and push**

Fast-forward the verified short-lived branch into `master`, push `origin/master`, confirm the remote SHA, delete the merged branch, and confirm a clean worktree.

- [ ] **Step 5: Manual production deployment and smoke**

Create a current backup using the repository runbook, run `scripts/deploy-local.ps1 -EnvFile ./.env`, wait until `api`, `web`, and `worker` are healthy, then verify `https://sales-aito.com/health/live` and `/login`. Perform one authenticated validation smoke without creating fictional financial or customer records in production.

- [x] **Step 6: Record acceptance evidence**

Update the relevant acceptance checklist with date, commit SHA, automated test totals, widths tested, production health result, and any provider-account validation that remains external.
