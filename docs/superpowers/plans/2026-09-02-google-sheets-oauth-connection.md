# Google Sheets OAuth Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each AutoSale tenant owner connect a Google account, select private spreadsheets through Google Picker, and use those files for catalogue synchronization and idempotent order export.

**Architecture:** A NestJS authorization-code flow stores a tenant-bound encrypted refresh token and supplies short-lived access tokens to the existing Google Sheets adapter. Next.js opens Google authorization and Google Picker; PostgreSQL stores connection state and selected file references; BullMQ workers continue existing catalogue and export processing with a tenant credential provider instead of a global service account.

**Tech Stack:** TypeScript, NestJS, Next.js/React, Prisma/PostgreSQL, BullMQ, Google OAuth 2.0, Google Picker, Drive API, Sheets API, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-02-google-sheets-oauth-connection-design.md`

## Global Constraints

- Use one production Google OAuth web application for all tenants.
- Request only `https://www.googleapis.com/auth/drive.file` in the first release.
- Only tenant owners may connect, reconnect, disconnect, or select files.
- PostgreSQL remains canonical; Google Sheets is an import/export boundary.
- Refresh tokens must use authenticated encryption and must never enter logs, API responses, browser storage, or queue payloads.
- Existing service-account support remains development-only until OAuth acceptance passes.
- Preserve existing catalogue fencing and order-export idempotency.

---

### Task 1: Add Google OAuth configuration and deployment contract

**Files:**
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Create: `docs/integrations/google-oauth-setup.md`

**Interfaces:**
- Produces: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`, and `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` validated configuration.

- [ ] Write failing environment-schema tests that accept a complete OAuth configuration, reject partial credentials, require an HTTPS production callback, and redact secrets.
- [ ] Run `pnpm --filter @autosale/config test -- api-env.spec.ts`; expect the new cases to fail.
- [ ] Add the exact variables to the API/web environment contract and Compose without embedding values in images.
- [ ] Document creation of the Cloud project, enabling Sheets/Drive/Picker APIs, origin `https://sales-aito.com`, and callback `https://sales-aito.com/api/integrations/google/callback`.
- [ ] Re-run the focused tests and `pnpm --filter @autosale/config typecheck`; expect PASS.
- [ ] Commit with `git commit -m "feat(config): add Google OAuth settings"`.

### Task 2: Persist tenant Google connections and single-use OAuth attempts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_google_oauth_connections/migration.sql`
- Create: `apps/api/src/integrations/google-oauth-state.service.ts`
- Create: `apps/api/src/integrations/google-oauth-state.service.spec.ts`

**Interfaces:**
- Produces: `GoogleConnection` with tenant, Google subject, encrypted refresh token, credential generation, scopes, owner-visible email, and lifecycle status.
- Produces: `GoogleOAuthAttempt` with hashed state, tenant/user binding, expiry, safe return path, and consumed timestamp.
- Produces: `createAttempt({ tenantId, userId, returnPath }): Promise<{ state: string }>` and `consumeAttempt(state): Promise<GoogleOAuthAttempt>`.

- [ ] Write PostgreSQL-backed tests for one active connection per tenant, single-use state, expiry, replay rejection, and tenant/user binding.
- [ ] Run `pnpm --filter @autosale/api test -- google-oauth-state.service.spec.ts`; expect schema/service failures.
- [ ] Add enums, relations, unique indexes, expiry indexes, and migration SQL without storing plaintext state.
- [ ] Implement state creation with `randomBytes(32)`, SHA-256 storage, a ten-minute expiry, and atomic conditional consumption.
- [ ] Run Prisma validation/generation and the focused tests; expect PASS.
- [ ] Commit with `git commit -m "feat(google): persist OAuth connections and state"`.

### Task 3: Implement Google OAuth start and callback

**Files:**
- Create: `apps/api/src/integrations/google-oauth.client.ts`
- Create: `apps/api/src/integrations/google-oauth.service.ts`
- Create: `apps/api/src/integrations/google-oauth.controller.ts`
- Create: `apps/api/src/integrations/google-oauth.service.spec.ts`
- Modify: `apps/api/src/integrations/integrations.module.ts`

**Interfaces:**
- Produces: `start(principal, returnPath): Promise<{ authorizationUrl: string }>`.
- Produces: `complete({ code, state }): Promise<{ returnPath: string }>`.
- Produces: `summary(tenantId): Promise<{ status; email; grantedScopes; connectedAt; lastVerifiedAt }>` without credential fields.

