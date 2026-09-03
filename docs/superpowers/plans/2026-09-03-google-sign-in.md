# Google Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add identity-only Google sign-in that logs in or safely links existing users and onboards a new tenant owner by collecting a business name.

**Architecture:** A dedicated Google OpenID Connect flow lives beside, but never shares state or credentials with, the tenant Google Sheets flow. The API validates a one-time hashed state and Google ID token, then either issues the existing AutoSale session or issues a protected onboarding grant that atomically creates the user, tenant, owner membership, and identity.

**Tech Stack:** TypeScript, NestJS, Next.js 16/React, Prisma/PostgreSQL, Zod, `google-auth-library`, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-03-google-sign-in-design.md`

## Global Constraints

- Google sign-in requests exactly `openid email profile`; it never requests or stores Drive/Sheets authorization.
- Raw OAuth state, authorization codes, ID/access/refresh tokens, and onboarding grants must never be persisted or logged.
- Automatic linking is allowed only for an exact normalized match to a Google-verified email.
- Existing password registration, verification, login, reset, invitations, admin auth, and tenant Google Sheets authorization remain functional.
- All public redirects accept only safe local application paths and fall back to `/conversations`.
- PostgreSQL uniqueness and transactions, not browser state, enforce identity ownership and idempotency.
- Production rollout is guarded by `GOOGLE_SIGN_IN_ENABLED`; disabled or incomplete configuration exposes no Google sign-in action.

## File structure

- `packages/database/prisma/schema.prisma` and a generated migration own nullable passwords, Google identities, and sign-in attempts.
- `packages/integrations/src/google-sign-in.ts` owns provider URLs, code exchange, and ID-token verification behind `GoogleSignInClientPort`.
- `apps/api/src/auth/google-sign-in-state.service.ts` owns hashed state/onboarding grants and safe local return paths.
- `apps/api/src/auth/google-sign-in.service.ts` owns linked login, verified-email linking, onboarding, and audit decisions.
- `apps/api/src/auth/google-sign-in.controller.ts` owns public HTTP redirects/cookies/rate limits; existing password endpoints remain in `auth.controller.ts`.
- `apps/web/src/components/google-sign-in-button.tsx` owns start-flow interaction; `google-onboarding-form.tsx` owns business-name submission.
- `apps/web/app/(auth)/onboarding/google/page.tsx` owns the onboarding route.
- Existing auth forms only compose the new button and separator; provider logic does not enter `auth-form.tsx`.

---

### Task 1: Add sign-in configuration and provider client

**Files:**
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Create: `packages/integrations/src/google-sign-in.ts`
- Create: `packages/integrations/src/google-sign-in.spec.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Produces: `GoogleSignInClientPort.getAuthorizationUrl({ state }): string`.
- Produces: `GoogleSignInClientPort.exchangeAndVerify(code): Promise<GoogleSignInIdentity>` where identity is `{ subject: string; email: string; name: string }`.
- Produces config fields `GOOGLE_SIGN_IN_ENABLED`, `GOOGLE_SIGN_IN_REDIRECT_URI`; reuses the server-only Google OAuth client ID and secret.

- [ ] **Step 1: Write failing configuration tests**

Add cases proving the flag defaults to `false`, enabling requires client ID, secret, and sign-in redirect URI, and production rejects an HTTP redirect:

```ts
expect(parseApiEnv(base)).toMatchObject({ GOOGLE_SIGN_IN_ENABLED: false });
expect(() => parseApiEnv({ ...base, GOOGLE_SIGN_IN_ENABLED: 'true' })).toThrow(/Google Sign-In configuration/);
expect(() => parseApiEnv({
  ...base,
  NODE_ENV: 'production',
  GOOGLE_SIGN_IN_ENABLED: 'true',
  GOOGLE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_SIGN_IN_REDIRECT_URI: 'http://sales-aito.com/api/auth/google/callback',
})).toThrow(/HTTPS/);
```

- [ ] **Step 2: Run the config test and verify RED**

Run: `pnpm --filter @autosale/config test -- src/api-env.spec.ts`

Expected: FAIL because the sign-in fields do not exist.

- [ ] **Step 3: Implement conditional environment validation**

Add:

```ts
GOOGLE_SIGN_IN_ENABLED: z.string().optional().transform((value) => value === 'true').default(false),
GOOGLE_SIGN_IN_REDIRECT_URI: optionalUrl,
```

In `superRefine`, require client ID, client secret, and the dedicated redirect when enabled; require HTTPS in production.

- [ ] **Step 4: Write failing provider-client tests**

