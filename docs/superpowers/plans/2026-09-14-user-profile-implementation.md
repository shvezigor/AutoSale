# User Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, responsive personal profile where an authenticated AutoSale user can manage their name, phone, avatar, and local password while seeing read-only account information.

**Architecture:** Extend the existing `User` identity and public session, then add profile contracts and focused services/controllers inside the existing auth boundary. Reuse the existing S3-compatible object storage, security audit log, CSRF guard, activity overlay, toast system, and authenticated Next.js shell; add a durable avatar-cleanup outbox consumed by the worker.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, NestJS 11, Zod 4, Sharp 0.35, S3/MinIO, Next.js 16 App Router, React 19, Vitest, Testing Library, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-14-user-profile-localization-table-sorting-design.md`

## Global Constraints

- This plan implements checkpoint 1 only; full localization and table sorting have separate future plans.
- Personal notification settings remain unchanged.
- Account email, active membership role, account dates, and sign-in methods are read-only.
- Google-only users cannot add or change a local password.
- Do not store a personal address.
- Accepted avatars are JPEG, PNG, or WebP up to 5 MB and are stored as controlled WebP copies.
- Profile mutations are self-scoped, authenticated, CSRF-protected, rate-limited where specified, and privacy-safe in audit logs.
- PostgreSQL remains the source of truth; S3 object changes follow committed database references and a durable cleanup outbox.
- Keep unrelated untracked `.superpowers` files out of every commit.

---

## File map

### Domain and contracts

- Modify `packages/database/prisma/schema.prisma`: user profile columns and `UserAvatarCleanup` outbox.
- Create `packages/database/prisma/migrations/20260914170000_user_profiles/migration.sql`: reversible database shape, defaults, checks, and indexes.
- Create `packages/contracts/src/profile.ts`: profile response and mutation schemas/types.
- Modify `packages/contracts/src/auth.ts`: session avatar and locale fields.
- Modify `packages/contracts/src/index.ts` and `packages/contracts/package.json`: export profile contracts.

### API and storage

- Create `apps/api/src/auth/profile.service.ts`: self-scoped reads, personal updates, password changes, avatar lifecycle, audit writes.
- Create `apps/api/src/auth/profile.controller.ts`: `/api/profile` HTTP interface and upload limits.
- Create `apps/api/src/auth/profile.service.spec.ts`: service behavior, authorization scope, password, audit, and storage failure tests.
- Create `apps/api/src/auth/profile.controller.spec.ts`: request parsing, CSRF-compatible mutations, and upload/rate-limit behavior.
- Modify `apps/api/src/auth/auth.module.ts`: construct and register the profile service/controller and S3 adapter.
- Modify `apps/api/src/auth/session.service.ts`: expose profile session fields and revoke only other sessions.
- Modify `apps/api/src/auth/session.service.spec.ts`: current-session retention and profile session data.
- Modify `apps/api/src/auth/auth.service.ts` and `apps/api/src/auth/google-sign-in.service.ts`: persist `lastLoginAt` after successful sign-in and return extended sessions.
- Modify the corresponding auth service specs.
- Modify `apps/api/src/media/media.controller.ts`, `apps/api/src/media/media.service.ts`, and `apps/api/src/media/media.service.spec.ts`: serve the current user's avatar without exposing object keys.
- Modify `apps/api/package.json` and `pnpm-lock.yaml`: add direct `sharp` and `multer` dependencies from the workspace catalogue.

### Cleanup worker

- Create `apps/worker/src/profile/user-avatar-cleanup.reconciler.ts`: lease and delete queued avatar objects with retry/backoff.
- Create `apps/worker/src/profile/user-avatar-cleanup.reconciler.spec.ts`: success, retry, dead-letter, and stale-lease cases.
- Modify `apps/worker/src/main.ts`: schedule the reconciler without delaying message processing.

### Web

- Create `apps/web/app/(workspace)/profile/page.tsx` and `page.spec.tsx`: server-loaded profile route.
- Create `apps/web/src/components/profile-editor.tsx` and `profile-editor.spec.tsx`: personal details, avatar, account, and security UI.
- Modify `apps/web/src/components/app-header.tsx` and `app-header.spec.tsx`: profile link, user avatar, no company-settings shortcut.
- Modify `apps/web/src/components/authenticated-shell.tsx`, `apps/web/app/(workspace)/layout.tsx`, and their specs: pass the extended session through the shell.
- Modify `apps/web/app/globals.css`: responsive profile and avatar styles.

---

### Task 1: Persist profile fields and publish contracts

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260914170000_user_profiles/migration.sql`
- Create: `packages/contracts/src/profile.ts`
- Create: `packages/contracts/src/profile.spec.ts`
- Modify: `packages/contracts/src/auth.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Produces: `profileResponseSchema`, `updateProfileRequestSchema`, `changePasswordRequestSchema`, `ProfileResponse`, `UpdateProfileRequest`, and `ChangePasswordRequest` from `@autosale/contracts/profile`.
- Produces: `PublicSession.locale: 'uk' | 'en'` and `PublicSession.avatarUrl: string | null`.
- Produces: Prisma `User.phone`, `locale`, `avatarStorageKey`, `avatarChecksum`, `avatarContentType`, and `lastLoginAt` fields plus `UserAvatarCleanup`.

- [ ] **Step 1: Write failing contract tests**

Create `packages/contracts/src/profile.spec.ts` with exact acceptance cases:

```ts
import { describe, expect, it } from 'vitest';
import { changePasswordRequestSchema, profileResponseSchema, updateProfileRequestSchema } from './profile.js';