- [ ] Write failing tests for owner-only start, exact redirect URI, `drive.file`, offline access, callback replay, subject mismatch, missing refresh token, reconnect preservation, and encrypted storage.
- [ ] Run `pnpm --filter @autosale/api test -- google-oauth.service.spec.ts`; expect missing implementation.
- [ ] Implement authorization URL creation and server-side code exchange; fetch Google identity from a verified provider response and never trust browser-supplied email.
- [ ] Reuse the existing authenticated credential cipher and credential-generation pattern used by Instagram.
- [ ] Expose start, callback, summary, and reconnect endpoints with CSRF on authenticated mutations and a safe callback redirect.
- [ ] Run focused tests, API typecheck, and secret-log assertions; expect PASS.
- [ ] Commit with `git commit -m "feat(google): add tenant OAuth flow"`.

### Task 4: Add durable disconnect and credential cleanup

**Files:**
- Create: `apps/api/src/integrations/google-credential-cleanup.service.ts`
- Create: `apps/api/src/integrations/google-credential-cleanup.service.spec.ts`
- Modify: `apps/api/src/integrations/google-oauth.controller.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_google_credential_cleanup/migration.sql`

**Interfaces:**
- Produces: `disconnect(tenantId, actorUserId): Promise<void>`.
- Produces: a cleanup record fenced by `credentialGenerationId` so stale cleanup cannot remove a newer credential.

- [ ] Write failing tests for immediate job blocking, best-effort Google revocation, durable retry, reconnect during cleanup, and deletion of only the matching credential generation.
- [ ] Run the focused test; expect FAIL.
- [ ] Implement disconnect as status transition plus durable cleanup, pause dependent sources/destinations, and preserve products/orders.
- [ ] Add a bounded reconciler for transient revocation failure and privacy-safe terminal status.
- [ ] Run migration tests and focused tests; expect PASS.
- [ ] Commit with `git commit -m "feat(google): add credential cleanup lifecycle"`.

### Task 5: Select and validate spreadsheets with Google Picker

**Files:**
- Create: `apps/web/src/components/google-picker-button.tsx`
- Create: `apps/web/src/components/google-picker-button.spec.tsx`
- Create: `apps/api/src/integrations/google-files.controller.ts`
- Create: `apps/api/src/integrations/google-files.service.ts`
- Create: `apps/api/src/integrations/google-files.service.spec.ts`
- Modify: `apps/web/src/components/google-sheets-settings-form.tsx`

**Interfaces:**
- Produces: browser selection `{ fileId: string; name: string }` from Google Picker.
- Produces: `GET /api/integrations/google/files/:fileId/tabs` returning verified `{ spreadsheetId; displayName; tabs: [{ sheetId; title }] }`.
- Consumes: Task 3 connection and short-lived access-token provider.

- [ ] Write component tests for disconnected, loading, cancelled, selected, and provider-error states; assert that no refresh token reaches the browser.
- [ ] Write API tests that reject arbitrary inaccessible IDs, non-spreadsheet files, cross-tenant connections, and deleted files.
- [ ] Implement a Picker button filtered to Google Sheets and restricted by the configured developer key/app ID.
- [ ] Verify the Picker result server-side through Drive/Sheets metadata before displaying tabs.
- [ ] Run web/API focused tests and typechecks; expect PASS.
- [ ] Commit with `git commit -m "feat(google): select spreadsheets with Picker"`.

### Task 6: Bind OAuth credentials to catalogue synchronization