Assert the authorization URL has `scope=openid email profile`, `response_type=code`, the dedicated redirect and state, and does not contain Drive/Sheets scopes. Mock code exchange with an ID token; assert rejection for wrong audience, issuer, expiry, missing subject, and `email_verified=false`.

```ts
expect(new URL(client.getAuthorizationUrl({ state: 'opaque' })).searchParams.get('scope'))
  .toBe('openid email profile');
await expect(client.exchangeAndVerify('code')).resolves.toEqual({
  subject: 'google-subject', email: 'owner@example.com', name: 'Owner',
});
```

- [ ] **Step 5: Run provider tests and verify RED**

Run: `pnpm --filter @autosale/integrations test -- src/google-sign-in.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement the provider client**

Use `OAuth2Client.generateAuthUrl`, `getToken`, and `verifyIdToken({ idToken, audience: clientId })`. Accept only `accounts.google.com` or `https://accounts.google.com`, require unexpired claims, a non-empty `sub`, normalized email, `email_verified === true`, and return no token fields.

```ts
export type GoogleSignInIdentity = { subject: string; email: string; name: string };
export interface GoogleSignInClientPort {
  getAuthorizationUrl(input: { state: string }): string;
  exchangeAndVerify(code: string): Promise<GoogleSignInIdentity>;
}
```

- [ ] **Step 7: Run focused tests and commit**

Run: `pnpm --filter @autosale/config test && pnpm --filter @autosale/integrations test`

Commit:

```bash
git add packages/config packages/integrations
git commit -m "feat(auth): add Google identity provider client"
```

### Task 2: Persist Google identities and one-time attempts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260903190000_google_sign_in/migration.sql`
- Modify: `packages/database/src/index.ts` only if generated exports require it
- Create: `apps/api/src/auth/google-sign-in-migration.spec.ts`
- Modify: generated Prisma client files via the repository's Prisma generation command

**Interfaces:**
- Produces Prisma models `GoogleIdentity` and `GoogleSignInAttempt`.
- Changes `User.passwordHash` from `String` to `String?`.
- `GoogleSignInAttempt` carries hashes and minimal verified claims until consumed.

- [ ] **Step 1: Write a failing PostgreSQL migration test**

Follow existing isolated migration tests. Apply migrations to a temporary schema and prove:

```sql
INSERT INTO users (id, email, name, password_hash, status, email_verified_at, updated_at)
VALUES (gen_random_uuid(), 'google@example.com', 'Google Owner', NULL, 'ACTIVE', now(), now());
```

Also prove duplicate `google_subject`, duplicate `user_id`, and duplicate `state_token_hash` fail.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `pnpm --filter @autosale/api test -- src/auth/google-sign-in-migration.spec.ts`

Expected: FAIL because the columns/tables are absent.

- [ ] **Step 3: Add schema and migration**

Add relations to `User` and these models:

```prisma
model GoogleIdentity {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @unique @map("user_id") @db.Uuid
  googleSubject String   @unique @map("google_subject")
  emailAtLink   String   @map("email_at_link")
  createdAt     DateTime @default(now()) @map("created_at")
  lastUsedAt    DateTime @default(now()) @map("last_used_at")
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("google_identities")
}

model GoogleSignInAttempt {
  id                  String    @id @default(uuid()) @db.Uuid
  stateTokenHash      String    @unique @map("state_token_hash")
  returnPath          String    @default("/conversations") @map("return_path")
  stateExpiresAt      DateTime  @map("state_expires_at")
  stateUsedAt         DateTime? @map("state_used_at")
  onboardingTokenHash String?   @unique @map("onboarding_token_hash")
  onboardingExpiresAt DateTime? @map("onboarding_expires_at")
  onboardingUsedAt    DateTime? @map("onboarding_used_at")
  googleSubject       String?   @map("google_subject")
  verifiedEmail       String?   @map("verified_email")
  displayName         String?   @map("display_name")
  createdAt           DateTime  @default(now()) @map("created_at")
  @@index([stateExpiresAt, stateUsedAt])
  @@index([onboardingExpiresAt, onboardingUsedAt])
  @@map("google_sign_in_attempts")
}
```

- [ ] **Step 4: Generate Prisma and run migration tests**

Run: `pnpm db:generate && pnpm --filter @autosale/api test -- src/auth/google-sign-in-migration.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database apps/api/src/auth/google-sign-in-migration.spec.ts
git commit -m "feat(auth): persist Google sign-in identities"
```

### Task 3: Protect OAuth state and onboarding grants