const base = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  name: 'Ігор Швець',
  phone: '+380671234567',
  locale: 'uk',
  avatarUrl: null,
  membershipRole: 'OWNER',
  signInMethods: ['PASSWORD'],
  canChangePassword: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  lastLoginAt: '2026-09-14T12:00:00.000Z',
} as const;

describe('profile contracts', () => {
  it('accepts a safe public profile and rejects password internals', () => {
    expect(profileResponseSchema.parse(base)).toEqual(base);
    expect(profileResponseSchema.safeParse({ ...base, passwordHash: 'secret' }).success).toBe(false);
  });

  it('normalizes profile edits and rejects unknown fields', () => {
    expect(updateProfileRequestSchema.parse({ name: '  Ігор Швець  ', phone: ' +380 67 123 45 67 ', locale: 'uk' }))
      .toEqual({ name: 'Ігор Швець', phone: '+380671234567', locale: 'uk' });
    expect(updateProfileRequestSchema.safeParse({ name: 'Ігор', email: 'other@example.com' }).success).toBe(false);
  });

  it('requires a strong confirmed replacement password', () => {
    expect(changePasswordRequestSchema.safeParse({ currentPassword: 'old password value', newPassword: 'new password value', confirmation: 'different value' }).success).toBe(false);
    expect(changePasswordRequestSchema.parse({ currentPassword: 'old password value', newPassword: 'new password value', confirmation: 'new password value' }).newPassword).toBe('new password value');
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm --filter @autosale/contracts exec vitest run src/profile.spec.ts`

Expected: FAIL because `./profile.js` does not exist.

- [ ] **Step 3: Add the profile contracts**

Create `packages/contracts/src/profile.ts` with strict schemas and explicit types:

```ts
import { z } from 'zod';

export const userLocaleSchema = z.enum(['uk', 'en']);
const phoneSchema = z.string().transform((value) => value.replace(/[\s()-]/g, '')).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));
export const updateProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.union([phoneSchema, z.literal('').transform(() => null), z.null()]),
  locale: userLocaleSchema,
}).strict();
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(12).max(128),
  newPassword: z.string().min(12).max(128),
  confirmation: z.string().min(12).max(128),
}).strict().refine((value) => value.newPassword === value.confirmation, { path: ['confirmation'], message: 'PASSWORD_CONFIRMATION_MISMATCH' });
export const profileResponseSchema = z.object({
  userId: z.string().uuid(), email: z.string().email(), name: z.string(), phone: z.string().nullable(),
  locale: userLocaleSchema, avatarUrl: z.string().nullable(), membershipRole: z.enum(['OWNER', 'MANAGER']).nullable(),
  signInMethods: z.array(z.enum(['PASSWORD', 'GOOGLE'])), canChangePassword: z.boolean(),
  createdAt: z.string().datetime(), lastLoginAt: z.string().datetime().nullable(),
}).strict();
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type UserLocale = z.infer<typeof userLocaleSchema>;
```

Export the module from `src/index.ts` and add an `./profile` export entry matching the existing `./auth` entry.

- [ ] **Step 4: Add the Prisma fields and durable cleanup model**

Add the following fields and relation to `User`:

```prisma
phone              String?
locale             String              @default("uk")
avatarStorageKey   String?              @map("avatar_storage_key")
avatarChecksum     String?              @map("avatar_checksum")
avatarContentType  String?              @map("avatar_content_type")
lastLoginAt        DateTime?            @map("last_login_at")
avatarCleanups     UserAvatarCleanup[]
```

Add the outbox model:

```prisma
model UserAvatarCleanup {
  id            String    @id @default(uuid()) @db.Uuid
  userId        String    @map("user_id") @db.Uuid
  storageKey    String    @unique @map("storage_key")
  status        String    @default("PENDING")
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now()) @map("next_attempt_at")
  leaseUntil    DateTime? @map("lease_until")
  lastErrorCode String?   @map("last_error_code")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@map("user_avatar_cleanups")
}
```

Create SQL that adds the columns, a `users_locale_check` for `locale IN ('uk','en')`, a `users_phone_check` allowing null or E.164, the cleanup table, its unique/index constraints, and its foreign key. Do not backfill `last_login_at`; existing rows remain null.

- [ ] **Step 5: Generate Prisma and run contract/database checks**

Run:

```powershell
pnpm --filter @autosale/database generate
pnpm --filter @autosale/contracts test
pnpm --filter @autosale/contracts typecheck
pnpm --filter @autosale/database typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the domain slice**

