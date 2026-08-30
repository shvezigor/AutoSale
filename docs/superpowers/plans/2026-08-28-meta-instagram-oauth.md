# Meta Instagram OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each tenant owner securely connect, inspect, reconnect, and disconnect an Instagram Business or Creator account through Meta OAuth while the local Docker deployment is reachable through a stable ngrok HTTPS domain.

**Architecture:** A narrow Meta OAuth adapter owns provider HTTP calls, while NestJS owns one-time OAuth state, encrypted credential persistence, authorization, and safe API responses. The Next.js settings card starts server redirects and shows connection state; the existing verified webhook path continues routing by the unique Instagram account ID.

**Tech Stack:** TypeScript, NestJS 11, Next.js 16/React 19, Prisma 7/PostgreSQL, Node `crypto`, Vitest, Docker Compose, Caddy, ngrok, Meta Instagram API with Instagram Login

**Spec:** `docs/superpowers/specs/2026-08-28-meta-instagram-oauth-design.md`

## Global Constraints

- Support Instagram Professional Business and Creator accounts; personal accounts are unsupported.
- Request only `instagram_business_basic` and `instagram_business_manage_messages` for this release.
- Use a pinned `META_GRAPH_API_VERSION`; never silently switch versions.
- Never expose authorization codes, access tokens, decrypted credentials, or Meta app secrets to frontend JavaScript or ordinary logs.
- Only a tenant `OWNER` may connect, reconnect, or disconnect Instagram.
- A platform administrator sees operational status only and never client conversations, customer data, or credentials.
- Encrypt tokens with AES-256-GCM and a random nonce; keep `INTEGRATION_ENCRYPTION_KEY` outside Git and the database.
- Keep `/webhooks/meta` verification, signature validation, durable registration, deduplication, and tenant routing intact.
- Use `APP_PUBLIC_URL` as the single public origin for callback construction.
- Follow TDD: observe every new test fail for the expected reason before implementation.

---

## File Structure

- `packages/database/prisma/schema.prisma`: persistent OAuth state and encrypted Instagram connection metadata.
- `packages/database/prisma/migrations/20260828_meta_instagram_oauth/migration.sql`: reversible schema migration preserving existing account IDs.
- `packages/config/src/api-env.ts`: typed Meta OAuth and encryption configuration.
- `packages/integrations/src/meta-instagram.ts`: provider-independent request/response types and Meta HTTP adapter.
- `apps/api/src/integrations/credential-cipher.ts`: versioned AES-256-GCM token encryption.
- `apps/api/src/integrations/instagram-oauth-state.service.ts`: create and atomically consume tenant-bound OAuth state.
- `apps/api/src/integrations/instagram-oauth.service.ts`: orchestration of authorization, callback, persistence, subscription, and disconnect.
- `apps/api/src/integrations/instagram-oauth.controller.ts`: owner-only connect/disconnect plus public callback endpoints.
- `apps/api/src/integrations/instagram-oauth.module.ts`: dependency wiring.
- `packages/contracts/src/instagram.ts`: safe public connection response schemas.
- `apps/web/src/components/instagram-settings-form.tsx`: connection-state UI.
- `docs/integrations/meta-instagram-oauth.md`: Ukrainian ngrok and Meta Developer App setup/runbook.

---