**Files:**
- Create: `apps/api/src/auth/google-sign-in-state.service.ts`
- Create: `apps/api/src/auth/google-sign-in-state.service.spec.ts`

**Interfaces:**
- Produces `createAttempt(returnPath?): Promise<{ state: string }>`.
- Produces `consumeState(state): Promise<{ attemptId: string; returnPath: string }>`.
- Produces `armOnboarding(attemptId, identity): Promise<{ grant: string; expiresAt: Date }>`.
- Produces `readOnboarding(grant)` and `consumeOnboarding(grant)` with minimal verified claims.

- [ ] **Step 1: Write failing state-service tests**

Cover SHA-256 hashing, 10-minute state expiry, 15-minute onboarding expiry, one-time consumption, replay rejection, and safe return paths. Include malicious values `//evil.example`, `\\evil`, control characters, `/login`, and `/onboarding/google`; each must normalize to `/conversations`.

- [ ] **Step 2: Run the state test and verify RED**

Run: `pnpm --filter @autosale/api test -- src/auth/google-sign-in-state.service.spec.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement atomic state/grant operations**

Use `randomBytes(32).toString('base64url')`, persist only `sha256(raw)`, and claim records with `updateManyAndReturn` predicates on unused and unexpired timestamps. Clear verified claims when onboarding is consumed.

```ts
export type PendingGoogleIdentity = {
  attemptId: string;
  returnPath: string;
  subject: string;
  email: string;
  name: string;
};
```

- [ ] **Step 4: Run test and commit**

Run: `pnpm --filter @autosale/api test -- src/auth/google-sign-in-state.service.spec.ts`

Commit:

```bash
git add apps/api/src/auth/google-sign-in-state.service.*
git commit -m "feat(auth): protect Google sign-in state"
```

### Task 4: Implement linked sign-in, verified-email linking, and onboarding

**Files:**
- Create: `apps/api/src/auth/google-sign-in.service.ts`
- Create: `apps/api/src/auth/google-sign-in.service.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.service.spec.ts`
- Modify: `apps/api/src/auth/session.service.ts` only to reuse a public session-result helper if duplication appears

**Interfaces:**
- Consumes the provider and state interfaces from Tasks 1 and 3.
- Produces `start(returnPath)`, `completeCallback({ state, code, denied }, metadata)`, `onboardingSummary(grant)`, and `completeOnboarding({ grant, tenantName }, metadata)`.
- Callback result is `{ kind: 'SESSION'; sessionResult; returnPath } | { kind: 'ONBOARDING'; grant; expiresAt }`.

- [ ] **Step 1: Add nullable-password regression test**

```ts
prisma.user.findUnique.mockResolvedValue({ ...activeUser, passwordHash: null, memberships: [] });
await expect(auth.login({ email: activeUser.email, password: 'irrelevant password' }, {}))
  .rejects.toThrow('Invalid credentials');
expect(crypto.verifyPassword).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run auth test and verify RED, then implement the null guard**

Run: `pnpm --filter @autosale/api test -- src/auth/auth.service.spec.ts`

Implement `const valid = user?.passwordHash ? await this.crypto.verifyPassword(...) : false;`, rerun, and expect PASS.

- [ ] **Step 3: Write failing Google service tests**

Cover:

- linked subject updates `lastUsedAt` and creates a session;
- new subject plus active matching verified email creates one `GoogleIdentity` and a security audit event;
- new email returns onboarding without creating a user or tenant;
- subject/user uniqueness conflicts fail with a neutral error;
- onboarding transaction creates active user, verified email timestamp, tenant, active owner membership, identity, and session;
- concurrent onboarding completion produces one workspace;
- provider denial and disabled feature do not mutate accounts;
- sign-in never creates or updates `GoogleConnection`.

- [ ] **Step 4: Run service test and verify RED**

