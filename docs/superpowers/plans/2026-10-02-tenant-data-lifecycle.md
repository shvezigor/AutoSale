# Tenant Data Lifecycle Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe tenant lifecycle phase: checksum-verified export, deletion-request ingestion freeze, expiring private downloads, and non-destructive retention previews.

**Architecture:** A tenant-scoped durable lifecycle record drives an idempotent BullMQ worker. Platform-admin API functions expose bounded lifecycle metadata without granting either runtime role cross-tenant table access; tenant workers re-read data through `withTenantTransaction`. A shared mutation guard freezes new business side effects for deletion requests, while export-only requests leave the tenant active.

**Tech Stack:** TypeScript 5.9, NestJS 11, Next.js 16/React 19, Prisma 7/PostgreSQL, BullMQ 5/Redis, AWS SDK S3, Vitest 4, Testcontainers PostgreSQL, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-tenant-data-lifecycle-design.md`

## Global Constraints

- Phase one must not expose any API, queue job, configuration flag, or SQL function that physically deletes tenant business data.
- `Tenant.status = BLOCKED` remains independent from the lifecycle ingestion freeze.
- An `EXPORT` request never freezes the tenant; a `DELETE` request freezes new business mutations immediately and stops at `EXPORT_READY`.
- Secrets, password/session/token hashes, encrypted credentials, signed URLs, lease identifiers and security-only evidence are excluded from export artifacts.
- API and worker roles remain `NOBYPASSRLS`; platform operations use bounded security-definer functions with fixed `search_path`.
- All tenant-owned reads and writes execute inside `withTenantTransaction`; queue payloads contain only routing identifiers and are revalidated from durable state.
- Export artifacts use private object storage, a seven-day expiry, a complete SHA-256, and short-lived signed download URLs.
- Retention is dry-run only: it reports counts and cutoff dates and performs no delete/update against candidate business rows.
- UI mutations use `LoadingButton` and shared button variants; forms follow shared field-validation behavior.
- Fixtures use clearly fictional data and no credentials, production data, dumps, build output or `artifacts/` content may be committed.

---

## File map

- `packages/contracts/src/tenant-lifecycle.ts` owns public schemas, statuses, safe reason/error codes and BullMQ payload contracts.
- `packages/database/src/tenant-lifecycle.ts` owns the state transition rules and tenant mutation guard used by API and worker code.
- `packages/database/prisma/migrations/20261002120000_tenant_lifecycle_phase_one/migration.sql` owns lifecycle/retention tables, RLS, bounded authority functions and grants.
- `apps/api/src/admin/tenant-lifecycle.service.ts` owns platform-admin orchestration, step-up verification, audit and queue dispatch.
- `packages/integrations/src/object-storage.ts` and `s3-object-storage.ts` own stream upload, object metadata and signed downloads.
- `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts` owns the explicit export allowlist and redaction map.
- `apps/worker/src/tenant-lifecycle/tenant-export-writer.ts` owns deterministic JSONL/manifest archive creation.
- `apps/worker/src/tenant-lifecycle/tenant-lifecycle.processor.ts` owns claim, export, publish and durable completion/failure.
- `apps/worker/src/tenant-lifecycle/tenant-lifecycle.reconciler.ts` owns expired-lease recovery and artifact expiry cleanup.
- `apps/worker/src/tenant-lifecycle/retention-dry-run.processor.ts` owns read-only retention candidate summaries.
- `apps/web/src/components/admin-tenant-lifecycle.tsx` owns the operator lifecycle UI; `admin-dashboard.tsx` remains the platform shell.

### Task 1: Lifecycle contracts, schema, RLS and state machine

**Files:**
- Create: `packages/contracts/src/tenant-lifecycle.ts`
- Create: `packages/contracts/src/tenant-lifecycle.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/database/src/tenant-lifecycle.ts`
- Create: `packages/database/src/tenant-lifecycle.spec.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261002120000_tenant_lifecycle_phase_one/migration.sql`
- Create: `packages/database/src/tenant-lifecycle.postgres.spec.ts`
- Modify: `packages/database/src/runtime-database-roles.ts`
- Modify: `packages/database/src/runtime-database-roles.postgres.spec.ts`

**Interfaces:**
- Produces: `tenantLifecycleRequestSchema`, `createTenantLifecycleRequestSchema`, `tenantLifecycleJobSchema`, `retentionDryRunJobSchema`.
- Produces: `assertTenantAcceptingMutations(tx, tenantId, surface): Promise<void>` and `TenantLifecycleFrozenError`.
- Produces: SQL functions `api_platform_create_tenant_lifecycle_request`, `api_platform_tenant_lifecycle_requests`, `api_platform_tenant_lifecycle_request`, `api_platform_cancel_tenant_lifecycle_request`, `api_platform_retry_tenant_lifecycle_request`, `api_platform_create_retention_dry_run`, `api_platform_retention_dry_runs`, `worker_due_tenant_lifecycle_requests`, `worker_due_tenant_lifecycle_artifact_cleanups`, and `worker_due_retention_dry_runs`.

- [ ] **Step 1: Write failing contract and state-machine tests**

```ts
expect(createTenantLifecycleRequestSchema.parse({
  kind: 'DELETE', reasonCode: 'CONTROLLER_REQUEST',
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
})).toEqual(expect.objectContaining({ kind: 'DELETE' }));
expect(() => assertLifecycleTransition('EXPORT_READY', 'DELETING')).toThrow('DESTRUCTIVE_PHASE_DISABLED');
expect(assertLifecycleTransition('FAILED', 'EXPORTING')).toBeUndefined();
```

- [ ] **Step 2: Run the focused tests and verify the missing exports fail**

Run: `pnpm --filter @autosale/contracts test -- tenant-lifecycle.spec.ts && pnpm --filter @autosale/database test -- tenant-lifecycle.spec.ts`

Expected: FAIL because `tenant-lifecycle.ts` and its exports do not exist.

- [ ] **Step 3: Add the contract and pure state-machine implementation**

```ts
export const tenantLifecycleKindSchema = z.enum(['EXPORT', 'DELETE']);
export const tenantLifecycleStatusSchema = z.enum(['REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED', 'CANCELLED']);
export const tenantLifecycleReasonSchema = z.enum(['CONTROLLER_REQUEST', 'CONTRACT_TERMINATION', 'ADMINISTRATIVE_TEST']);
export const tenantLifecycleJobSchema = z.object({ requestId: z.string().uuid(), tenantId: z.string().uuid() }).strict();
export type TenantLifecycleStatus = z.infer<typeof tenantLifecycleStatusSchema>;
export type TenantMutationSurface = 'META_INBOUND' | 'TELEGRAM_INBOUND' | 'ORDER_RECOGNITION' | 'CONVERSATION_REPLY' | 'ORDER_MUTATION' | 'COMMERCIAL_TERMS' | 'PAYMENT' | 'PROCUREMENT' | 'CATALOGUE' | 'DELIVERY' | 'SUPPLIER_SEND' | 'SHEETS_EXPORT' | 'NOTIFICATION_SEND';