```powershell
git add -- packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260914170000_user_profiles/migration.sql packages/database/src/generated packages/contracts/src/profile.ts packages/contracts/src/profile.spec.ts packages/contracts/src/auth.ts packages/contracts/src/index.ts packages/contracts/package.json
git commit -m "feat(profile): add profile domain and contracts"
```

---

### Task 2: Add self-scoped profile reads and personal updates

**Files:**
- Create: `apps/api/src/auth/profile.service.ts`
- Create: `apps/api/src/auth/profile.service.spec.ts`
- Create: `apps/api/src/auth/profile.controller.ts`
- Create: `apps/api/src/auth/profile.controller.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/auth/session.service.ts`
- Modify: `apps/api/src/auth/session.service.spec.ts`
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.service.spec.ts`
- Modify: `apps/api/src/auth/google-sign-in.service.ts`
- Modify: `apps/api/src/auth/google-sign-in.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 profile contracts and user fields.
- Produces: `ProfileService.get(principal): Promise<ProfileResponse>` and `ProfileService.update(principal, input): Promise<ProfileResponse>`.
- Produces: `GET /api/profile` and `PATCH /api/profile`.
- Produces: public sessions containing `locale` and versioned `avatarUrl`.

- [ ] **Step 1: Write failing service tests for self-scope and safe output**

Test that `get` queries only `principal.userId`, derives `PASSWORD` and `GOOGLE`, returns the active membership role, and never returns object keys or password hashes. Test that `update` writes only `name`, normalized `phone`, and `locale`, and writes this audit payload:

Create and reuse this focused fixture in `profile.service.spec.ts`:

```ts
function createFixture() {
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    securityAuditLog: { create: vi.fn() },
    userAvatarCleanup: { create: vi.fn() },
    session: { updateMany: vi.fn() },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  };
  const crypto = { verifyPassword: vi.fn(), hashPassword: vi.fn() };
  const sessions = { revokeOthersForUser: vi.fn() };
  const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
  const service = new ProfileService(prisma as never, crypto as never, sessions as never, storage as never);
  return { prisma, crypto, sessions, storage, service };
}
```

```ts
expect(prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: {
  userId: principal.userId,
  tenantId: principal.tenantId,
  actor: 'USER',
  action: 'PROFILE_UPDATED',
  result: 'SUCCESS',
  metadata: { fields: ['locale', 'name', 'phone'] },
} });
```

Also assert `JSON.stringify(auditCall)` contains neither the name nor phone value.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @autosale/api exec vitest run src/auth/profile.service.spec.ts`

Expected: FAIL because `ProfileService` is missing.

- [ ] **Step 3: Implement read/update with one response mapper**

Implement these signatures in `profile.service.ts`:

```ts
type ProfileUser = {
  id: string; email: string; name: string; phone: string | null; locale: string;
  passwordHash: string | null; avatarStorageKey: string | null; avatarChecksum: string | null;
  avatarContentType: string | null; createdAt: Date; lastLoginAt: Date | null;
  googleIdentity: { id: string } | null;
};

export class ProfileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly storage: ObjectStorage,
  ) {}
  async get(principal: AuthPrincipal): Promise<ProfileResponse>;
  async update(principal: AuthPrincipal, input: UpdateProfileRequest): Promise<ProfileResponse>;
  private response(user: ProfileUser, membershipRole: 'OWNER' | 'MANAGER' | null): ProfileResponse;
}

