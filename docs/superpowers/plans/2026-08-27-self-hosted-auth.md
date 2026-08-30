# Self-Hosted Tenant Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати self-hosted реєстрацію, email verification, session authentication, tenant roles, invitations і privacy-safe platform admin до AutoSale.

**Architecture:** NestJS видає opaque cookie sessions, зберігаючи в PostgreSQL лише hashes; глобальний guard формує server-side principal. Tenant services отримують `tenantId` з principal, Next.js виконує server-side auth redirects, а SMTP прихований за `EmailDelivery` interface.

**Tech Stack:** TypeScript, NestJS 11, Next.js 16, PostgreSQL 17, Prisma, Redis/BullMQ connection, Argon2id, Zod, Vitest, Testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-self-hosted-auth-design.md`

## Global Constraints

- Паролі хешуються Argon2id; plaintext пароль або token ніколи не зберігається.
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` у production; абсолютний session TTL — 30 днів.
- Request tenant scope походить тільки із server-side principal.
- PLATFORM_ADMIN не отримує conversations, messages, attachments, orders, extraction, контакти або адреси.
- Cross-tenant UUID lookup повертає `404`; role violation власного tenant повертає `403`.
- Production не повертає verification/invitation/reset URL і fail closed без email delivery.
- Кожна задача виконується red → green → refactor і завершується окремим комітом.

---

## File Structure

- `packages/database/prisma/schema.prisma` — auth entities і relations.
- `packages/database/prisma/migrations/20260827*_auth/` — additive auth migration.
- `packages/contracts/src/auth.ts` — request/response schemas без persistence details.
- `apps/api/src/auth/crypto.service.ts` — Argon2 password та opaque token hashing.
- `apps/api/src/auth/session.service.ts` — session lifecycle і principal resolution.
- `apps/api/src/auth/auth.service.ts` — register, verify, login, logout, reset orchestration.
- `apps/api/src/auth/auth.controller.ts` — public auth HTTP interface/cookies.
- `apps/api/src/auth/auth.guard.ts` — session/role enforcement decorators і principal.
- `apps/api/src/auth/csrf.service.ts` — synchronizer token validation.
- `apps/api/src/auth/rate-limit.service.ts` — Redis-backed sensitive-route limits.
- `apps/api/src/auth/email-delivery.ts` — SMTP/dev boundary.
- `apps/api/src/team/` — OWNER invitation/member management.
- `apps/api/src/admin/` — aggregate-only platform admin API.
- `apps/web/app/(auth)/` — register/login/verify/reset/invite pages.
- `apps/web/app/team/`, `apps/web/app/admin/` — protected role-specific pages.
- `apps/web/src/auth/` — server session client і auth form actions.
- `apps/api/src/cli/bootstrap-auth.ts` — stdin-only admin/current-tenant bootstrap.
- `tests/e2e/auth.spec.ts` — browser acceptance and isolation.

---

### Task 1: Auth schema, contracts and typed configuration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260827160000_self_hosted_auth/migration.sql`
- Create: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Modify: `.env.example`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `User`, `TenantMembership`, `Session`, `EmailVerificationToken`, `PasswordResetToken`, `TenantInvitation`, `SecurityAuditLog` Prisma models.
- Produces: `registerRequestSchema`, `loginRequestSchema`, `publicSessionSchema`, `AuthPrincipal`.
- Produces env: `SESSION_COOKIE_NAME`, `SESSION_PEPPER`, `AUTH_TOKEN_PEPPER`, `SMTP_*`, `APP_PUBLIC_URL`.

- [ ] **Step 1: Add failing config and contract tests**

```ts
expect(() => parseApiEnv({ ...validEnv, SESSION_PEPPER: 'short' })).toThrow();
expect(registerRequestSchema.safeParse({
  email: 'owner@example.com', password: 'correct horse battery',
  name: 'Owner', tenantName: 'Store',
}).success).toBe(true);
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm --filter @autosale/config test && pnpm --filter @autosale/contracts test`
Expected: FAIL because auth env/schema exports do not exist.

- [ ] **Step 3: Add models and contract schemas**

Use enums `PlatformRole { USER PLATFORM_ADMIN }`, `MembershipRole { OWNER MANAGER }`, `AccessStatus { PENDING ACTIVE BLOCKED }`. Add unique indexes for normalized email, token hashes, `(userId, tenantId)`, plus expiry/status indexes. Define `AuthPrincipal` as:

```ts
export interface AuthPrincipal {
  userId: string;
  email: string;
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  tenantId: string | null;
  membershipRole: 'OWNER' | 'MANAGER' | null;
  sessionId: string;
}
```

