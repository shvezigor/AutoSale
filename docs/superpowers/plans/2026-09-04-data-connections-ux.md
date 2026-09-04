# Data Connections UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner select a product source or order destination in one flow, auto-import confident mappings, and request review only for uncertain data.

**Architecture:** Add a pure mapping-decision policy to the catalogue worker and expose import outcomes through the existing source APIs. Replace infrastructure-oriented settings cards with a unified data workspace that composes the existing OAuth, Picker, catalogue source, upload, and order destination capabilities. Google authorization remains incremental and automatically resumes the intended Picker action after callback.

**Tech Stack:** TypeScript, React 19, Next.js, NestJS, BullMQ, Prisma/PostgreSQL, Vitest, Testing Library, Playwright, Google OAuth/Picker/Sheets APIs.

**Spec:** `docs/superpowers/specs/2026-09-04-data-connections-ux-design.md`

## Global Constraints

- Google Sign-In requests identity scopes only; Drive access is requested on the first data action.
- Request only `drive.file`, never broad Drive scopes.
- Managers cannot authorize, select, or inspect tenant data.
- Preview appears only for uncertain mappings or invalid required data.
- SKU is optional and generated stably when absent.
- Existing non-empty order sheets are never overwritten.
- Preserve tenant isolation, idempotency, audit events, encrypted tokens, responsive layout, keyboard access, and reduced motion.

---

### Task 1: Deterministic automatic-import policy

**Files:**
- Create: `apps/worker/src/catalogue/catalogue-import-decision.ts`
- Test: `apps/worker/src/catalogue/catalogue-import-decision.spec.ts`
- Modify: `apps/worker/src/catalogue/catalogue-mapping.processor.ts`
- Test: `apps/worker/src/catalogue/catalogue-mapping.processor.spec.ts`

**Interfaces:**
- Produces: `decideCatalogueImport(input): { action: 'AUTO_IMPORT' | 'REVIEW_REQUIRED'; reasons: string[] }`.
- Consumes mapping columns, source rows, prior semantic mapping, and confidence values already produced by the mapper.

- [ ] Write failing policy tests for confident name mapping, missing name, duplicate canonical targets, conflicting SKU, and materially changed uncertain headers.
- [ ] Run `pnpm --filter @autosale/worker test -- catalogue-import-decision.spec.ts` and verify failures are caused by the missing policy.
- [ ] Implement the smallest pure decision function that satisfies the cases.
- [ ] Run the focused policy tests and verify they pass.
- [ ] Write a failing processor test proving a safe mapping is confirmed/imported while an uncertain mapping remains pending review.
- [ ] Wire the decision into the mapping processor and keep the existing lease/idempotency behavior.
- [ ] Run both worker test files and commit `feat(catalogue): auto-import confident mappings`.

### Task 2: Unified catalogue action result

**Files:**
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.service.ts`
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.controller.ts`
- Test: `apps/api/src/catalogue-sources/catalogue-sources.service.spec.ts`
- Modify: `apps/web/src/components/catalogue-source-settings.tsx`
- Test: `apps/web/src/components/catalogue-source-settings.spec.tsx`

**Interfaces:**
- Produces source configuration with `latestRun: { id; status; createdRows; updatedRows; skippedRows; failedRows; reviewReasons } | null`.
- Existing create/update/sync routes remain compatible.

- [ ] Write failing service tests for returning the latest run summary tenant-safely.
- [ ] Run the focused API test and confirm expected failure.
- [ ] Add the latest-run projection without exposing row contents.
- [ ] Run the focused API test and confirm it passes.
- [ ] Write failing component tests for `Готово` summary and review-only rendering.
- [ ] Render compact progress/result states from `latestRun`.
- [ ] Run component tests and commit `feat(catalogue): expose import outcome in settings`.

### Task 3: One-action progressive Google Picker

**Files:**
- Modify: `apps/web/src/components/google-picker-button.tsx`
- Test: `apps/web/src/components/google-picker-button.spec.tsx`
- Modify: `apps/web/src/components/catalogue-source-settings.tsx`
- Modify: `apps/web/src/components/google-sheets-settings-form.tsx`
- Modify: `apps/web/src/components/google-connection-settings.tsx`
- Modify: `apps/api/src/integrations/google-oauth.controller.ts`
- Test: `apps/api/src/integrations/google-oauth.controller.spec.ts`

**Interfaces:**
- Picker action accepts `intent: 'catalogue' | 'orders'` and starts OAuth when disconnected.
- OAuth callback returns to `/settings?tab=data&action=pick-catalogue|pick-orders`.

- [ ] Write failing component tests that a disconnected picker action begins OAuth and an active connection opens Picker directly.
- [ ] Run the focused component test and verify the intended failures.
- [ ] Extend the picker action and callback return-path allowlist with the two safe actions.
- [ ] Add automatic resume after the callback while preventing reopen loops.
- [ ] Run component and OAuth controller tests and commit `feat(google): resume picker after incremental authorization`.

### Task 4: Product source chooser for Google and local files

**Files:**
- Modify: `apps/web/src/components/catalogue-source-settings.tsx`
- Modify: `apps/web/src/components/catalogue-import-wizard.tsx`
- Test: `apps/web/src/components/catalogue-source-settings.spec.tsx`
- Test: `apps/web/src/components/catalogue-import-wizard.spec.tsx`
- Modify: `apps/web/app/catalogue/page.tsx`
- Test: `apps/web/app/catalogue/page.spec.tsx`

**Interfaces:**
- Product card exposes `Обрати Google-таблицю` and `Завантажити CSV або Excel`.
- File upload reuses `/api/catalogue/imports/upload`; completion/review stays in settings.

- [ ] Write failing tests for both source choices and removal of setup actions from the catalogue page.
- [ ] Run focused tests and verify expected failures.
- [ ] Move upload orchestration into the data card and reduce the catalogue page to browsing/editing.
- [ ] Make single-sheet selection automatic; show a tab selector only for multiple tabs.
- [ ] Run focused tests and commit `feat(settings): unify product data sources`.

### Task 5: Order destination card and data settings layout

**Files:**
- Modify: `apps/web/app/settings/page.tsx`
- Test: `apps/web/app/settings/page.spec.tsx`
- Modify: `apps/web/src/components/google-sheets-settings-form.tsx`
- Test: `apps/web/src/components/google-sheets-settings-form.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Settings tab id is `data`, with backward-compatible redirect/selection for `google`.
- Order destination is selected through Picker; technical spreadsheet-ID inputs are absent from the primary view.

- [ ] Write failing page/component tests for the `Дані` tab, two business cards, and contextual Google status.
- [ ] Run focused web tests and confirm expected failures.
- [ ] Implement the new composition and concise Ukrainian copy.
- [ ] Add responsive styles, focus visibility, semantic status colors, and reduced-motion handling using existing design tokens.
- [ ] Run focused tests and commit `feat(settings): add data and synchronization workspace`.

### Task 6: Regression and browser verification

**Files:**
- Modify only files required by failures discovered in this task.
- Update: `tasks/todo.md`

**Interfaces:**
- No new interface; validates the integrated flow.

- [x] Run `pnpm test` and fix only regressions caused by this feature, adding a failing regression test before each fix.
- [x] Run `pnpm build` and resolve type/build failures.
- [ ] Run the settings and Google OAuth Playwright scenarios.
- [ ] Start the Docker stack and inspect desktop/mobile `/settings?tab=data` in a real browser.
- [ ] Record completed work and remaining real-service dependencies in `tasks/todo.md`.
- [ ] Commit `test: verify data connections workflow`.