const transitions = new Map<TenantLifecycleStatus, ReadonlySet<TenantLifecycleStatus>>([
  ['REQUESTED', new Set(['EXPORTING', 'CANCELLED'])],
  ['EXPORTING', new Set(['EXPORT_READY', 'FAILED'])],
  ['FAILED', new Set(['EXPORTING', 'CANCELLED'])],
  ['EXPORT_READY', new Set(['CANCELLED'])],
  ['CANCELLED', new Set()],
]);
```

- [ ] **Step 4: Write the failing PostgreSQL isolation/grant test**

```ts
await expect(api.query('SELECT * FROM tenant_lifecycle_requests')).resolves.toMatchObject({ rows: [] });
await expect(api.query("SELECT * FROM api_platform_create_tenant_lifecycle_request($1,$2,'DELETE','ADMINISTRATIVE_TEST',$3,$4,NOW())", [adminId, tenantA, key, hash])).resolves.toMatchObject({ rowCount: 1 });
await expect(worker.query("SELECT * FROM worker_due_tenant_lifecycle_requests(NOW(), 50)")).resolves.toMatchObject({ rows: [expect.objectContaining({ tenant_id: tenantA })] });
await expect(api.query("SELECT * FROM worker_due_tenant_lifecycle_requests(NOW(), 50)")).rejects.toMatchObject({ code: '42501' });
```

- [ ] **Step 5: Add the additive Prisma models and SQL migration**

```prisma
model TenantLifecycleRequest {
  id                    String   @id @default(uuid()) @db.Uuid
  tenantId              String   @map("tenant_id") @db.Uuid
  kind                  String
  status                String   @default("REQUESTED")
  reasonCode            String   @map("reason_code")
  requestedByUserId     String   @map("requested_by_user_id") @db.Uuid
  idempotencyKey        String   @map("idempotency_key") @db.Uuid
  requestHash           String   @map("request_hash")
  ingestionFrozenAt     DateTime? @map("ingestion_frozen_at")
  exportObjectKey       String?  @map("export_object_key")
  exportSha256          String?  @map("export_sha256")
  exportSizeBytes       BigInt?  @map("export_size_bytes")
  exportManifestVersion Int?     @map("export_manifest_version")
  exportReadyAt         DateTime? @map("export_ready_at")
  exportExpiresAt       DateTime? @map("export_expires_at")
  leaseId               String?  @map("lease_id") @db.Uuid
  leaseExpiresAt        DateTime? @map("lease_expires_at")
  attemptCount          Int      @default(0) @map("attempt_count")
  nextAttemptAt         DateTime @default(now()) @map("next_attempt_at")
  lastErrorCode         String?  @map("last_error_code")
  cancelledAt           DateTime? @map("cancelled_at")
  cancelledByUserId     String?  @map("cancelled_by_user_id") @db.Uuid
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")
  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, idempotencyKey])
  @@map("tenant_lifecycle_requests")
}