Run: `pnpm --filter @autosale/api test -- src/auth/google-sign-in.service.spec.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 5: Implement the orchestration service**

Use Prisma transactions for linking and onboarding. Normalize email with `trim().toLowerCase()`. Only link users with `status: 'ACTIVE'` and `emailVerifiedAt != null`. Generate tenant key with the existing slug plus random suffix. Write `SecurityAuditLog` events with subject/email represented only by non-reversible hashes in metadata.

- [ ] **Step 6: Run focused service tests and commit**

Run: `pnpm --filter @autosale/api test -- src/auth/auth.service.spec.ts src/auth/google-sign-in.service.spec.ts`

Commit:

```bash
git add apps/api/src/auth
git commit -m "feat(auth): sign in and onboard Google users"
```

### Task 5: Expose HTTP routes, cookies, and dependency wiring

**Files:**
- Create: `apps/api/src/auth/google-sign-in.controller.ts`
- Create: `apps/api/src/auth/google-sign-in.controller.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts` if required by current module assembly
- Modify: `.env.example`
- Modify: `compose.yaml`

**Interfaces:**
- Produces public endpoints from the spec.
- Uses `autosale_google_onboarding` as a dedicated HttpOnly, Secure-in-production, SameSite=Lax cookie scoped to `/` and expiring with the grant.

- [ ] **Step 1: Write failing controller tests**

Prove:

- `POST /start` is public, rate-limited by IP, and returns only `authorizationUrl`;
- callback success sets the normal session cookie and redirects safely;
- new-user callback sets only the onboarding cookie and redirects to `/onboarding/google`;
- callback cancellation redirects to `/login?google=cancelled`;
- onboarding summary never returns a grant or subject;
- onboarding completion reads the HttpOnly cookie, sets the session cookie, clears onboarding cookie, and returns the public session;
- replay/expiry returns a neutral 401/400 response without secrets.

- [ ] **Step 2: Run controller test and verify RED**

Run: `pnpm --filter @autosale/api test -- src/auth/google-sign-in.controller.spec.ts`

Expected: FAIL because the controller is absent.

- [ ] **Step 3: Implement controller and module wiring**

Use Zod schemas:

```ts
const startSchema = z.object({ returnPath: z.string().max(512).optional() }).strict();
const onboardingSchema = z.object({ tenantName: z.string().trim().min(2).max(120) }).strict();
```

Reuse the existing session-cookie options. Mark start, callback, and onboarding routes `@Public`; ensure state-changing JSON posts use the intended CSRF model or an unguessable one-time onboarding grant, documented in the controller test.

- [ ] **Step 4: Wire environment variables**

Add disabled defaults to `.env.example` and Compose:

```dotenv
GOOGLE_SIGN_IN_ENABLED=false
GOOGLE_SIGN_IN_REDIRECT_URI=https://sales-aito.com/api/auth/google/callback
```

Do not duplicate or expose the Google client secret in web build arguments.

- [ ] **Step 5: Run API and config tests, then commit**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/config test`

Commit:

```bash
git add apps/api .env.example compose.yaml
git commit -m "feat(auth): expose Google sign-in endpoints"
```

### Task 6: Add Google buttons and business-name onboarding UI

**Files:**
- Create: `apps/web/src/components/google-sign-in-button.tsx`
- Create: `apps/web/src/components/google-sign-in-button.spec.tsx`
- Create: `apps/web/src/components/google-onboarding-form.tsx`
- Create: `apps/web/src/components/google-onboarding-form.spec.tsx`
- Create: `apps/web/app/(auth)/onboarding/google/page.tsx`
- Create: `apps/web/app/(auth)/onboarding/google/page.spec.tsx`
- Modify: `apps/web/src/components/auth-form.tsx`
- Modify: `apps/web/src/components/auth-form.spec.tsx`
- Modify: `apps/web/app/(auth)/login/page.tsx`
- Modify: `apps/web/app/(auth)/register/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/proxy.ts` and its test if onboarding route protection requires an exception

**Interfaces:**
- `GoogleSignInButton({ returnPath?: string })` posts to start and navigates to the returned Google URL.
- `GoogleOnboardingForm({ email, suggestedName })` posts `{ tenantName }`, then navigates to `/conversations`.

- [ ] **Step 1: Write failing Google-button tests**

Assert login and register render **Продовжити з Google**, preserve only a safe `next`, disable during start, navigate on success, and show a neutral error without replacing password forms.

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm --filter @autosale/web test -- src/components/google-sign-in-button.spec.tsx src/components/auth-form.spec.tsx`

Expected: FAIL because the button is absent.

- [ ] **Step 3: Implement the button and compose it into auth forms**

Render an accessible separator labelled `або`; use the existing CSRF-aware request utility only if the endpoint requires it, and use `window.location.assign(authorizationUrl)` after validating the response is an HTTPS Google authorization URL.

- [ ] **Step 4: Write failing onboarding tests**

Assert the route:

- fetches limited onboarding context;
- shows verified email as text, never an editable email input;
- requires a 2–120 character business name;
- submits only `{ tenantName }`;
- redirects after success;
- offers **Почати знову** linking to `/login` when expired.

- [ ] **Step 5: Run onboarding tests and verify RED**

Run: `pnpm --filter @autosale/web test -- src/components/google-onboarding-form.spec.tsx 'app/(auth)/onboarding/google/page.spec.tsx'`

Expected: FAIL because the route and component are absent.

- [ ] **Step 6: Implement onboarding route, form, styling, and proxy behavior**

Keep the screen inside `AuthFrame`, ask only for `Назва бізнесу`, and provide loading, submitting, validation, expired, and provider-error states. Ensure unauthenticated onboarding is reachable only with a valid server-side onboarding cookie.

- [ ] **Step 7: Run web tests/build and commit**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web build`