function avatarUrl(user: Pick<ProfileUser, 'avatarStorageKey' | 'avatarChecksum'>): string | null {
  return user.avatarStorageKey ? `/api/media/profile/avatar?v=${encodeURIComponent(user.avatarChecksum ?? '1')}` : null;
}
```

Use a Prisma transaction for the user update and audit row. Select the membership matching `principal.tenantId`; never accept a tenant or user ID from input. Sort the recorded field-name array and store no values.

- [ ] **Step 4: Add controller parsing tests, then the controller**

Test that unknown fields produce `BadRequestException`, a manager can read and edit their own profile, and the controller passes `CurrentPrincipal` unchanged. Implement:

```ts
@Controller('api/profile')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentPrincipal() principal: AuthPrincipal) { return this.profiles.get(principal); }

  @Patch()
  update(@CurrentPrincipal() principal: AuthPrincipal, @Body() body: unknown) {
    return this.profiles.update(principal, parse(updateProfileRequestSchema, body));
  }
}
```

Register both files in `AuthModule` so the existing global auth/CSRF guards apply.

- [ ] **Step 5: Extend session data and persist successful login time**

Extend `AuthPrincipal` and `PublicSession` with `locale` and `avatarUrl`. Update `SessionService.resolve` to select the user profile columns and build the versioned URL. In password and Google login flows, update `lastLoginAt` only after credentials/identity are accepted and before returning a successful session. Do not update it for failed attempts.

Add this session method for Task 3:

```ts
async revokeOthersForUser(userId: string, currentSessionId: string): Promise<number> {
  const result = await this.prisma.session.updateMany({
    where: { userId, id: { not: currentSessionId }, revokedAt: null },
    data: { revokedAt: this.now() },
  });
  return result.count;
}
```

Test local login, Google login, session resolution, null avatar, versioned avatar, and that failed login leaves `lastLoginAt` unchanged.

- [ ] **Step 6: Run focused and package verification**

Run:

```powershell
pnpm --filter @autosale/api exec vitest run src/auth/profile.service.spec.ts src/auth/profile.controller.spec.ts src/auth/session.service.spec.ts src/auth/auth.service.spec.ts src/auth/google-sign-in.service.spec.ts
pnpm --filter @autosale/api typecheck
```

Expected: all tests and type checking PASS.

- [ ] **Step 7: Commit the API slice**

```powershell
git add -- apps/api/src/auth packages/contracts/src/auth.ts
git commit -m "feat(profile): expose personal profile API"
```

---

### Task 3: Implement secure local-password changes

**Files:**
- Modify: `apps/api/src/auth/profile.service.ts`
- Modify: `apps/api/src/auth/profile.service.spec.ts`
- Modify: `apps/api/src/auth/profile.controller.ts`
- Modify: `apps/api/src/auth/profile.controller.spec.ts`

**Interfaces:**
- Consumes: `ChangePasswordRequest`, `CryptoService`, `RateLimitService`, and `SessionService.revokeOthersForUser`.
- Produces: `ProfileService.changePassword(principal, input): Promise<{ changed: true; revokedSessions: number }>`.
- Produces: `POST /api/profile/password`.

- [ ] **Step 1: Write failing password service tests**

Use the Task 2 fixture and add these concrete cases:

```ts
const principal = {
  userId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'session-current',
  tenantId: '20000000-0000-4000-8000-000000000002',
  email: 'owner@example.com', name: 'Ігор', locale: 'uk', avatarUrl: null,
  platformRole: 'USER', membershipRole: 'OWNER',
} as const;
const passwordInput = {
  currentPassword: 'old password value',
  newPassword: 'new password value',
  confirmation: 'new password value',
};

it('rejects password changes for a Google-only user', async () => {
  const fixture = createFixture();
  fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: null });
  await expect(fixture.service.changePassword(principal, passwordInput)).rejects.toThrow('PROFILE_PASSWORD_UNAVAILABLE');
  expect(fixture.crypto.hashPassword).not.toHaveBeenCalled();
  expect(fixture.prisma.user.update).not.toHaveBeenCalled();
  expect(fixture.sessions.revokeOthersForUser).not.toHaveBeenCalled();
});

it('rejects an incorrect current password without changing sessions', async () => {
  const fixture = createFixture();
  fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored-hash' });
  fixture.crypto.verifyPassword.mockResolvedValue(false);
  await expect(fixture.service.changePassword(principal, passwordInput)).rejects.toThrow('PROFILE_CURRENT_PASSWORD_INVALID');
  expect(fixture.crypto.hashPassword).not.toHaveBeenCalled();
  expect(fixture.sessions.revokeOthersForUser).not.toHaveBeenCalled();
});