- [ ] **Step 4: Generate Prisma client and run tests/typecheck**

Run: `pnpm --filter @autosale/database prisma generate && pnpm --filter @autosale/config test && pnpm --filter @autosale/contracts test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database packages/contracts packages/config apps/api/package.json .env.example pnpm-lock.yaml
git commit -m "feat: add authentication domain schema"
```

---

### Task 2: Password, token and session primitives

**Files:**
- Create: `apps/api/src/auth/crypto.service.ts`
- Create: `apps/api/src/auth/crypto.service.spec.ts`
- Create: `apps/api/src/auth/session.service.ts`
- Create: `apps/api/src/auth/session.service.spec.ts`
- Create: `apps/api/src/auth/auth.types.ts`

**Interfaces:**
- Produces: `hashPassword(password): Promise<string>`, `verifyPassword(hash, password): Promise<boolean>`.
- Produces: `issueOpaqueToken(pepper): { raw: string; hash: string }` and `hashOpaqueToken(raw, pepper): string`.
- Produces: `SessionService.create(userId, tenantId, metadata)`, `resolve(rawToken)`, `revoke(sessionId)`, `revokeAllForUser(userId)`.

- [ ] **Step 1: Write failing crypto tests**

```ts
const hash = await crypto.hashPassword('long-secure-password');
expect(hash).not.toContain('long-secure-password');
expect(await crypto.verifyPassword(hash, 'long-secure-password')).toBe(true);
expect(await crypto.verifyPassword(hash, 'wrong-password')).toBe(false);
expect(crypto.hashOpaqueToken(raw, pepper)).toBe(hashOpaqueToken(raw, pepper));
```

- [ ] **Step 2: Run and confirm red**

Run: `pnpm --filter @autosale/api test crypto.service`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement Argon2id and SHA-256 HMAC token hashes**

Use `argon2.hash(password, { type: argon2.argon2id })`, `argon2.verify`, `randomBytes(32).toString('base64url')`, and `createHmac('sha256', pepper)`.

- [ ] **Step 4: Write failing session lifecycle tests**

```ts
const issued = await sessions.create(user.id, tenant.id, { ipPrefix: '127.0.0.0/24', userAgent: 'test' });
expect(await sessions.resolve(issued.rawToken)).toMatchObject({ userId: user.id, tenantId: tenant.id });
await sessions.revoke(issued.sessionId);
expect(await sessions.resolve(issued.rawToken)).toBeNull();
```

- [ ] **Step 5: Implement transactional session lifecycle and run tests**

Resolution must reject expired/revoked sessions, blocked users and blocked memberships; update `lastSeenAt` only when older than 15 minutes.

Run: `pnpm --filter @autosale/api test crypto.service session.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add secure password and session primitives"
```

---

### Task 3: Registration, verification, login and reset API