**Files:**
- Create: `packages/integrations/src/google-oauth-token-provider.ts`
- Modify: `packages/integrations/src/google-sheets.ts`
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.service.ts`
- Modify: `apps/worker/src/catalogue/google-catalogue-sync.processor.ts`
- Modify: `apps/worker/src/catalogue/google-catalogue-sync.processor.spec.ts`

**Interfaces:**
- Produces: `GoogleAccessTokenProvider.getAccessToken(connectionId, tenantId): Promise<string>`.
- Consumes: encrypted refresh token and Google token endpoint; never persists the short-lived token in queue data.

- [ ] Write failing tests proving every sync resolves the tenant connection, refreshes an access token, and pauses on revoked access without changing the last valid catalogue.
- [ ] Run worker Google catalogue tests; expect FAIL.
- [ ] Replace the global service-account token provider in production paths with the tenant OAuth provider while retaining the adapter interface.
- [ ] Make source creation require a verified Picker file and connection reference; retain AI mapping/review and structural fencing.
- [ ] Run catalogue, mapping, scheduler, and tenant-isolation tests; expect PASS.
- [ ] Commit with `git commit -m "feat(catalogue): use tenant Google OAuth"`.

### Task 7: Bind OAuth credentials to order export

**Files:**
- Modify: `apps/api/src/settings/google-sheets-settings.service.ts`
- Modify: `apps/api/src/settings/google-sheets-settings.controller.ts`
- Modify: `apps/worker/src/google-sheets/google-sheets-sync.processor.ts`
- Modify: `apps/worker/src/google-sheets/google-sheets-sync.processor.spec.ts`
- Modify: `apps/web/src/components/google-sheets-settings-form.tsx`

**Interfaces:**
- Consumes: Task 5 verified spreadsheet/tab and Task 6 token provider.
- Preserves: stable `order_id` lookup/update/append and existing `OrderExport` idempotency.

- [ ] Write failing tests for Picker-selected destination validation, missing headers, revoked authorization, timeout reconciliation, and repeated retry.
- [ ] Run API/worker Sheets tests; expect FAIL.
- [ ] Store destination connection/file/tab references and use the tenant token provider for validation/export.
- [ ] Keep the existing canonical header contract and ensure reconnect resumes pending exports without duplicating rows.
- [ ] Run settings, worker export, order retry, and typecheck suites; expect PASS.
- [ ] Commit with `git commit -m "feat(orders): export with tenant Google OAuth"`.

### Task 8: Deliver the complete Google settings experience

**Files:**
- Modify: `apps/web/app/settings/page.tsx`
- Create: `apps/web/src/components/google-connection-settings.tsx`
- Create: `apps/web/src/components/google-connection-settings.spec.tsx`
- Modify: `apps/web/src/components/catalogue-source-settings.tsx`
- Modify: `apps/web/src/components/google-sheets-settings-form.tsx`

**Interfaces:**
- Displays: connection status/email to owners, safe health to managers, separate catalogue and order-export sections, selected file/tab, sync state, and reconnect/disconnect actions.

- [ ] Write failing UI tests for owner/manager roles and connection states `NOT_CONNECTED`, `ACTIVE`, `REAUTHORIZATION_REQUIRED`, `DISCONNECTING`, and `ERROR`.
- [ ] Run focused web tests; expect FAIL.
- [ ] Implement the wizard: connect Google → choose file → choose tab → choose purpose → validate → review mapping/headers.
- [ ] Ensure managers cannot see account email or mutation actions and platform admins cannot access tenant spreadsheet metadata.
- [ ] Run accessibility-focused component tests and production web build; expect PASS.
- [ ] Commit with `git commit -m "feat(settings): add Google connection wizard"`.

### Task 9: Migrate, document, and verify end to end

**Files:**
- Modify: `docs/acceptance/mvp-checklist.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/operations/observability.md`
- Create: `tests/e2e/google-oauth-sheets.spec.ts`
- Modify: `.github/workflows/ci.yml` if present

**Interfaces:**
- Produces: a documented development/test/production Google setup and a repeatable acceptance record.

- [ ] Add an E2E fixture flow covering OAuth callback, Picker selection, catalogue import, AI mapping confirmation, and exactly-once order export.
- [ ] Add failure cases for revoked grant, deleted file/tab, quota response, worker restart, reconnect, and disconnect cleanup.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm test:e2e`, and `docker compose build`; expect PASS.
- [ ] Complete staging with a private test spreadsheet and record sanitized evidence without account data or tokens.
- [ ] Configure the production Google project, verification materials, domain/origins/callback, and restricted Picker key.
- [ ] Confirm production no longer requires `GOOGLE_SERVICE_ACCOUNT_FILE` for tenant operations.
- [ ] Commit with `git commit -m "test(google): verify OAuth Sheets workflow"`.

## Checkpoints

### After Tasks 1–4: Authorization foundation

- [ ] OAuth state, encryption, reconnect, and cleanup tests pass.
- [ ] No callback replay or tenant crossover can replace credentials.
- [ ] Review security boundary before enabling Picker.

### After Tasks 5–7: Functional integration

- [ ] A private selected spreadsheet can be read as a catalogue source.
- [ ] An approved order is written exactly once to a selected destination.
- [ ] Revoked authorization preserves products and orders.

### After Tasks 8–9: Production readiness

- [ ] Owner completes the flow without handling keys or JSON credentials.
- [ ] All tests/typechecks/images pass.
- [ ] Google verification and staging acceptance evidence are complete.