Commit:

```bash
git add apps/web
git commit -m "feat(auth): add Google sign-in onboarding UI"
```

### Task 7: Document Google Cloud setup and validate the complete separation

**Files:**
- Create: `docs/integrations/google-sign-in.md`
- Modify: `docs/integrations/google-sheets-access.md`
- Modify: `README.md`
- Modify: `tasks/todo.md`
- Create: `tests/e2e/google-sign-in.spec.ts` if the existing browser harness is present; otherwise add the equivalent API integration spec under `apps/api/src/auth/`

**Interfaces:**
- Produces an operator checklist for the exact production callback and rollback flag.
- Produces end-to-end evidence that identity auth and Sheets authorization remain independent.

- [ ] **Step 1: Add integration/acceptance tests**

Cover a password account automatically linked by verified email, a new Google user completing one workspace, subsequent linked login, logout, first password reset, replayed callback/grant, and confirmation that `google_connections` remains unchanged throughout identity sign-in.

- [ ] **Step 2: Run acceptance tests and verify RED or PASS for only intentionally completed behavior**

Run the repository E2E command when available; otherwise run:

`pnpm --filter @autosale/api test -- src/auth/google-sign-in.e2e.spec.ts`

- [ ] **Step 3: Write the operator instructions**

Document:

- Google Cloud project `sage-ripple-261508`;
- authorized origin `https://sales-aito.com`;
- redirect `https://sales-aito.com/api/auth/google/callback`;
- identity scopes `openid email profile`;
- enabling `GOOGLE_SIGN_IN_ENABLED=true` only after the callback is saved;
- smoke tests for existing-user linking and new-workspace onboarding;
- rollback by setting the flag to `false` and rebuilding without touching identities, sessions, passwords, or Sheets credentials.

- [ ] **Step 4: Mark task checklist items only from evidence**

Update Tasks 29–34 checkboxes individually. Leave Google Console/manual rollout items unchecked until observed in production.

- [ ] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm -r build
docker compose --env-file ../.env config --quiet
docker compose --env-file ../.env build
git diff --check
```

Expected: every command exits 0; no test, typecheck, production build, Compose validation, or whitespace failure.

- [ ] **Step 6: Commit the documentation and acceptance evidence**

```bash
git add docs README.md tasks tests apps/api/src/auth
git commit -m "docs(auth): add Google sign-in rollout guide"
```

### Task 8: Configure and smoke-test production

**Files:**
- Modify locally only: repository-root `.env` (never commit)
- No source file changes unless the smoke test exposes a defect

**Interfaces:**
- Consumes the production OAuth client and callback configured in Task 7.
- Produces a live, reversible Google sign-in deployment at `https://sales-aito.com`.

- [ ] **Step 1: Add the production callback in Google Cloud**

Add exactly `https://sales-aito.com/api/auth/google/callback` to the existing Web application OAuth client. Do not remove the Sheets callback.

- [ ] **Step 2: Enable local production configuration**

Set `GOOGLE_SIGN_IN_ENABLED=true` and `GOOGLE_SIGN_IN_REDIRECT_URI=https://sales-aito.com/api/auth/google/callback` in the uncommitted root `.env`.

- [ ] **Step 3: Rebuild and inspect health**

Run:

```bash
docker compose --env-file ../.env up -d --build
docker compose --env-file ../.env ps
```

Expected: API, web, worker, PostgreSQL, Redis, and MinIO are healthy; Cloudflare tunnel and proxy are running.

- [ ] **Step 4: Smoke-test both user paths**

In a browser, verify an existing password user with the same Google email is linked without duplication. Then use a separate Google test email to complete business-name onboarding and verify exactly one tenant and active owner membership.

- [ ] **Step 5: Verify privacy and integration separation**

Query only counts and IDs needed for evidence. Confirm no Google sign-in token exists in PostgreSQL/logs and no `GoogleConnection` was created for the new tenant before the owner explicitly connects Sheets.

- [ ] **Step 6: Record rollout evidence and push master**

Mark the remaining Task 34 and checkpoint items supported by observed evidence, commit that checklist update, and push `master`.