model TenantRetentionDryRun {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  status            String   @default("REQUESTED")
  requestedByUserId String   @map("requested_by_user_id") @db.Uuid
  idempotencyKey    String   @map("idempotency_key") @db.Uuid
  requestHash       String   @map("request_hash")
  summary           Json?
  leaseId           String?  @map("lease_id") @db.Uuid
  leaseExpiresAt    DateTime? @map("lease_expires_at")
  nextAttemptAt     DateTime @default(now()) @map("next_attempt_at")
  lastErrorCode     String?  @map("last_error_code")
  completedAt       DateTime? @map("completed_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  tenant            Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, idempotencyKey])
  @@map("tenant_retention_dry_runs")
}
```

Add the corresponding collection fields to `Tenant`:

```prisma
lifecycleRequests TenantLifecycleRequest[]
retentionDryRuns  TenantRetentionDryRun[]
```

The migration must add forced RLS, a partial unique index for active `DELETE` requests, fixed-search-path security-definer functions that verify `users.platform_role = 'PLATFORM_ADMIN'`, and explicit API/worker/PUBLIC revokes. `api_platform_create_tenant_lifecycle_request` sets `ingestion_frozen_at = p_now` only for `DELETE`; `EXPORT` stores `NULL`. The retention table must not store candidate-row IDs.

- [ ] **Step 6: Add the shared freeze guard**

```ts
export async function assertTenantAcceptingMutations(
  tx: Prisma.TransactionClient, tenantId: string, surface: TenantMutationSurface,
): Promise<void> {
  const frozen = await tx.tenantLifecycleRequest.findFirst({
    where: { tenantId, kind: 'DELETE', ingestionFrozenAt: { not: null }, status: { in: ['REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED'] } },
    select: { id: true },
  });
  if (frozen) throw new TenantLifecycleFrozenError(surface);
}
```

- [ ] **Step 7: Generate Prisma, run database tests and commit**

Run: `pnpm --filter @autosale/database generate`

Run: `pnpm --filter @autosale/contracts test -- tenant-lifecycle.spec.ts && pnpm --filter @autosale/database test -- tenant-lifecycle.spec.ts tenant-lifecycle.postgres.spec.ts runtime-database-roles.postgres.spec.ts`

Expected: PASS, including opposite-role and absent-tenant-context rejection.

```bash
git add packages/contracts packages/database
git commit -m "feat: add tenant lifecycle persistence"
```

### Task 2: Platform-admin lifecycle API, idempotency and step-up authentication

**Files:**
- Create: `apps/api/src/admin/admin-step-up.service.ts`
- Create: `apps/api/src/admin/admin-step-up.service.spec.ts`
- Create: `apps/api/src/admin/tenant-lifecycle.service.ts`
- Create: `apps/api/src/admin/tenant-lifecycle.service.spec.ts`
- Modify: `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/admin/admin.controller.spec.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Modify: `packages/contracts/src/tenant-lifecycle.ts`
- Modify: `packages/contracts/src/tenant-lifecycle.spec.ts`

**Interfaces:**
- Consumes: bounded SQL functions and schemas from Task 1.
- Produces: `AdminStepUpService.issue(userId, sessionId, password)` and `verify(token, userId, sessionId, purpose)`.
- Produces: `POST /api/admin/reauth`, lifecycle list/detail/create/cancel/retry endpoints and BullMQ queue `tenant-lifecycle`.

- [ ] **Step 1: Write failing step-up and API tests**

```ts
await expect(stepUp.issue(adminId, sessionId, 'wrong password')).rejects.toThrow('ADMIN_REAUTH_FAILED');
const token = await stepUp.issue(adminId, sessionId, 'fictional secure password');
expect(stepUp.verify(token, adminId, sessionId, 'TENANT_DELETE_REQUEST')).toBe(true);
await request(app.getHttpServer()).post('/api/admin/reauth')
  .set('Cookie', 'session=admin').set('x-csrf-token', 'csrf')
  .send({ currentPassword: 'fictional secure password', purpose: 'TENANT_DELETE_REQUEST' }).expect(201);
await request(app.getHttpServer()).post(`/api/admin/tenants/${tenantId}/lifecycle-deletions`)
  .set('Cookie', 'session=admin').set('x-csrf-token', 'csrf')
  .set('idempotency-key', idempotencyKey).send({ reasonCode: 'ADMINISTRATIVE_TEST' }).expect(401);
```

- [ ] **Step 2: Run and observe missing service/route failures**

Run: `pnpm --filter @autosale/api test -- admin-step-up.service.spec.ts tenant-lifecycle.service.spec.ts admin.controller.spec.ts`

Expected: FAIL because the step-up service and lifecycle endpoints are absent.

- [ ] **Step 3: Implement five-minute session-bound step-up tokens**

```ts
type StepUpPayload = { userId: string; sessionId: string; purpose: 'TENANT_DELETE_REQUEST'; expiresAt: number };

issueToken(payload: StepUpPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', this.pepper).update(body).digest('base64url');
  return `${body}.${signature}`;
}
```

Verify the platform admin's stored password through `CryptoService`, reject passwordless administrators with safe code `ADMIN_REAUTH_UNAVAILABLE`, compare HMAC signatures with `timingSafeEqual`, and bind the token to the active session and purpose. Do not log the password or token.

- [ ] **Step 4: Implement platform lifecycle orchestration**

```ts
async createDeletion(actor: AuthPrincipal, tenantId: string, input: CreateLifecycleRequest, key: string, stepUp: string) {
  if (!this.stepUp.verify(stepUp, actor.userId, actor.sessionId, 'TENANT_DELETE_REQUEST')) throw new UnauthorizedException('ADMIN_REAUTH_REQUIRED');
  const requestHash = sha256(JSON.stringify({ tenantId, kind: 'DELETE', reasonCode: input.reasonCode }));
  const row = await this.callCreateFunction(actor.userId, tenantId, 'DELETE', input.reasonCode, key, requestHash);
  await this.queue.add('tenant-lifecycle.export', { requestId: row.id, tenantId }, { jobId: `tenant-lifecycle-${row.id}-${timeBucket}`, attempts: 1 });
  return row;
}
```

Use `writeSecurityAudit(prisma, { tenantId: null, ... })` for create/cancel/retry/download events. A repeated key plus equal hash returns the existing request; the same key with a different hash returns `409 LIFECYCLE_IDEMPOTENCY_CONFLICT`.

- [ ] **Step 5: Add controller routes and safe validation responses**

Use the exact routes from the spec plus `POST /api/admin/reauth`. The reauthentication response is `{ stepUpToken, expiresAt }`; it never echoes the password. Read `idempotency-key` and `x-admin-step-up` headers, parse all bodies with shared Zod schemas, and map only safe lifecycle codes. CSRF remains enforced by the global guard.

- [ ] **Step 6: Run API tests and commit**

Run: `pnpm --filter @autosale/api test -- admin-step-up.service.spec.ts tenant-lifecycle.service.spec.ts admin.controller.spec.ts`

Expected: PASS with non-admin, missing-CSRF, missing-step-up, replay and conflict cases.

```bash
git add apps/api/src/admin packages/contracts/src/tenant-lifecycle*
git commit -m "feat: add platform tenant lifecycle API"
```

### Task 3: Private streaming object storage and signed downloads

**Files:**
- Modify: `packages/integrations/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/integrations/src/object-storage.ts`
- Modify: `packages/integrations/src/s3-object-storage.ts`
- Create: `packages/integrations/src/s3-object-storage.spec.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Produces: `putStream`, `getStream`, `head`, and `createSignedDownloadUrl` without changing existing `put/get/delete` consumers.

- [ ] **Step 1: Write failing storage contract tests**

```ts
await storage.putStream({ key: 'tenant-lifecycle/fictional/export.zip', body: Readable.from(bytes), contentType: 'application/zip', contentLength: bytes.byteLength, checksumSha256: checksumBase64 });
await expect(storage.getStream('tenant-lifecycle/fictional/export.zip')).resolves.toEqual(expect.objectContaining({ contentType: 'application/zip', contentLength: bytes.byteLength }));
await expect(storage.head('tenant-lifecycle/fictional/export.zip')).resolves.toEqual(expect.objectContaining({ contentLength: bytes.byteLength }));
await expect(storage.createSignedDownloadUrl('tenant-lifecycle/fictional/export.zip', 300)).resolves.toMatch(/^https:/);
```

- [ ] **Step 2: Run and verify interface failures**

Run: `pnpm --filter @autosale/integrations test -- s3-object-storage.spec.ts`

Expected: FAIL because stream/head/presign methods are missing.

- [ ] **Step 3: Add AWS presigning and stream support**

Run: `pnpm --filter @autosale/integrations add @aws-sdk/s3-request-presigner@3.1118.0`

```ts
putStream(input: { key: string; body: Readable; contentType: string; contentLength: number; checksumSha256: string }): Promise<{ key: string; etag: string }>;
getStream(key: string): Promise<{ body: Readable; contentType: string; contentLength: number }>;
head(key: string): Promise<{ contentLength: number; contentType: string; checksumSha256: string | null }>;
createSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
```

Implement with `PutObjectCommand`, `HeadObjectCommand`, `GetObjectCommand` and `getSignedUrl`. Reject expiry outside `60..600` seconds and never return the signed URL from a logger-facing value.

- [ ] **Step 4: Run integration tests and commit**

Run: `pnpm --filter @autosale/integrations test && pnpm --filter @autosale/integrations typecheck`

Expected: PASS; existing object-storage callers remain type-compatible.

```bash
git add packages/integrations pnpm-lock.yaml
git commit -m "feat: support private lifecycle artifacts"
```

### Task 4: Deterministic tenant export writer and explicit redaction allowlist

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/worker/src/tenant-lifecycle/tenant-export-datasets.ts`
- Create: `apps/worker/src/tenant-lifecycle/tenant-export-datasets.spec.ts`
- Create: `apps/worker/src/tenant-lifecycle/tenant-export-writer.ts`
- Create: `apps/worker/src/tenant-lifecycle/tenant-export-writer.spec.ts`

**Interfaces:**
- Produces: `TENANT_EXPORT_DATASETS` as an explicit allowlist.
- Produces: `writeTenantExport({ prisma, storage, tenantId, requestId, directory, snapshotAt }): Promise<PreparedTenantExport>`.
- `PreparedTenantExport = { archivePath, sha256Hex, sha256Base64, sizeBytes, manifestVersion: 1, datasetCounts, objectCount }`.

- [ ] **Step 1: Write failing redaction and determinism tests**

```ts
const exportResult = await writeTenantExport(fixture);
expect(readJsonl(exportResult.archivePath, 'data/instagram-connections.jsonl')[0]).not.toHaveProperty('encryptedAccessToken');
expect(readJsonl(exportResult.archivePath, 'data/sessions.jsonl')).toEqual([]);
expect(manifest.excludedCategories).toContain('provider_credentials');
expect(second.sha256Hex).toBe(first.sha256Hex);
```

- [ ] **Step 2: Run and verify missing writer failures**

Run: `pnpm --filter @autosale/worker test -- tenant-export-datasets.spec.ts tenant-export-writer.spec.ts`

Expected: FAIL because the export modules do not exist.

- [ ] **Step 3: Add the archive dependency and explicit dataset map**

Run: `pnpm --filter @autosale/worker add archiver@7.0.1 && pnpm --filter @autosale/worker add -D @types/archiver@6.0.3`

```ts
export type TenantExportDataset = {
  name: string;
  page: (tx: Prisma.TransactionClient, tenantId: string, afterId: string | null, take: number) => Promise<readonly Record<string, Prisma.JsonValue>[]>;
};

export const TENANT_EXPORT_DATASETS: readonly TenantExportDataset[] = [
  conversationsDataset, messagesDataset, customerProfilesDataset, ordersDataset,
  orderItemsDataset, productsDataset, paymentsDataset, shipmentsDataset,
  deliveryEventsDataset, tenantSettingsDataset, membershipsDataset,
];
```

Every dataset selects named safe columns; never serialize Prisma model objects wholesale. Integration datasets export status and public account references only. User membership export includes identity/profile fields relevant to that tenant but excludes password/session/reset/verification hashes.

- [ ] **Step 4: Write JSONL, object manifest and ZIP deterministically**

Use a secure `mkdtemp` directory, stable dataset/file order, stable JSON key order, UTC ISO timestamps and ID cursor pages of 500. Build `objects/manifest.jsonl` from attachment, avatar and catalogue-source object references selected through the tenant transaction; calculate each referenced object's SHA-256 through object storage streaming before finalizing the manifest. Archive the prepared files with fixed ZIP entry timestamps, hash the completed archive, then remove the working directory in `finally`.

- [ ] **Step 5: Run worker tests and commit**

Run: `pnpm --filter @autosale/worker test -- tenant-export-datasets.spec.ts tenant-export-writer.spec.ts && pnpm --filter @autosale/worker typecheck`

Expected: PASS for pagination, stable checksum, object manifest and every prohibited field.

```bash
git add apps/worker/src/tenant-lifecycle apps/worker/package.json pnpm-lock.yaml
git commit -m "feat: build redacted tenant exports"
```

### Task 5: Lifecycle export worker, recovery, download and artifact expiry

**Files:**
- Create: `apps/worker/src/tenant-lifecycle/tenant-lifecycle.processor.ts`
- Create: `apps/worker/src/tenant-lifecycle/tenant-lifecycle.processor.spec.ts`
- Create: `apps/worker/src/tenant-lifecycle/tenant-lifecycle.reconciler.ts`
- Create: `apps/worker/src/tenant-lifecycle/tenant-lifecycle.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/admin/tenant-lifecycle.service.ts`
- Modify: `apps/api/src/admin/tenant-lifecycle.service.spec.ts`

**Interfaces:**
- Consumes: job schema, state machine, export writer and object-storage methods.
- Produces: BullMQ job `tenant-lifecycle.export` and recovery polling through `worker_due_tenant_lifecycle_requests`.

- [x] **Step 1: Write failing claim/fencing/publish tests**

```ts
await expect(processor.process({ tenantId, requestId })).resolves.toEqual('EXPORT_READY');
expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ leaseId, status: 'EXPORTING' }) }));
await expect(staleProcessor.process({ tenantId, requestId })).resolves.toEqual('IGNORED');
expect(storage.delete).toHaveBeenCalledWith(expect.stringContaining(requestId));
```

- [x] **Step 2: Run and observe missing processor failures**

Run: `pnpm --filter @autosale/worker test -- tenant-lifecycle.processor.spec.ts tenant-lifecycle.reconciler.spec.ts`

Expected: FAIL because processor/reconciler modules are absent.

- [x] **Step 3: Implement idempotent claim, export and publication**

```ts
const claimed = await withTenantTransaction(prisma, job.tenantId, tx => tx.tenantLifecycleRequest.updateMany({
  where: { id: job.requestId, tenantId: job.tenantId, status: { in: ['REQUESTED', 'FAILED'] }, nextAttemptAt: { lte: now } },
  data: { status: 'EXPORTING', leaseId, leaseExpiresAt, attemptCount: { increment: 1 }, lastErrorCode: null },
}));
```

After local archive completion, upload directly to the final private key, verify `head()` size/checksum, then fence the durable `EXPORT_READY` update by request ID, tenant ID, status and lease ID. If durable publication loses the lease, delete the uploaded object. Map failures to bounded codes and exponential `nextAttemptAt`; never persist raw errors.

- [x] **Step 4: Add recovery and seven-day cleanup**

The reconciler enqueues due `REQUESTED`, retryable `FAILED`, and expired `EXPORTING` rows using versioned `jobId`. Cleanup gets only tenant/request IDs from its worker function, loads metadata under tenant context, deletes the object, and clears object-key/download metadata while retaining checksum and audit timestamps.

- [x] **Step 5: Add the worker queue and safe metrics**

Register queue/worker `tenant-lifecycle` in `main.ts`, concurrency `1`, attempts `1` at BullMQ level because durable retry belongs to the processor. Emit only `operation=tenant_lifecycle_export|tenant_lifecycle_cleanup`, `result`, duration and byte histograms; omit tenant/request/object identifiers from metric labels and ordinary logs.

- [x] **Step 6: Implement short-lived download issuance**

`TenantLifecycleService.createDownload` must read a ready, unexpired artifact through the bounded platform function, verify the object with `head`, issue a 300-second signed URL, append a security audit event without the URL/key, and return `{ url, expiresAt }` directly to the authenticated admin.

- [x] **Step 7: Run API/worker tests and commit**

Run: `pnpm --filter @autosale/worker test -- tenant-lifecycle.processor.spec.ts tenant-lifecycle.reconciler.spec.ts && pnpm --filter @autosale/api test -- tenant-lifecycle.service.spec.ts`

Expected: PASS for retry, stale lease, partial upload, cleanup and expired download cases.

```bash
git add apps/worker apps/api/src/admin
git commit -m "feat: process tenant lifecycle exports"
```

### Task 6: Freeze external inbound ingestion

**Files:**
- Modify: `apps/api/src/meta/meta-event.service.ts`
- Modify: `apps/api/src/meta/meta-event.service.spec.ts`
- Modify: `apps/api/src/integrations/telegram.service.ts`
- Modify: `apps/api/src/integrations/telegram.service.spec.ts`
- Modify: `apps/api/src/team/team.service.ts`
- Modify: `apps/api/src/team/team.service.spec.ts`
- Modify: `apps/api/src/settings/order-settings.service.ts`
- Modify: `apps/api/src/settings/settings-tenant-scope.spec.ts`
- Modify: `apps/api/src/commercial-settings/commercial-settings.service.ts`
- Modify: `apps/api/src/commercial-settings/commercial-settings.service.spec.ts`
- Modify: `apps/api/src/integrations/instagram-oauth.service.ts`
- Modify: `apps/api/src/integrations/instagram-oauth.service.spec.ts`
- Modify: `apps/api/src/integrations/google-oauth.service.ts`
- Modify: `apps/api/src/integrations/google-oauth.service.spec.ts`
- Modify: `apps/api/src/delivery/meest-connection.service.ts`
- Modify: `apps/api/src/delivery/meest-connection.service.spec.ts`
- Modify: `apps/api/src/delivery/ukrposhta-connection.service.ts`
- Modify: `apps/api/src/delivery/ukrposhta-connection.service.spec.ts`
- Modify: `apps/api/src/integrations/telegram-webhook.controller.spec.ts`
- Modify: `apps/worker/src/instagram/instagram.processor.ts`
- Modify: `apps/worker/src/instagram/instagram.processor.spec.ts`

**Interfaces:**
- Consumes: `assertTenantAcceptingMutations(..., 'META_INBOUND' | 'TELEGRAM_INBOUND' | 'ORDER_RECOGNITION')`.
- Produces: acknowledged-but-not-normalized provider callbacks after the freeze boundary.

- [ ] **Step 1: Write failing callback freeze tests**

```ts
await expect(meta.ingest(frozenTenant, signedPayload)).resolves.toEqual({ accepted: true, frozen: true });
expect(webhookEventCreate).not.toHaveBeenCalled();
await expect(telegram.receiveBusinessUpdate(frozenTenant, fictionalUpdate)).resolves.toEqual({ accepted: true, frozen: true });
expect(messageCreate).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run and verify current ingestion still writes**

Run: `pnpm --filter @autosale/api test -- meta-event.service.spec.ts telegram.service.spec.ts telegram-webhook.controller.spec.ts && pnpm --filter @autosale/worker test -- instagram.processor.spec.ts`

Expected: FAIL because frozen tenants are not checked.

- [ ] **Step 3: Apply the guard after verified authority and before persistence**

Resolve provider authority exactly as today, enter that tenant transaction, and call the guard before creating webhook/message/profile/order records. Return a provider-safe acknowledgement and emit `tenant_lifecycle_freeze_rejections_total{surface,safe_reason}` without body, sender, chat or participant data.

- [ ] **Step 4: Guard delayed Instagram normalization/order recognition**

Re-read the lifecycle gate at processing time. A queued pre-freeze job that has not created a durable business side effect returns `IGNORED_FROZEN`; a job with a provider-confirmed pre-boundary send may finish its idempotent local finalization but may not enqueue a new downstream order/export/notification.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @autosale/api test -- meta-event.service.spec.ts telegram.service.spec.ts telegram-webhook.controller.spec.ts && pnpm --filter @autosale/worker test -- instagram.processor.spec.ts`

Expected: PASS and no empty message/order is created for frozen callbacks.

```bash
git add apps/api/src/meta apps/api/src/integrations/telegram* apps/worker/src/instagram/instagram.processor*
git commit -m "feat: freeze provider ingestion during deletion requests"
```

### Task 7: Freeze authenticated business mutations

**Files:**
- Modify: `apps/api/src/conversations/conversations.service.ts`
- Modify: `apps/api/src/conversations/conversations.service.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/orders.service.spec.ts`
- Modify: `apps/api/src/orders/commercial-terms.service.ts`
- Modify: `apps/api/src/orders/commercial-terms.service.spec.ts`
- Modify: `apps/api/src/orders/payments.service.ts`
- Modify: `apps/api/src/orders/payments.service.spec.ts`
- Modify: `packages/database/src/procurement-store.ts`
- Modify: `packages/database/src/procurement-store.postgres.spec.ts`
- Modify: `apps/api/src/catalogue/catalogue.service.ts`
- Modify: `apps/api/src/catalogue/catalogue.service.spec.ts`
- Modify: `apps/api/src/catalogue-import/catalogue-import.service.ts`
- Modify: `apps/api/src/catalogue-import/catalogue-import.service.spec.ts`
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.service.ts`
- Modify: `apps/api/src/catalogue-sources/catalogue-sources.service.spec.ts`
- Modify: `apps/api/src/delivery/delivery.service.ts`
- Modify: `apps/api/src/delivery/delivery.service.spec.ts`
- Modify: `apps/api/src/integrations/telegram.service.ts`
- Modify: `apps/api/src/integrations/telegram.service.spec.ts`

**Interfaces:**
- Consumes: the shared mutation guard inside existing tenant transactions.
- Produces: safe API error `TENANT_LIFECYCLE_FROZEN`; read-only endpoints remain available.

- [ ] **Step 1: Add one failing mutation test per business surface**

```ts
guard.mockRejectedValue(new TenantLifecycleFrozenError('ORDER_MUTATION'));
await expect(service.update(tenantId, orderId, actorId, input)).rejects.toMatchObject({ message: 'TENANT_LIFECYCLE_FROZEN' });
expect(orderUpdate).not.toHaveBeenCalled();
```

Cover manual replies/order triggers, order editing/approval, commercial terms, payment facts, procurement decisions/dispatch, catalogue create/update/import/sync, shipment create/cancel, Telegram test/supplier sends, team membership changes, order settings, legal entities/bank accounts, provider connect/disconnect and delivery-connection changes. Keep GET/list/detail reads and personal profile/security corrections green.

- [ ] **Step 2: Run focused suites and verify each new case fails**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts orders.service.spec.ts commercial-terms.service.spec.ts payments.service.spec.ts catalogue.service.spec.ts catalogue-import.service.spec.ts catalogue-sources.service.spec.ts delivery.service.spec.ts telegram.service.spec.ts team.service.spec.ts settings-tenant-scope.spec.ts commercial-settings.service.spec.ts instagram-oauth.service.spec.ts google-oauth.service.spec.ts meest-connection.service.spec.ts ukrposhta-connection.service.spec.ts`

Expected: FAIL because mutations still proceed.

- [ ] **Step 3: Insert the guard inside each mutation transaction**

```ts
return withTenantTransaction(this.prisma, tenantId, async (tx) => {
  await assertTenantAcceptingMutations(tx, tenantId, 'ORDER_MUTATION');
  return tx.order.update(/* existing command */);
});
```

Do not place the check before the transaction or cache it between requests. Map `TenantLifecycleFrozenError` through the existing safe exception layer; do not add field validation because this is a form-level lifecycle conflict.

- [ ] **Step 4: Run API/database tests and commit**

Run: `pnpm --filter @autosale/api test -- conversations.service.spec.ts orders.service.spec.ts commercial-terms.service.spec.ts payments.service.spec.ts catalogue.service.spec.ts catalogue-import.service.spec.ts catalogue-sources.service.spec.ts delivery.service.spec.ts telegram.service.spec.ts team.service.spec.ts settings-tenant-scope.spec.ts commercial-settings.service.spec.ts instagram-oauth.service.spec.ts google-oauth.service.spec.ts meest-connection.service.spec.ts ukrposhta-connection.service.spec.ts && pnpm --filter @autosale/database test -- procurement-store.postgres.spec.ts`

Expected: PASS with reads unaffected and every mutation rejected before writes/queue dispatch.

```bash
git add apps/api/src packages/database/src/procurement-store*
git commit -m "feat: freeze tenant business mutations"
```

### Task 8: Freeze queued and scheduled external side effects

**Files:**
- Modify: `apps/worker/src/catalogue/google-catalogue-sync.processor.ts`
- Modify: `apps/worker/src/catalogue/google-catalogue-sync.processor.spec.ts`
- Modify: `apps/worker/src/catalogue/catalogue-mapping.processor.ts`
- Modify: `apps/worker/src/catalogue/catalogue-mapping.processor.spec.ts`
- Modify: `apps/worker/src/delivery/shipment-create.service.ts`
- Modify: `apps/worker/src/delivery/shipment-create.service.spec.ts`
- Modify: `apps/worker/src/delivery/shipment-status.service.ts`
- Modify: `apps/worker/src/delivery/shipment-status.service.spec.ts`
- Modify: `apps/worker/src/delivery/ukrposhta-shipment.service.ts`
- Modify: `apps/worker/src/delivery/ukrposhta-shipment.service.spec.ts`
- Modify: `apps/worker/src/telegram/telegram-delivery.service.ts`
- Modify: `apps/worker/src/telegram/telegram-delivery.service.spec.ts`
- Modify: `apps/worker/src/google-sheets/google-sheets-sync.processor.ts`
- Modify: `apps/worker/src/google-sheets/google-sheets-sync.processor.spec.ts`
- Modify: `apps/worker/src/notifications/telegram-alert.service.ts`
- Modify: `apps/worker/src/notifications/telegram-alert.service.spec.ts`

**Interfaces:**
- Consumes: the same transaction-local lifecycle guard.
- Produces: terminal result `IGNORED_FROZEN` for work that has not crossed a provider-confirmed boundary.

- [ ] **Step 1: Write failing pre-provider-call tests**

```ts
await expect(service.process(job)).resolves.toBe('IGNORED_FROZEN');
expect(provider.createShipment).not.toHaveBeenCalled();
expect(googleSheets.appendOrder).not.toHaveBeenCalled();
expect(telegram.sendMessage).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused worker tests**

Run: `pnpm --filter @autosale/worker test -- google-catalogue-sync.processor.spec.ts catalogue-mapping.processor.spec.ts shipment-create.service.spec.ts shipment-status.service.spec.ts ukrposhta-shipment.service.spec.ts telegram-delivery.service.spec.ts google-sheets-sync.processor.spec.ts telegram-alert.service.spec.ts`

Expected: FAIL because provider clients are still invoked.

- [ ] **Step 3: Guard immediately before every new provider side effect**

Re-read the gate in the same tenant transaction used to claim work. Allow only local reconciliation of an already provider-confirmed operation identified by existing provider document/message IDs and a `providerCreatedAt`/sent boundary earlier than `ingestionFrozenAt`. Record a safe ignored status instead of retrying forever.

- [ ] **Step 4: Run tests and commit**

Run the command from Step 2 again.

Expected: PASS for both frozen-before-provider and provider-confirmed-finalization cases.

```bash
git add apps/worker/src
git commit -m "feat: stop frozen tenant side effects"
```

### Task 9: Non-destructive retention dry-run

**Files:**
- Create: `apps/worker/src/tenant-lifecycle/retention-policy.ts`
- Create: `apps/worker/src/tenant-lifecycle/retention-policy.spec.ts`
- Create: `apps/worker/src/tenant-lifecycle/retention-dry-run.processor.ts`
- Create: `apps/worker/src/tenant-lifecycle/retention-dry-run.processor.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/admin/tenant-lifecycle.service.ts`
- Modify: `apps/api/src/admin/tenant-lifecycle.service.spec.ts`
- Modify: `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/admin/admin.controller.spec.ts`

**Interfaces:**
- Produces: `RETENTION_POLICIES` with category, enabled/dry-run-only state and cutoff calculator.
- Produces: BullMQ job `tenant-lifecycle.retention-dry-run` carrying only `{ runId, tenantId }`.
- Produces: `POST /api/admin/retention/dry-runs` accepting `{ tenantId }` plus `idempotency-key`, and `GET /api/admin/retention/dry-runs?tenantId=<uuid>` returning bounded summaries.

- [ ] **Step 1: Write failing zero-mutation retention tests**

```ts
const result = await processor.process({ runId, tenantId });
expect(result.summary).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'RAW_WEBHOOKS', candidateCount: 4 })]));
expect(prisma.$executeRaw).not.toHaveBeenCalled();
expect(JSON.stringify(result.summary)).not.toContain('Fictional customer message');
```

- [ ] **Step 2: Run and verify missing processor failures**

Run: `pnpm --filter @autosale/worker test -- retention-policy.spec.ts retention-dry-run.processor.spec.ts && pnpm --filter @autosale/api test -- tenant-lifecycle.service.spec.ts admin.controller.spec.ts`

Expected: FAIL because dry-run contracts and processor are absent.

- [ ] **Step 3: Add explicit launch-baseline policy definitions**

```ts
export const RETENTION_POLICIES = [
  { category: 'RAW_WEBHOOKS', days: 30, status: 'DRY_RUN_ONLY' },
  { category: 'USER_NOTIFICATIONS', days: 90, status: 'DRY_RUN_ONLY' },
  { category: 'SECURITY_AUDIT', days: 365, status: 'DRY_RUN_ONLY' },
] as const;
```

Categories whose legal/accounting duration is merchant-specific return `POLICY_NOT_CONFIGURED`; do not infer a cutoff for conversations, orders, payments or delivery/customer data.

- [ ] **Step 4: Implement count-only tenant queries and durable summary**

Run each category query inside `withTenantTransaction`, returning only category, cutoff, candidate count, oldest candidate timestamp and approximate bytes when PostgreSQL can safely estimate it. Persist only this summary JSON and safe status/error codes. No candidate IDs or content leave the transaction.

- [ ] **Step 5: Wire API/queue, run tests and commit**

Run the command from Step 2 again.

Expected: PASS and a database spy proves no candidate update/delete SQL was executed.

```bash
git add apps/worker/src/tenant-lifecycle apps/worker/src/main.ts apps/api/src/admin
git commit -m "feat: preview tenant retention candidates"
```

### Task 10: Platform-admin lifecycle interface

**Files:**
- Create: `apps/web/src/components/admin-tenant-lifecycle.tsx`
- Create: `apps/web/src/components/admin-tenant-lifecycle.spec.tsx`
- Modify: `apps/web/src/components/admin-dashboard.tsx`
- Modify: `apps/web/src/components/admin-dashboard.spec.tsx`
- Modify: `apps/web/app/admin/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `packages/contracts/src/tenant-lifecycle.ts`