it('changes a local password and revokes only other sessions', async () => {
  const fixture = createFixture();
  fixture.prisma.user.findUnique.mockResolvedValue({ passwordHash: 'stored-hash' });
  fixture.crypto.verifyPassword.mockResolvedValue(true);
  fixture.crypto.hashPassword.mockResolvedValue('replacement-hash');
  fixture.sessions.revokeOthersForUser.mockResolvedValue(2);
  await expect(fixture.service.changePassword(principal, passwordInput)).resolves.toEqual({ changed: true, revokedSessions: 2 });
  expect(fixture.prisma.user.update).toHaveBeenCalledWith({ where: { id: principal.userId }, data: { passwordHash: 'replacement-hash' } });
  expect(fixture.sessions.revokeOthersForUser).toHaveBeenCalledWith(principal.userId, principal.sessionId);
  expect(fixture.prisma.securityAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    action: 'PROFILE_PASSWORD_CHANGED', result: 'SUCCESS', metadata: { revokedSessions: 2 },
  }) });
});
```

For success, assert the audit event contains `action: 'PROFILE_PASSWORD_CHANGED'`, `result: 'SUCCESS'`, and `metadata: { revokedSessions: 2 }`. For rejected attempts, store only a reason code such as `NO_LOCAL_PASSWORD` or `CURRENT_PASSWORD_INVALID`, never password material.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @autosale/api exec vitest run src/auth/profile.service.spec.ts -t password`

Expected: FAIL because `changePassword` is missing.

- [ ] **Step 3: Implement password change atomically**

Implement the method flow:

```ts
const user = await this.prisma.user.findUnique({ where: { id: principal.userId }, select: { passwordHash: true } });
if (!user?.passwordHash) throw new BadRequestException('PROFILE_PASSWORD_UNAVAILABLE');
if (!await this.crypto.verifyPassword(user.passwordHash, input.currentPassword)) throw new UnauthorizedException('PROFILE_CURRENT_PASSWORD_INVALID');
const passwordHash = await this.crypto.hashPassword(input.newPassword);
await this.prisma.user.update({ where: { id: principal.userId }, data: { passwordHash } });
const revokedSessions = await this.sessions.revokeOthersForUser(principal.userId, principal.sessionId);
await this.audit(principal, 'PROFILE_PASSWORD_CHANGED', 'SUCCESS', { revokedSessions });
return { changed: true as const, revokedSessions };
```

Ensure audit failure does not roll back an already secured password but is reported through structured server logging. Ensure database update failure does not revoke sessions.

- [ ] **Step 4: Add the rate-limited controller endpoint**

Before calling the service, consume `profile-password` with the request IP and authenticated email, limit 5 per 15 minutes. Parse with `changePasswordRequestSchema` and return the service result. Add controller tests for normalized rate-limit identity, schema rejection, and service delegation.

- [ ] **Step 5: Run focused API verification**

Run:

```powershell
pnpm --filter @autosale/api exec vitest run src/auth/profile.service.spec.ts src/auth/profile.controller.spec.ts src/auth/session.service.spec.ts
pnpm --filter @autosale/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit password security**

```powershell
git add -- apps/api/src/auth/profile.service.ts apps/api/src/auth/profile.service.spec.ts apps/api/src/auth/profile.controller.ts apps/api/src/auth/profile.controller.spec.ts apps/api/src/auth/session.service.ts apps/api/src/auth/session.service.spec.ts
git commit -m "feat(profile): support secure password changes"
```

---

### Task 4: Add controlled avatar upload and delivery

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/auth/profile.controller.ts`
- Modify: `apps/api/src/auth/profile.controller.spec.ts`
- Modify: `apps/api/src/auth/profile.service.ts`
- Modify: `apps/api/src/auth/profile.service.spec.ts`
- Modify: `apps/api/src/media/media.controller.ts`
- Modify: `apps/api/src/media/media.service.ts`
- Modify: `apps/api/src/media/media.service.spec.ts`

**Interfaces:**
- Consumes: `ObjectStorage.put/get/delete`, `sharp`, and Task 1 avatar fields/outbox.
- Produces: `POST /api/profile/avatar`, `DELETE /api/profile/avatar`, and `GET /api/media/profile/avatar`.
- Produces: `ProfileService.replaceAvatar(principal, file)` and `ProfileService.removeAvatar(principal)` returning `ProfileResponse`.

- [ ] **Step 1: Add direct image dependencies**