**Files:**
- Create: `apps/api/src/auth/email-delivery.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/auth.controller.spec.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces endpoints: `POST /api/auth/register`, `/verify-email`, `/login`, `/logout`, `/forgot-password`, `/reset-password`; `GET /api/auth/session`.
- Consumes `EmailDelivery.sendVerification`, `sendPasswordReset`, `sendInvitation`.

- [ ] **Step 1: Write failing service tests for register transaction and neutral errors**

```ts
const result = await auth.register(input, requestMeta);
expect(await prisma.tenant.count()).toBe(1);
expect(await prisma.tenantMembership.findFirst()).toMatchObject({ role: 'OWNER', status: 'PENDING' });
expect(email.sent[0]?.kind).toBe('verification');
expect(await auth.requestPasswordReset('missing@example.com')).toEqual({ accepted: true });
```

- [ ] **Step 2: Run red test**

Run: `pnpm --filter @autosale/api test auth.service`
Expected: FAIL with missing service.

- [ ] **Step 3: Implement service transactions and one-time token consumption**

Normalize email with `trim().toLowerCase()`. Use serializable Prisma transactions for register, verification and invitation acceptance. Hash all tokens before persistence. Production delivery failure rolls back token creation and returns `503`.

- [ ] **Step 4: Write controller cookie tests**

```ts
expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax');
expect(badEmail.status).toBe(badPassword.status);
expect(badEmail.body).toEqual(badPassword.body);
```

- [ ] **Step 5: Implement controllers and run focused suite**

Use a single safe `401 { code: 'INVALID_CREDENTIALS' }`; return dev preview URLs only when `NODE_ENV === 'development'`.

Run: `pnpm --filter @autosale/api test auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts
git commit -m "feat: add registration and login API"
```

---

### Task 4: CSRF, rate limits and authorization guard

**Files:**
- Create: `apps/api/src/auth/csrf.service.ts`
- Create: `apps/api/src/auth/csrf.service.spec.ts`
- Create: `apps/api/src/auth/rate-limit.service.ts`
- Create: `apps/api/src/auth/rate-limit.service.spec.ts`
- Create: `apps/api/src/auth/auth.guard.ts`
- Create: `apps/api/src/auth/auth.guard.spec.ts`
- Create: `apps/api/src/auth/auth.decorators.ts`
- Modify: `apps/api/src/auth/auth.module.ts`

**Interfaces:**
- Produces decorators: `@Public()`, `@RequirePlatformAdmin()`, `@RequireMembership('OWNER' | 'MANAGER')`, `@CurrentPrincipal()`.
- Produces `POST /api/auth/csrf` returning `{ token }` for an authenticated session.

- [ ] **Step 1: Write failing policy matrix tests**

```ts
expect(decideAccess(anonymous, 'PUBLIC')).toBe(true);
expect(decideAccess(admin, 'TENANT_MANAGER')).toBe(false);
expect(decideAccess(owner, 'TENANT_OWNER')).toBe(true);
expect(decideAccess(manager, 'TENANT_OWNER')).toBe(false);
```

- [ ] **Step 2: Implement metadata decorators and global guard**

Guard reads only configured cookie, resolves session, attaches `request.principal`, and never accepts tenant identity from headers/body/query.

- [ ] **Step 3: Write failing CSRF/rate tests**

```ts
expect(csrf.verify(sessionId, csrf.issue(sessionId))).toBe(true);
expect(csrf.verify(otherSessionId, token)).toBe(false);
await expect(limit.consume('login', ipPrefix, emailHash, 6)).rejects.toMatchObject({ status: 429 });
```

- [ ] **Step 4: Implement synchronizer CSRF and Redis fail-closed limiter**

CSRF is required for mutating cookie-authenticated routes except register/login/verify/reset/invite acceptance. Limiter uses bounded keys and throws `503` when Redis is unavailable.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @autosale/api test auth.guard csrf rate-limit`
Expected: PASS.

```bash
git add apps/api/src/auth
git commit -m "feat: enforce session authorization controls"
```

---

### Task 5: Tenant-scope every business endpoint

