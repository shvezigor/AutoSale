# Form Accessibility Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete keyboard, screen-reader and responsive acceptance for registration, profile, product, bank account, payment and TTN forms without causing real financial or carrier side effects.

**Architecture:** Extend the existing shared validation contract with browser checks against the real rendered flows. Use isolated fictional fixtures where creating a payment or shipment would have an external effect, and a controlled signed-in test account for read/invalid-submit and safe persistence checks. Fix failures only in the owning form component and preserve the shared `FormField`/`FieldError` contract.

**Tech Stack:** Next.js/React, Vitest, Playwright, browser accessibility tree and screen reader, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-20-demo-lead-operations-and-private-conversion-design.md`; existing validation behavior: `docs/superpowers/specs/2026-09-21-field-validation-ux-design.md`.

## Global Constraints

- Test 320, 768, 1024 and 1440 px; no document-level horizontal overflow, lost focus, unlabeled controls or inaccessible errors.
- No real payment, TTN, provider message or external side effect solely for UI acceptance. Use fictional fixtures and an explicitly authorized test account.
- Every invalid editable field has localized adjacent copy, `aria-invalid`, `aria-describedby`, first-invalid focus, preserved entry and clear-only-edited-error behavior.
- Do not mark a manual screen-reader or production browser gate complete from code tests alone. Capture screenshots for material visual fixes.

---

## File map

- `tests/e2e/field-validation-accessibility.spec.ts`: safe responsive and semantic browser matrix; reuse credential-gated login from `tests/e2e/auth.spec.ts`.
- `apps/web/src/components/{profile-editor,product-editor,commercial-settings-hub,order-payments-card,shipment-review-dialog}.tsx`: only the owning component of an observed defect is modified.
- `apps/web/src/components/{profile-editor,product-editor,commercial-settings-hub,order-payments-card,shipment-review-dialog}.spec.tsx`: regression test adjacent to a verified defect.
- `apps/web/src/components/{form-field.tsx,form-validation.ts}`: change only if a shared defect is reproduced across forms, with both shared contract tests.
- `docs/acceptance/field-validation-checklist.md`: dated browser/screen-reader evidence and exact remaining blocked steps.
- `docs/frontend/design-system.md` and `docs/features/README.md`: update only if the shared behavior or status changes.

## Task 1: Reproducible keyboard/responsive matrix

**Files:** Create `tests/e2e/field-validation-accessibility.spec.ts`; modify `docs/acceptance/field-validation-checklist.md`.

**Interfaces:** The test accepts `E2E_BASE_URL`, `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD` and a fictional safe order ID through environment; it skips credential-dependent tests with an explicit reason rather than producing false success.

- [ ] **Step 1: Write browser assertions** for registration and authenticated form routes at each width. Empty submit must focus the first invalid field, attach `aria-invalid` and an existing `aria-describedby` target, and preserve typed values after correction. Example helper:

```ts
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
for (const width of [320, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  await expectNoHorizontalOverflow(page);
}
```

- [ ] **Step 2: Run the new test red** with `pnpm exec playwright test tests/e2e/field-validation-accessibility.spec.ts --reporter=line`; record each failed form/width rather than weakening selectors. For authenticated tests, configure only the authorized test account in the process environment; never commit credentials.
- [ ] **Step 3: Add safe fixture paths** for payment and TTN invalid-submit checks that stop before `POST` mutations, using route interception when the browser would otherwise call a carrier or save a payment. Assert no mutation request occurs:

```ts
let paymentWrites = 0;
await page.route('**/api/orders/**/payments', (route) => {
  if (route.request().method() === 'POST') paymentWrites += 1;
  return route.abort();
});
expect(paymentWrites).toBe(0);
```

- [ ] **Step 4: Run the matrix and record results** for each route/width, including skipped credential-dependent cases. Commit test and dated checklist evidence as `test: cover form keyboard and responsive acceptance`.

## Task 2: Screen-reader/manual browser pass and focused repairs

**Files:** Modify the exact failing component and its adjacent `.spec.tsx` identified by Task 1 or manual screen-reader pass; update `docs/acceptance/field-validation-checklist.md` and `docs/frontend/design-system.md` only when shared behavior changes.

**Interfaces:** Retain the existing `FormField`/`FieldError` API and `form-validation.ts` behavior. A repair must not introduce a new generic form library or browser-default action button.

- [ ] **Step 1: In a real browser, navigate every form by keyboard only**: tab/shift-tab, opening selectors/dialogs, invalid submit, reading the first error and subsequent errors, Escape/close focus return, then one corrected field. Inspect the browser accessibility tree and a screen reader for spoken label, required state, hint and error. Record form, control, spoken result, viewport and browser date in the checklist.
- [ ] **Step 2: For each observed defect, write one failing adjacent component or Playwright test.** For example, if a payment amount error lacks a programmatic relation:

```tsx
expect(screen.getByLabelText('Сума')).toHaveAttribute('aria-invalid', 'true');
expect(screen.getByLabelText('Сума')).toHaveAttribute('aria-describedby', expect.stringContaining('error'));
```

- [ ] **Step 3: Run the focused red test, make the smallest owning-component repair, then rerun it green.** A label fix uses `FormField id="payment-amount"` around the existing input; a focus fix invokes the shared first-invalid focus helper after submit. Do not alter business validation or call live carrier/payment endpoints.

```tsx
<FormField id="payment-amount" label={text.amount} error={fieldErrors.amount} required>
  <input name="amount" inputMode="decimal" value={amount} onChange={onAmountChange} />
</FormField>
```

- [ ] **Step 4: Run `pnpm --filter @autosale/web test -- form-field form-validation profile-editor product-editor commercial-settings-hub order-payments-card shipment-review-dialog`, `pnpm --filter @autosale/web typecheck`, `pnpm --filter @autosale/web build`, and the browser matrix.** Capture before/after screenshots at affected widths and repeat the screen-reader check. Commit each distinct repair with its test.

## Task 3: Deployment acceptance and evidence

**Files:** Modify `docs/acceptance/field-validation-checklist.md`, `docs/features/README.md`, and only if behavior changes `docs/superpowers/specs/2026-09-21-field-validation-ux-design.md`.

- [ ] **Step 1: Manually deploy tested web changes after a verified backup** using the repository deployment runbook; if no component changed, verify the existing deployed commit and avoid an unnecessary container restart.
- [ ] **Step 2: Repeat primary, invalid and corrected states on the expected deployed environment** at 320/768/1024/1440 px. Verify safe persisted profile/product state after reload only where authorized; do not create a payment or TTN. Capture dated screenshots of materially changed UI.
- [ ] **Step 3: Mark only evidenced checklist rows complete.** If screen-reader tooling, owner credentials or a safe test order is unavailable, record the precise form and unverified step; keep the feature `Validation pending` in the index.
- [ ] **Step 4: Commit the final evidence and release notes.** Merge/push `master` only after all other plans in this approved stage pass their gates; preserve unrelated untracked `artifacts/`.