Add `"multer": "catalog:"` and `"sharp": "catalog:"` to API dependencies and run `pnpm install --lockfile-only`. Do not rely on Next.js or Nest transitive dependencies.

- [ ] **Step 2: Write failing image lifecycle tests**

Use a real in-memory 2x3 PNG fixture generated by Sharp. Assert:

- JPEG, PNG, and WebP inputs produce a 512x512 WebP output;
- invalid bytes and images over 5 MB are rejected before storage;
- the storage key matches `users/{userId}/avatars/{random}.webp` and never uses the original filename;
- a committed replacement creates one cleanup outbox row for the previous key;
- a failed database update deletes or queues the unreferenced newly uploaded object;
- delete clears the reference and queues the old key;
- audit metadata contains operation and content category but no filename or bytes.

- [ ] **Step 3: Implement safe processing and reference changes**

Use this processing pipeline:

```ts
const output = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 25_000_000 })
  .rotate()
  .resize(512, 512, { fit: 'cover', position: 'centre' })
  .webp({ quality: 82, effort: 4 })
  .toBuffer();
const checksum = createHash('sha256').update(output).digest('hex');
const key = `users/${principal.userId}/avatars/${randomUUID()}.webp`;
```

After `storage.put`, transactionally update the user's reference, insert a cleanup row for a different old key, and write the audit row. If the transaction fails, attempt immediate deletion of the new key; if that deletion fails, insert a cleanup row for the new key before rethrowing.

- [ ] **Step 4: Add upload/delete endpoints with limits**

Use `FileInterceptor('avatar', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } })`, reject missing files with `PROFILE_AVATAR_REQUIRED`, and rate-limit upload/delete to 20 operations per hour per authenticated user/IP. Keep CSRF enforcement through the existing global guard.

- [ ] **Step 5: Serve only the current user's referenced avatar**

Move the controller-level `@RequireMembership('MANAGER')` decorator onto the two existing Instagram/attachment methods so they retain their current tenant-membership protection. Leave the new user-avatar method protected by the global authentication guard but available to an authenticated user without an active tenant membership. Add this media path:

```ts
@Get('profile/avatar')
@Header('Cache-Control', 'private, max-age=3600')
@Header('X-Content-Type-Options', 'nosniff')
async userAvatar(@CurrentPrincipal() principal: AuthPrincipal): Promise<StreamableFile> {
  const avatar = await this.media.loadUserAvatar(principal.userId);
  return new StreamableFile(avatar.body, { type: avatar.contentType, disposition: 'inline' });
}
```

`loadUserAvatar` queries by `principal.userId`, selects only `avatarStorageKey`, returns 404 for no reference, loads the controlled object, and allowlists `image/webp` before responding.

- [ ] **Step 6: Run focused avatar checks**

Run:

```powershell
pnpm --filter @autosale/api exec vitest run src/auth/profile.service.spec.ts src/auth/profile.controller.spec.ts src/media/media.service.spec.ts
pnpm --filter @autosale/api typecheck
pnpm --filter @autosale/api build
```

Expected: PASS, including Sharp in the production API build.

- [ ] **Step 7: Commit avatar API**

```powershell
git add -- apps/api/package.json pnpm-lock.yaml apps/api/src/auth apps/api/src/media
git commit -m "feat(profile): add controlled user avatars"
```

---

### Task 5: Reconcile avatar cleanup outbox

**Files:**
- Create: `apps/worker/src/profile/user-avatar-cleanup.reconciler.ts`
- Create: `apps/worker/src/profile/user-avatar-cleanup.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`

**Interfaces:**
- Consumes: Prisma `UserAvatarCleanup` and `ObjectStorage.delete`.
- Produces: `UserAvatarCleanupReconciler.runOnce(limit?: number): Promise<{ deleted: number; retried: number; deadLettered: number }>`.

- [ ] **Step 1: Write failing reconciler tests**

Cover:

- a pending due row is leased before deletion and becomes `COMPLETED`;
- a transient delete error increments attempts, clears lease, stores a bounded error code, and schedules exponential backoff;
- attempt 8 marks the row `DEAD_LETTER`;
- a cleanup key still referenced by any user avatar is not deleted and is rescheduled;
- an expired lease can be reclaimed, while an active lease cannot.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @autosale/worker exec vitest run src/profile/user-avatar-cleanup.reconciler.spec.ts`

Expected: FAIL because the reconciler does not exist.

- [ ] **Step 3: Implement lease, safety check, delete, and retry**

Use `PENDING`, `PROCESSING`, `COMPLETED`, and `DEAD_LETTER` states. Lease for 60 seconds. Before deletion, query `user.count({ where: { avatarStorageKey: row.storageKey } })`; if nonzero, return the row to `PENDING` one hour later without calling storage. Use capped delays `min(2^attempts * 60 seconds, 6 hours)` and store only a normalized error class/code.

- [ ] **Step 4: Wire a non-overlapping worker schedule**

In `main.ts`, create one reconciler from the existing Prisma and S3 instances, run it at startup, then every 60 seconds with a boolean in-flight guard. Clear the timer during shutdown. A cleanup failure must be logged and must not terminate Instagram, order, catalogue, delivery, or Telegram processing.

- [ ] **Step 5: Run focused worker verification**

Run:

```powershell
pnpm --filter @autosale/worker exec vitest run src/profile/user-avatar-cleanup.reconciler.spec.ts
pnpm --filter @autosale/worker typecheck
pnpm --filter @autosale/worker build
```

Expected: PASS.

- [ ] **Step 6: Commit cleanup lifecycle**

```powershell
git add -- apps/worker/src/profile apps/worker/src/main.ts
git commit -m "feat(profile): reconcile retired avatars"
```

---

### Task 6: Build the responsive profile page

**Files:**
- Create: `apps/web/app/(workspace)/profile/page.tsx`
- Create: `apps/web/app/(workspace)/profile/page.spec.tsx`
- Create: `apps/web/src/components/profile-editor.tsx`
- Create: `apps/web/src/components/profile-editor.spec.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `GET/PATCH /api/profile`, avatar endpoints, password endpoint, `ProfileResponse`, `mutatingFetch`, `useActivity`, `useToast`, and `LoadingButton`.
- Produces: authenticated `/profile` page and client-side profile mutations.

- [ ] **Step 1: Write the failing server-page test**

Mock `authenticatedApiFetch('/api/profile')`, render the route through `WorkspaceLayout`, and assert headings `Мій профіль`, `Особиста інформація`, `Безпека`, and `Акаунт`. Assert a failed API response throws the route error instead of rendering an empty profile.

- [ ] **Step 2: Write failing component tests**

Test these complete flows:

- edit name/phone, save through `PATCH /api/profile`, show a success toast, and call `router.refresh()`;
- blank phone submits `null`;
- invalid E.164 phone remains editable and shows a field error;
- valid image upload sends exactly one `FormData` file and shows a stable loading button;
- invalid client-side type/size never sends a request;
- avatar deletion uses the global confirmation dialog and `DELETE /api/profile/avatar`;
- local-password profiles show all three password fields and clear them after success;
- Google-only profiles show `Вхід через Google` and no password inputs;
- email and membership role are text, not inputs;
- account dates render in Europe/Kyiv with `<time dateTime>` values.
- the account sign-out button calls `POST /api/auth/logout` through `mutatingFetch` and refreshes the router only after success.

- [ ] **Step 3: Run the two focused specs and verify RED**

Run:

```powershell
pnpm --filter @autosale/web exec vitest run 'app/(workspace)/profile/page.spec.tsx' src/components/profile-editor.spec.tsx
```

Expected: FAIL because the route/component do not exist.

- [ ] **Step 4: Implement the server route**

Use the current server pattern:

```tsx
export const dynamic = 'force-dynamic';
export default async function ProfilePage() {
  const response = await authenticatedApiFetch('/api/profile');
  if (!response.ok) throw new Error('Не вдалося завантажити профіль');
  return <main className="profile-layout-content"><ProfileEditor initial={await response.json() as ProfileResponse} /></main>;
}
```

- [ ] **Step 5: Implement focused profile sections and mutations**

Keep `ProfileEditor` responsible for UI state and split internal functions/components by section within the file only while each remains small. Use one details form, one avatar picker, one password form, read-only account facts, and an account sign-out button. All mutations go through `mutatingFetch`; wrap network work with `activity.run`, show right-side toasts, preserve inputs on error, and use `router.refresh()` only after a successful identity-changing mutation or logout.

Do not render the locale chooser yet. Task 1 persists the preference; the checkpoint 2 localization plan will add both header and profile language controls together so users never see a selector that does not apply globally.

- [ ] **Step 6: Add responsive styling**

Desktop uses a two-column profile header/details area and single-column security/account cards with a maximum readable width. At `max-width: 720px`, all sections stack, avatar actions wrap without overflow, form controls become full width, and destructive actions remain visually secondary. Reuse existing colors, radii, buttons, focus rings, loading spinner, and toast tokens.