**Files:**
- Modify: `apps/api/src/conversations/conversations.controller.ts`
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/media/media.controller.ts`
- Modify: `apps/api/src/media/media.service.ts`
- Modify: `apps/api/src/orders/orders.controller.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/settings/*.controller.ts`
- Modify: `apps/api/src/settings/*.service.ts`
- Modify corresponding `*.spec.ts` files.

**Interfaces:**
- Consumes `@CurrentPrincipal() principal: AuthPrincipal`.
- Service signatures begin with tenant ID, e.g. `detail(tenantId: string, id: string)` and `list(tenantId: string, query)`.

- [ ] **Step 1: Add cross-tenant failing tests for every resource family**

```ts
await expect(service.detail(tenantB.id, tenantAConversation.id))
  .rejects.toBeInstanceOf(NotFoundException);
expect(prismaSpy.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ tenantId: tenantB.id }),
}));
```

- [ ] **Step 2: Run tests and confirm existing singleton tenant design fails**

Run: `pnpm --filter @autosale/api test conversations media orders settings`
Expected: FAIL because services use constructor `DEFAULT_TENANT_ID`.

- [ ] **Step 3: Refactor controllers/services to explicit tenant scope**

Media lookup must join `attachment.message.tenantId`; order mutations must include tenant in initial lookup and transaction predicates. Apply `@RequireMembership('MANAGER')` to tenant controllers and OWNER-only policy to integration settings.

- [ ] **Step 4: Run isolation matrix**

Run: `pnpm --filter @autosale/api test`
Expected: all API tests PASS, including anonymous 401, admin 403 and cross-tenant 404.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "refactor: enforce tenant scope from authenticated sessions"
```

---

### Task 6: Team invitations and privacy-safe admin aggregates

**Files:**
- Create: `apps/api/src/team/team.service.ts`
- Create: `apps/api/src/team/team.controller.ts`
- Create: `apps/api/src/team/team.module.ts`
- Create: `apps/api/src/team/team.service.spec.ts`
- Create: `apps/api/src/admin/admin.service.ts`
- Create: `apps/api/src/admin/admin.controller.ts`
- Create: `apps/api/src/admin/admin.module.ts`
- Create: `apps/api/src/admin/admin.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/src/auth.ts`

**Interfaces:**
- Produces: `GET/POST /api/team/invitations`, `POST /api/team/invitations/:id/revoke`, `POST /api/team/members/:id/block`.
- Produces: `GET /api/admin/tenants`, `GET /api/admin/health-summary`, block/unblock endpoints.

- [ ] **Step 1: Write failing OWNER/MANAGER invitation tests**

Verify OWNER can invite, duplicate active invite is idempotent, MANAGER gets 403, accept token creates one membership, and block revokes sessions.

- [ ] **Step 2: Implement team vertical slice and run tests**

Run: `pnpm --filter @autosale/api test team`
Expected: PASS.

- [ ] **Step 3: Write privacy-contract admin test**

```ts
const serialized = JSON.stringify(await admin.listTenants());
for (const forbidden of ['phone', 'address', 'message', 'extraction', 'storageKey']) {
  expect(serialized).not.toContain(forbidden);
}
expect(await admin.listTenants()).toEqual([
  expect.objectContaining({ tenantId, tenantName, ownerEmail, userCount: 2, orderCount: 4 }),
]);
```

- [ ] **Step 4: Implement aggregate-only queries and policy tests**

Use Prisma `_count` and status fields only; do not include business relations. Verify PLATFORM_ADMIN receives 403 from tenant controllers.

Run: `pnpm --filter @autosale/api test admin auth.guard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/team apps/api/src/admin apps/api/src/app.module.ts packages/contracts/src/auth.ts
git commit -m "feat: add tenant team and platform administration"
```

---

### Task 7: Public auth UI and protected application shell

**Files:**
- Create: `apps/web/src/auth/auth-api.ts`
- Create: `apps/web/src/auth/session.ts`
- Create: `apps/web/src/components/auth-form.tsx`
- Create: `apps/web/src/components/auth-form.spec.tsx`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/register/page.tsx`
- Create: `apps/web/app/(auth)/verify-email/page.tsx`
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
- Create: `apps/web/app/(auth)/invite/[token]/page.tsx`
- Create: `apps/web/proxy.ts`
- Modify: `apps/web/src/components/inbox-shell.tsx`

**Interfaces:**
- Consumes `/api/auth/*` and server cookie forwarding.
- Produces redirects: anonymous protected request → `/login?next=<safe-local-path>`; authenticated auth-page request → `/conversations`.

- [ ] **Step 1: Write failing auth form tests**

```tsx
render(<LoginForm submit={submit} />);
await user.type(screen.getByLabelText('Email'), 'owner@example.com');
await user.type(screen.getByLabelText('Пароль'), 'wrong-password');
await user.click(screen.getByRole('button', { name: 'Увійти' }));
expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося увійти');
```

- [ ] **Step 2: Implement accessible auth pages and safe next redirect**

Do not expose raw API errors. `next` is accepted only when it starts with one `/` and not `//`. Forms fetch CSRF after session creation where required.

- [ ] **Step 3: Add protected shell tests**

Verify role-aware nav: OWNER sees Team/Settings; MANAGER does not see Team/integration settings; PLATFORM_ADMIN sees only Admin/logout.

- [ ] **Step 4: Run web tests and build**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add authentication user interface"
```

---

### Task 8: Team and platform admin UI

**Files:**
- Create: `apps/web/app/team/page.tsx`
- Create: `apps/web/src/components/team-management.tsx`
- Create: `apps/web/src/components/team-management.spec.tsx`
- Create: `apps/web/app/admin/page.tsx`
- Create: `apps/web/src/components/admin-dashboard.tsx`
- Create: `apps/web/src/components/admin-dashboard.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes team/admin contracts from Task 6.
- Produces accessible invitation, blocking and aggregate health workflows.

- [ ] **Step 1: Write failing role and privacy UI tests**

```tsx
expect(screen.getByRole('heading', { name: 'Команда' })).toBeVisible();
expect(screen.queryByText(/телефон|адреса|повідомлення клієнта/i)).not.toBeInTheDocument();
expect(screen.getByText('2 користувачі')).toBeVisible();
```

- [ ] **Step 2: Implement team management**

Show member status, invitation expiry and dev-only copy link. Require confirmation modal before blocking a member; on success refresh server data.

- [ ] **Step 3: Implement aggregate admin dashboard**

Show tenant name, owner email, user/order/error counts and integration health badges. No links to tenant conversations/orders.

- [ ] **Step 4: Test responsive UI and commit**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web build`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat: add team and platform admin screens"
```

---

### Task 9: Bootstrap, migration and end-to-end acceptance

**Files:**
- Create: `apps/api/src/cli/bootstrap-auth.ts`
- Create: `apps/api/src/cli/bootstrap-auth.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `infra/scripts/deploy.sh`
- Create: `tests/e2e/auth.spec.ts`
- Modify: `tests/e2e/conversation-inbox.spec.ts`
- Create: `docs/operations/authentication.md`
- Modify: `docs/acceptance/mvp-checklist.md`

**Interfaces:**
- Produces commands `pnpm --filter @autosale/api auth:bootstrap-admin` and `auth:adopt-tenant` reading password from stdin.
- Updates E2E to authenticate before protected flows.

- [ ] **Step 1: Write failing bootstrap tests**

Verify command is idempotent by normalized email, refuses password CLI arguments/environment, reads stdin, creates PLATFORM_ADMIN, and adopts current tenant as OWNER without changing tenant ID.

- [ ] **Step 2: Implement CLI and deployment invocation**

Deployment runs additive Prisma migration; bootstrap remains an explicit operator command and never runs automatically on every container start.

- [ ] **Step 3: Add Playwright auth/isolation scenarios**

```ts
test('owner registers, verifies, logs in and invites manager', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByLabel('Пароль').fill('correct-horse-battery-staple');
  await page.getByLabel('Ім’я').fill('Owner');
  await page.getByLabel('Організація').fill('Test Store');
  await page.getByRole('button', { name: 'Зареєструватися' }).click();
  const verificationUrl = await page.getByTestId('dev-verification-link').getAttribute('href');
  await page.goto(verificationUrl!);
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByLabel('Пароль').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Увійти' }).click();
  await page.goto('/team');
  await page.getByLabel('Email менеджера').fill('manager@example.test');
  await page.getByRole('button', { name: 'Запросити' }).click();
  await expect(page.getByText('manager@example.test')).toBeVisible();
});
test('manager cannot open team settings', async ({ managerPage }) => {
  await managerPage.goto('/team');
  await expect(managerPage).toHaveURL(/\/conversations$/);
  await expect(managerPage.getByRole('link', { name: 'Команда' })).toHaveCount(0);
});
test('platform admin sees aggregates but no tenant data links', async ({ adminPage }) => {
  await adminPage.goto('/admin');
  await expect(adminPage.getByText('Test Store')).toBeVisible();
  await expect(adminPage.getByRole('link', { name: /діалоги|замовлення/i })).toHaveCount(0);
  await expect(adminPage.getByText(/телефон|адреса|повідомлення клієнта/i)).toHaveCount(0);
});
test('tenant B cannot fetch tenant A conversation UUID', async ({ tenantBRequest, tenantAConversation }) => {
  expect((await tenantBRequest.get(`/api/conversations/${tenantAConversation.id}`)).status()).toBe(404);
});
```

- [ ] **Step 4: Run complete verification**

Run: `pnpm test`
Expected: all unit/integration tests PASS.

Run: `pnpm typecheck && pnpm build`
Expected: exit 0.

Run: `pnpm test:e2e`
Expected: register/login/invite/role/isolation and existing Instagram/order flows PASS.

Run: `docker compose build && docker compose up -d --wait`
Expected: migrations complete; API, worker, web, PostgreSQL, Redis and MinIO healthy.

- [ ] **Step 5: Security verification**

Confirm cookie flags from HTTP response, run `rg -n "password|token|cookie"` against captured JSON logs and verify values are `[REDACTED]`, then query cross-tenant resources as every role.

- [ ] **Step 6: Commit**

```bash
git add apps/api apps/web tests Dockerfile compose.yaml infra/scripts docs/operations docs/acceptance
git commit -m "test: verify self-hosted tenant authentication"
```

---

## Checkpoints

### Checkpoint A — after Tasks 1–3

- [ ] Auth schema is additive and existing data remains intact.
- [ ] Register/verify/login/logout/reset service and HTTP tests pass.
- [ ] No plaintext password or raw token is persisted.

### Checkpoint B — after Tasks 4–6

- [ ] Session, CSRF and rate-limit controls pass.
- [ ] Every business endpoint receives tenant scope from principal.
- [ ] Cross-tenant matrix passes and admin API returns aggregates only.

### Checkpoint C — after Tasks 7–9

- [ ] Owner, manager and platform admin UI flows pass in Playwright.
- [ ] Current local tenant data is adopted without ID changes.
- [ ] Full tests, typecheck, production build and Docker health pass.

## Explicitly Deferred

- Multi-membership tenant switcher.
- MFA, SSO and social login.
- User/tenant hard deletion and data export workflow.
- Real SMTP credentials and delivery-domain configuration.
- Billing and subscription enforcement.