**Interfaces:**
- Consumes: lifecycle list/detail/create/cancel/retry/download and retention dry-run endpoints.
- Produces: compact per-tenant lifecycle controls without exposing customer content.

- [ ] **Step 1: Write failing UI behavior tests**

```tsx
expect(screen.getByRole('button', { name: 'Створити експорт' })).toBeEnabled();
await user.click(screen.getByRole('button', { name: 'Підготувати видалення' }));
expect(screen.getByLabelText('Поточний пароль')).toHaveAttribute('aria-invalid', 'false');
expect(screen.queryByRole('button', { name: /видалити дані назавжди/i })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify the missing component failure**

Run: `pnpm --filter @autosale/web test -- admin-tenant-lifecycle.spec.tsx admin-dashboard.spec.tsx`

Expected: FAIL because the lifecycle component is absent.

- [ ] **Step 3: Implement lifecycle cards and safe confirmations**

Show request kind/status, requested/export/expiry timestamps, safe error copy and actions. `EXPORT` needs one confirmation; `DELETE` needs tenant-name confirmation plus current-password step-up. Use `FormField`, `FieldError`, `focusFirstInvalid`, `LoadingButton`, `secondary-button` for export, `danger-button` for deletion preparation, and `text-button` for cancel/retry. Preserve values on server failure and clear only the edited field's error.

- [ ] **Step 4: Add responsive styles without horizontal overflow**

Use the existing admin max width, stack lifecycle actions below 720px, wrap hashes safely, and keep the signed URL out of rendered text by initiating download immediately from the response.

- [ ] **Step 5: Run UI contract tests and commit**

Run: `pnpm --filter @autosale/web test -- admin-tenant-lifecycle.spec.tsx admin-dashboard.spec.tsx form-validation-contract.spec.ts button-style-contract.spec.ts`

Expected: PASS with no browser-default/legacy buttons and no unregistered validation exception.

```bash
git add apps/web packages/contracts/src/tenant-lifecycle.ts
git commit -m "feat: add tenant lifecycle admin interface"
```

### Task 11: Cross-service acceptance, documentation and regression verification

**Files:**
- Create: `docs/acceptance/tenant-data-lifecycle-checklist.md`
- Modify: `docs/features/README.md`
- Modify: `docs/operations/data-protection-and-retention.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/adr/0002-shared-schema-tenant-isolation.md`
- Modify: `README.md`
- Create: `tests/e2e/tenant-data-lifecycle.spec.ts`

**Interfaces:**
- Consumes: all phase-one functionality.
- Produces: reproducible acceptance evidence and updated canonical status.

- [ ] **Step 1: Write the failing end-to-end acceptance test**

```ts
test('admin exports and freezes only the selected fictional tenant', async ({ page }) => {
  await loginPlatformAdmin(page);
  await createExportForTenant(page, fictionalTenantA);
  await expect(page.getByText('Експорт готовий')).toBeVisible();
  await prepareDeletionForTenant(page, fictionalTenantA);
  await expectMutationRejected(fictionalTenantA, 'TENANT_LIFECYCLE_FROZEN');
  await expectMutationAccepted(fictionalTenantB);
});
```

- [ ] **Step 2: Run acceptance and fix only lifecycle regressions**

Run: `pnpm test:e2e -- tenant-data-lifecycle.spec.ts`

Expected: PASS against isolated fictional fixtures; downloaded archive checksum equals API metadata and prohibited fields are absent.

- [ ] **Step 3: Update canonical documentation with verified behavior**

Mark phase one `Available` only after acceptance is green. Record queue name, artifact TTL, safe retry procedure, how to cancel a frozen request, how to inspect dry-run summaries, and that physical deletion/ledger replay remain launch gates. State explicitly that phase one does not change the restore procedure because no deletion ledger exists yet; a future destructive phase must add mandatory ledger replay before runtime startup. Keep the feature index compact and link the acceptance checklist.

- [ ] **Step 4: Run the complete repository verification**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `pnpm test:e2e`

Expected: all suites pass. If Docker-dependent PostgreSQL tests are skipped, start the repository test database and rerun every `*.postgres.spec.ts` lifecycle/grant suite before continuing.

- [ ] **Step 5: Audit the staged change and commit**

Run: `git diff --check && git status --short && git diff --stat master...HEAD`

Expected: no secrets, dumps, runtime files, build output, production data or `artifacts/` entries.

```bash
git add docs README.md tests/e2e/tenant-data-lifecycle.spec.ts
git commit -m "docs: verify tenant lifecycle phase one"
```

### Task 12: Merge, push and manually deploy the verified release

**Files:**
- Verify only: `infra/scripts/deploy-commit.sh`
- Verify only: `docs/operations/deployment.md`

**Interfaces:**
- Consumes: verified feature branch commit.
- Produces: `master` and production running the exact pushed commit; removes the merged feature branch.

- [ ] **Step 1: Record the release commit and create a pre-deploy backup**

Run: `git rev-parse HEAD`

Run the documented restricted-role backup command from `docs/operations/deployment.md`; record its completed backup directory and verify no `.incomplete-*` directory remains.

- [ ] **Step 2: Merge into current master and push**

```bash
git switch master
git pull --ff-only origin master
git merge --no-ff codex/tenant-data-lifecycle-design -m "merge: tenant data lifecycle phase one"
git push origin master
```

Expected: push succeeds and `git rev-parse master` equals `git rev-parse origin/master`.

- [ ] **Step 3: Manually deploy the exact master commit**

Run the documented `infra/scripts/deploy-commit.sh <master-sha>` command on the production host. Do not rely on the currently unconfigured automatic deploy.

- [ ] **Step 4: Run production-safe smoke checks**

Verify public health, login, Ukrainian marketing page, API/worker metrics, the platform-admin lifecycle list, creation/cancellation of an `EXPORT` for the dedicated fictional test tenant, and absence of critical logs. Do not create a production `DELETE` request during smoke testing.

- [ ] **Step 5: Prove cleanup and remove the feature branch**

```bash
git branch --merged master
git diff master..codex/tenant-data-lifecycle-design --
git branch -d codex/tenant-data-lifecycle-design
git push origin --delete codex/tenant-data-lifecycle-design
git status --short --branch
```

Expected: no unique tracked changes remain, `master...origin/master` is clean, and the pre-existing untracked `artifacts/` directory is untouched.