- [ ] **Step 7: Run focused web verification**

Run:

```powershell
pnpm --filter @autosale/web exec vitest run 'app/(workspace)/profile/page.spec.tsx' src/components/profile-editor.spec.tsx
pnpm --filter @autosale/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the profile UI**

```powershell
git add -- 'apps/web/app/(workspace)/profile' apps/web/src/components/profile-editor.tsx apps/web/src/components/profile-editor.spec.tsx apps/web/app/globals.css
git commit -m "feat(profile): add personal profile page"
```

---

### Task 7: Connect the header identity and release checkpoint 1

**Files:**
- Modify: `apps/web/src/components/app-header.tsx`
- Modify: `apps/web/src/components/app-header.spec.tsx`
- Modify: `apps/web/src/components/authenticated-shell.tsx`
- Modify: `apps/web/src/components/authenticated-shell.spec.tsx`
- Modify: `apps/web/app/(workspace)/layout.tsx`
- Modify: affected test session fixtures that construct a complete `PublicSession`

**Interfaces:**
- Consumes: `PublicSession.avatarUrl`, profile route, and existing header popover behavior.
- Produces: updated profile trigger and menu in every authenticated route.

- [ ] **Step 1: Write failing header-menu tests**

Assert:

```tsx
expect(screen.getByRole('menuitem', { name: 'Мій профіль' })).toHaveAttribute('href', '/profile');
expect(screen.queryByRole('menuitem', { name: 'Налаштування' })).not.toBeInTheDocument();
expect(screen.getByRole('menuitem', { name: 'Команда' })).toHaveAttribute('href', '/team');
expect(screen.getByRole('img', { name: 'Фото профілю Ігор Швець' })).toHaveAttribute('src', '/api/media/profile/avatar?v=abc');
```

Add a manager case with no Team link and a null-avatar case that displays the uppercase initial.

- [ ] **Step 2: Run the header spec and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/app-header.spec.tsx src/components/authenticated-shell.spec.tsx`

Expected: FAIL on the missing profile link and avatar.

- [ ] **Step 3: Implement the menu and avatar**

Extend `HeaderSession` and `ShellSession` to include `avatarUrl`. Render an `<img>` with the controlled URL when present and the existing `.manager-avatar` initial otherwise. Replace the `/settings` menu item with `/profile`; preserve owner-only Team, logout loading state, outside click, Escape behavior, focus restoration, mobile fixed positioning, and minimum 40px trigger target.

- [ ] **Step 4: Run all profile/auth/header tests**

Run:

```powershell
pnpm --filter @autosale/contracts exec vitest run src/profile.spec.ts src/auth.spec.ts
pnpm --filter @autosale/api exec vitest run src/auth/profile.service.spec.ts src/auth/profile.controller.spec.ts src/auth/session.service.spec.ts src/auth/auth.service.spec.ts src/auth/google-sign-in.service.spec.ts src/media/media.service.spec.ts
pnpm --filter @autosale/worker exec vitest run src/profile/user-avatar-cleanup.reconciler.spec.ts
pnpm --filter @autosale/web exec vitest run 'app/(workspace)/profile/page.spec.tsx' src/components/profile-editor.spec.tsx src/components/app-header.spec.tsx src/components/authenticated-shell.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the full release gate**

Run:

```powershell
pnpm typecheck
pnpm test -- --run
pnpm build
git diff --check
```

Expected: all packages PASS and no whitespace errors.

- [ ] **Step 6: Commit header integration**

```powershell
git add -- apps/web/src/components/app-header.tsx apps/web/src/components/app-header.spec.tsx apps/web/src/components/authenticated-shell.tsx apps/web/src/components/authenticated-shell.spec.tsx 'apps/web/app/(workspace)/layout.tsx' packages/contracts/src/auth.ts
git commit -m "feat(profile): connect profile to app header"
```

- [ ] **Step 7: Push, deploy, and verify live**

Run:

```powershell
git push origin master
& .\scripts\deploy-local.ps1 -EnvFile 'C:\Users\User\Documents\ChatGPT\AutoSales\.env'
docker compose --env-file 'C:\Users\User\Documents\ChatGPT\AutoSales\.env' ps
```

Expected: API, worker, and web containers become healthy. In a real browser, verify owner and manager menus, local-password and Google-only security states, avatar upload/replacement/removal, details save, logout, and the profile layout at desktop and 400px mobile width. Leave the live account with its original name, phone, and avatar after destructive smoke checks.