### Task 1: Persist OAuth State and Encrypted Connection Metadata

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260828_meta_instagram_oauth/migration.sql`
- Regenerate: `packages/database/src/generated/prisma/**`

**Interfaces:**
- Produces: `InstagramOAuthState` with `tokenHash`, `tenantId`, `userId`, `returnPath`, `expiresAt`, and `usedAt`.
- Produces: nullable OAuth fields on `InstagramConnection`: `encryptedAccessToken`, `tokenExpiresAt`, `grantedScopes`, `lastVerifiedAt`, `lastErrorCode`, `connectedByUserId`, `disconnectedAt`.

- [ ] **Step 1: Add schema expectations before generation**

Add a dedicated enum and model, retaining `externalAccountId` so existing webhook routing remains compatible:

```prisma
enum InstagramConnectionStatus {
  LEGACY
  ACTIVE
  REAUTH_REQUIRED
  ERROR
  DISCONNECTED
}

model InstagramOAuthState {
  id         String    @id @default(uuid()) @db.Uuid
  tokenHash  String    @unique @map("token_hash")
  tenantId   String    @map("tenant_id") @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  returnPath String    @default("/settings") @map("return_path")
  expiresAt  DateTime  @map("expires_at")
  usedAt     DateTime? @map("used_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  tenant     Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([expiresAt, usedAt])
  @@map("instagram_oauth_states")
}
```

Change `InstagramConnection.status` to `InstagramConnectionStatus @default(LEGACY)` and add the nullable metadata fields from the Interfaces block. Add inverse relations to `Tenant` and `User`.

- [ ] **Step 2: Generate and inspect the migration**

Run:

```powershell
pnpm --filter @autosale/database exec prisma migrate dev --name meta_instagram_oauth --create-only
```

Expected: SQL creates the enum/state table and adds nullable columns without deleting existing connection rows. Ensure the SQL maps all existing connections to `LEGACY` before removing the old enum dependency.

- [ ] **Step 3: Generate the Prisma client and typecheck**

Run:

```powershell
pnpm --filter @autosale/database generate
pnpm --filter @autosale/database typecheck
```

Expected: both commands pass.

- [ ] **Step 4: Commit**

```powershell
git add packages/database
git commit -m "feat: persist Instagram OAuth credentials"
```

### Task 2: Validate Deployment Configuration and Encrypt Tokens

**Files:**
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Create: `apps/api/src/integrations/credential-cipher.ts`
- Create: `apps/api/src/integrations/credential-cipher.spec.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`

**Interfaces:**
- Produces: `CredentialCipher.encrypt(plaintext: string): string`.
- Produces: `CredentialCipher.decrypt(payload: string): string`.
- Produces config fields `META_APP_ID`, `META_GRAPH_API_VERSION`, and base64 `INTEGRATION_ENCRYPTION_KEY` decoding to exactly 32 bytes.

- [ ] **Step 1: Write failing configuration tests**

Extend the valid fixture and assert malformed keys fail:

```ts
META_APP_ID: '123456789012345',
META_GRAPH_API_VERSION: 'v23.0',
INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
```

```ts
expect(() => parseApiEnv({ ...validEnv, INTEGRATION_ENCRYPTION_KEY: 'short' })).toThrow();
expect(() => parseApiEnv({ ...validEnv, META_GRAPH_API_VERSION: 'latest' })).toThrow();
```

- [ ] **Step 2: Run the config test and verify failure**

Run: `pnpm --filter @autosale/config test -- api-env.spec.ts`
Expected: FAIL because the three fields are not in `apiEnvSchema`.

- [ ] **Step 3: Add strict environment schemas**

Add:

```ts
META_APP_ID: z.string().regex(/^\d{5,32}$/),
META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/),
INTEGRATION_ENCRYPTION_KEY: z.string().refine(
  (value) => Buffer.from(value, 'base64').length === 32,
  'must decode to 32 bytes',
),
```

- [ ] **Step 4: Write failing cipher tests**

Test round-trip, randomized ciphertext, tamper rejection, and version rejection:

```ts
const cipher = new CredentialCipher(Buffer.alloc(32, 7));
expect(cipher.decrypt(cipher.encrypt('secret-token'))).toBe('secret-token');
expect(cipher.encrypt('secret-token')).not.toBe(cipher.encrypt('secret-token'));
expect(() => cipher.decrypt(tamperedPayload)).toThrow('Invalid encrypted credential');
```

- [ ] **Step 5: Run the cipher test and verify failure**

Run: `pnpm --filter @autosale/api test -- credential-cipher.spec.ts`
Expected: FAIL because `CredentialCipher` does not exist.

- [ ] **Step 6: Implement versioned AES-256-GCM encryption**

Encode `v1.<nonce-base64url>.<ciphertext-base64url>.<tag-base64url>`, use `randomBytes(12)`, `createCipheriv('aes-256-gcm', key, nonce)`, and normalize every parse/authentication error to `Invalid encrypted credential` without including payload data.

- [ ] **Step 7: Wire placeholders and verify**

Add the three variables to `.env.example` and API environment forwarding in `compose.yaml`. Run:

```powershell
pnpm --filter @autosale/config test
pnpm --filter @autosale/api test -- credential-cipher.spec.ts
pnpm --filter @autosale/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/config apps/api/src/integrations .env.example compose.yaml
git commit -m "feat: encrypt integration credentials"
```

### Task 3: Add the Meta Instagram API Adapter

**Files:**
- Create: `packages/integrations/src/meta-instagram.ts`
- Create: `packages/integrations/src/meta-instagram.spec.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Produces: `MetaInstagramClient.getAuthorizationUrl(input: { state: string; redirectUri: string }): string`.
- Produces: `exchangeCode(input: { code: string; redirectUri: string }): Promise<{ accessToken: string; expiresIn: number | null }>`.
- Produces: `getIdentity(accessToken: string): Promise<{ accountId: string; username: string | null }>`.
- Produces: `subscribe(accessToken: string): Promise<void>`, `unsubscribe(accessToken: string): Promise<void>`, and `revoke(accessToken: string): Promise<void>`.

- [ ] **Step 1: Write failing adapter tests with injected fetch**

Assert the authorization URL includes the exact scopes and callback, token exchanges use POST without putting the app secret in logs/errors, identity uses `graph.instagram.com`, and non-2xx errors become `MetaInstagramError` with only `status` and provider `code`.

```ts
expect(url.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_messages');
expect(url.searchParams.get('state')).toBe('one-time-state');
expect(url.searchParams.get('redirect_uri')).toBe('https://demo.ngrok-free.app/api/integrations/instagram/callback');
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm --filter @autosale/integrations test -- meta-instagram.spec.ts`
Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement the adapter**

Constructor:

```ts
constructor(config: {
  appId: string;
  appSecret: string;
  graphVersion: string;
  fetch?: typeof fetch;
})
```

Use `URL`/`URLSearchParams`, explicit timeouts with `AbortSignal.timeout(10_000)`, JSON shape guards, and a sanitized error class. Export the client and its types from `packages/integrations/src/index.ts`.

- [ ] **Step 4: Verify**

Run:

```powershell
pnpm --filter @autosale/integrations test
pnpm --filter @autosale/integrations typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/integrations
git commit -m "feat: add Meta Instagram API adapter"
```

### Task 4: Implement Single-Use OAuth State

**Files:**
- Create: `apps/api/src/integrations/instagram-oauth-state.service.ts`
- Create: `apps/api/src/integrations/instagram-oauth-state.service.spec.ts`

**Interfaces:**
- Produces: `create(input: { tenantId: string; userId: string; returnPath?: string }): Promise<string>`.
- Produces: `consume(rawState: string): Promise<{ tenantId: string; userId: string; returnPath: string }>`.
- Uses SHA-256 hashes; raw state is returned once and never persisted.

- [ ] **Step 1: Write failing state lifecycle tests**

Cover creation, stored hash rather than raw value, successful consumption, second-use rejection, expired-state rejection, and unsafe return-path normalization to `/settings`.

```ts
const raw = await service.create({ tenantId, userId, returnPath: '/settings?tab=instagram' });
expect(stored.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
await expect(service.consume(raw)).resolves.toMatchObject({ tenantId, userId });
await expect(service.consume(raw)).rejects.toThrow('Invalid or expired OAuth state');
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @autosale/api test -- instagram-oauth-state.service.spec.ts`
Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement state creation and atomic consumption**

Generate 32 random bytes as base64url, persist SHA-256 with a 10-minute expiry, and consume with a transaction/conditional update where `usedAt IS NULL` and `expiresAt > now`. Accept return paths only when they start with one `/` and not `//`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @autosale/api test -- instagram-oauth-state.service.spec.ts`
Expected: PASS.

```powershell
git add apps/api/src/integrations/instagram-oauth-state.service*
git commit -m "feat: add single-use Instagram OAuth state"
```

### Task 5: Orchestrate Connection, Callback, and Disconnect

**Files:**
- Create: `packages/contracts/src/instagram.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/integrations/instagram-oauth.service.ts`
- Create: `apps/api/src/integrations/instagram-oauth.service.spec.ts`
- Create: `apps/api/src/integrations/instagram-oauth.controller.ts`
- Create: `apps/api/src/integrations/instagram-oauth.controller.spec.ts`
- Create: `apps/api/src/integrations/instagram-oauth.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Remove after replacement: `apps/api/src/settings/instagram-settings.controller.ts`
- Remove after replacement: `apps/api/src/settings/instagram-settings.module.ts`
- Refactor: `apps/api/src/settings/instagram-settings.service.ts`

**Interfaces:**
- Produces safe summary `{ status, accountId, username, tokenExpiresAt, lastVerifiedAt, lastErrorCode, cleanupStatus, cleanupErrorCode }` with no credential field.
- Produces owner endpoints from the spec and a public, CSRF-exempt GET callback.
- Consumes Task 2 cipher, Task 3 Meta client, and Task 4 state service.

- [ ] **Step 1: Define and test the safe response contract**

Create a strict Zod schema with statuses `NOT_CONNECTED`, `LEGACY`, `ACTIVE`, `REAUTH_REQUIRED`, `ERROR`, `DISCONNECTED`; nullable timestamps use ISO datetime strings. Verify unknown fields such as `encryptedAccessToken` are rejected.

- [ ] **Step 2: Write failing orchestration tests**

Test that connect returns a Meta URL tied to state; callback consumes state before exchange, encrypts the token, stores the account, subscribes it, and records `ACTIVE`; account ID collision with another tenant fails closed; disconnect disables locally even when remote cleanup fails; summaries omit credentials.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm --filter @autosale/api test -- instagram-oauth.service.spec.ts`
Expected: FAIL because the orchestration service is missing.

- [ ] **Step 4: Implement the orchestration service**

Use the callback URI `${APP_PUBLIC_URL}/api/integrations/instagram/callback`. Persist only after identity validation, use an upsert scoped by `tenantId`, and translate Meta authorization errors into `REAUTH_REQUIRED` or `ERROR` without provider descriptions containing secrets.

- [ ] **Step 5: Write failing controller access tests**

Assert GET summary requires a tenant manager, connect/disconnect require `OWNER`, callback is public and CSRF-exempt, invalid callback redirects to `/settings?instagram=error`, and successful callback redirects to the state-bound local return path with `instagram=connected`.

- [ ] **Step 6: Implement controller and module wiring**

Use `@RequireMembership('MANAGER')` for the safe summary, `@RequireMembership('OWNER')` for mutations, and `@Public()` plus `@SkipCsrf()` only for the callback. Replace `InstagramSettingsModule` in `AppModule` with `InstagramOAuthModule`.

- [ ] **Step 7: Verify**

Run:

```powershell
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/api test
pnpm --filter @autosale/api typecheck
```

Expected: PASS, including existing webhook tenant-routing tests.

- [ ] **Step 8: Commit**

```powershell
git add packages/contracts apps/api/src
git commit -m "feat: connect Instagram accounts through Meta OAuth"
```

### Task 6: Replace Manual Instagram Settings UI

**Files:**
- Modify: `apps/web/src/components/instagram-settings-form.tsx`
- Modify: `apps/web/src/components/instagram-settings-form.spec.tsx`
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes the Task 5 safe summary and endpoints.
- Produces owner connect/reconnect/disconnect controls and manager read-only state.

- [ ] **Step 1: Write failing UI tests**

Test that `NOT_CONNECTED` shows `Підключити Instagram`; `ACTIVE` shows username and last verification; `REAUTH_REQUIRED` shows `Перепідключити`; managers have no mutation buttons; disconnect requires an explicit confirmation; no Account ID input exists.

```ts
expect(screen.getByRole('button', { name: 'Підключити Instagram' })).toBeInTheDocument();
expect(screen.queryByLabelText('Instagram Account ID')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @autosale/web test -- instagram-settings-form.spec.tsx`
Expected: FAIL because the current component renders manual fields.

- [ ] **Step 3: Implement the connection-state card**

The connect/reconnect button performs `POST /api/integrations/instagram/connect`, reads `{ authorizationUrl }`, and assigns `window.location.href`. Disconnect uses `mutatingFetch`, then replaces local state with the returned summary. Render sanitized error codes only and preserve accessible status text.

- [ ] **Step 4: Update server data loading and styles**

Fetch `GET /api/integrations/instagram` from the settings page with the authenticated cookie forwarding pattern already used there. Pass `membershipRole` so managers receive read-only rendering.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm --filter @autosale/web test
pnpm --filter @autosale/web typecheck
```

Expected: PASS.

```powershell
git add apps/web
git commit -m "feat: add Instagram connection settings UI"
```

### Task 7: Document ngrok and Meta Developer App Setup

**Files:**
- Create: `docs/integrations/meta-instagram-oauth.md`
- Modify: `docs/integrations/meta-access.md`
- Modify: `docs/operations/deployment.md`

**Interfaces:**
- Produces a Ukrainian, copy-pasteable local setup and acceptance checklist.

- [ ] **Step 1: Write the operator guide**

Include exact commands and variable mapping:

```powershell
ngrok config add-authtoken <NGROK_AUTHTOKEN>
ngrok http --url=<assigned-name>.ngrok-free.app 80
```

Document these Meta values:

```text
Redirect URI: https://<assigned-name>.ngrok-free.app/api/integrations/instagram/callback
Webhook callback: https://<assigned-name>.ngrok-free.app/webhooks/meta
Verify token: the exact local META_VERIFY_TOKEN value
Scopes: instagram_business_basic, instagram_business_manage_messages
```

Explain how to create the app, enable Instagram API with Instagram Login, add/accept Business and Creator testers, configure callbacks/webhooks, retrieve App ID/Secret safely, distinguish Development/Live mode and Standard/Advanced Access, and prepare for App Review.

- [ ] **Step 2: Add a secret-generation and launch section**

Use commands that do not print existing secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker compose up --build -d
docker compose ps
```

State that the generated value is copied into `INTEGRATION_ENCRYPTION_KEY` in `.env`, never committed, and must be backed up securely or existing tokens become unreadable.

- [ ] **Step 3: Add end-to-end acceptance checks**

Require successful OAuth redirect, active username in settings, Meta webhook verification, one real inbound test message, correct tenant routing, reconnect, disconnect, and confirmation that tokens are absent from browser responses and container logs.

- [ ] **Step 4: Validate documentation and commit**

Run:

```powershell
rg -n "META_APP_SECRET=|INTEGRATION_ENCRYPTION_KEY=" docs .env.example
git diff --check
```

Expected: documentation contains placeholders/instructions only, no real secret values; diff check passes.

```powershell
git add docs
git commit -m "docs: add Meta and ngrok connection guide"
```

### Task 8: Full Verification and Local Docker Acceptance

**Files:**
- Modify if required by failures: only files introduced or intentionally modified in Tasks 1–7
- Update: `docs/acceptance/mvp-checklist.md`

**Interfaces:**
- Produces a migration-tested, containerized build ready for real Meta test credentials.

- [ ] **Step 1: Run repository verification**

```powershell
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 2: Rebuild and inspect Docker services**

```powershell
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api
```

Expected: migration completes; proxy, web, API, worker, PostgreSQL, Redis, and MinIO are running/healthy; API logs contain no secrets.

- [ ] **Step 3: Verify local HTTP boundaries**

```powershell
curl.exe -i http://localhost/health/live
curl.exe -i http://localhost/api/integrations/instagram
```

Expected: health returns 200; unauthenticated integration summary returns 401.

- [ ] **Step 4: Run the ngrok/Meta manual checklist when credentials exist**

Start ngrok, update `APP_PUBLIC_URL`, restart API, then complete the Task 7 acceptance list. If credentials are not yet available, mark only the real-provider checks as externally blocked; do not claim live readiness.

- [ ] **Step 5: Record acceptance state and commit**

Update `docs/acceptance/mvp-checklist.md` with automated/local results and a dated, explicit pending line for any real Meta checks.

```powershell
git add docs/acceptance/mvp-checklist.md
git commit -m "test: verify Instagram OAuth deployment"
```

