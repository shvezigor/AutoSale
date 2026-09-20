# Order Payment Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited manual payment facts to orders so owners and managers can record partial payments while AutoSale calculates paid amount, balance, and payment status.

**Architecture:** Add a tenant-scoped `OrderPayment` record beside `OrderCommercialTerms`; monetary fields are immutable and owner-only cancellation preserves history. A focused API service validates and writes payment commands transactionally, while order reads expose a computed summary. The order detail renders the entry form and history, and the orders table adds a payment status indicator and filter.

**Tech Stack:** PostgreSQL, Prisma 7, NestJS 11, Zod 4, Next.js 16, React 19, Vitest, Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-20-order-payment-facts-design.md`

## Global Constraints

- PostgreSQL is the source of truth; approval, procurement, shipment, delivery, and Google Sheets export never create payments.
- Expected amount and currency come only from `OrderCommercialTerms` with `pricingStatus = READY` and a non-null total.
- Payment currency equals the order currency and is never accepted from the browser.
- Owners and managers may create payments; only owners may cancel one, and cancellation requires a reason.
- Payment amount, currency, method, received date, account/carrier selection, creator, and creation time are immutable after insert.
- An active payment locks commercial entity, account, currency, total, and item corrections; cancelling every payment removes that lock.
- Bank-transfer accounts are tenant-scoped and must match the order legal entity and currency.
- Command replays are idempotent; reusing a key with a different payload returns a conflict.
- Notes, cancellation reasons, full IBANs, and personal data never enter telemetry labels or application logs.
- First release excludes refunds, bank webhooks, carrier COD reconciliation, online acquiring, financial reports, and AutoSale subscription billing.

---

## File Structure

### Create

- `packages/database/prisma/migrations/20260920220000_order_payment_facts/migration.sql` — additive payment schema, constraints, indexes, and relations.
- `packages/database/src/order-payments.ts` — pure decimal summary calculation and mapping helpers shared by API reads.
- `packages/database/src/order-payments.spec.ts` — domain status and balance tests.
- `packages/database/src/order-payments-migration.spec.ts` — migration contract checks.
- `packages/database/src/order-payments.postgres.spec.ts` — PostgreSQL tenant, uniqueness, and cancellation behavior.
- `packages/contracts/src/payments.ts` — payment methods, statuses, commands, summaries, and Zod schemas.
- `packages/contracts/src/payments.spec.ts` — validation and normalization tests.
- `apps/api/src/orders/payments.controller.ts` — read/create/cancel HTTP endpoints and role requirements.
- `apps/api/src/orders/payments.controller.spec.ts` — endpoint validation, CSRF, and authorization tests.
- `apps/api/src/orders/payments.service.ts` — transactional command handling, idempotency, audit, and summary reads.
- `apps/api/src/orders/payments.service.spec.ts` — unit tests for domain and failure paths.
- `apps/web/src/components/order-payments-card.tsx` — summary, add-payment form, history, and owner cancellation.
- `apps/web/src/components/order-payments-card.spec.tsx` — localized interactive UI tests.
- `docs/acceptance/order-payment-facts-checklist.md` — production-safe acceptance evidence and deferred scope.

### Modify

- `packages/database/prisma/schema.prisma` — add `PaymentMethod`, `OrderPayment`, and tenant/order/user/account relations.
- `packages/database/src/index.ts` — export the payment domain helpers.
- `packages/contracts/package.json` and `packages/contracts/src/index.ts` — export `@autosale/contracts/payments`.
- `packages/contracts/src/orders.ts` — add `paymentSummary` and `paymentStatus` filtering.
- `apps/api/src/orders/orders.module.ts` — register payment controller/service.
- `apps/api/src/orders/orders.service.ts` — include payment rows, compute summaries, filter lists, and block item corrections.
- `apps/api/src/orders/orders.controller.ts` and its tests — validate the payment-status list query.
- `apps/api/src/orders/commercial-terms.service.ts` and its tests — reject commercial changes while active payments exist.
- `apps/web/app/(workspace)/orders/[id]/page.tsx` — pass current membership role to the review panel.
- `apps/web/app/(workspace)/orders/page.tsx` — parse and forward payment status.
- `apps/web/src/api/orders.ts` — forward payment status to the API.
- `apps/web/src/components/order-review-panel.tsx` and tests — mount payment card and lock item editing when paid.
- `apps/web/src/components/orders-table.tsx` and tests — render and preserve payment filter/status.
- `apps/web/src/i18n/messages/uk.ts` and `apps/web/src/i18n/messages/en.ts` — all payment UI copy.
- `apps/web/app/globals.css` — responsive payment card and table badge styles.
- `tests/e2e/orders.spec.ts` — owner partial-payment, exact-payment, and cancellation journey.
- `docs/features/README.md`, `docs/acceptance/order-commercial-terms-checklist.md`, and `tasks/todo.md` — verified feature status and remaining automation backlog.

---

### Task 1: Add the payment domain contracts

**Files:**
- Create: `packages/contracts/src/payments.ts`
- Create: `packages/contracts/src/payments.spec.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Produces: `PaymentMethod`, `OrderPaymentStatus`, `OrderPaymentRecord`, `OrderPaymentSummary`, `CreateOrderPayment`, `CancelOrderPayment`, `createOrderPaymentSchema`, `cancelOrderPaymentSchema`.
- Produces: `ManagerOrder.paymentSummary: OrderPaymentSummary | null` and `OrderListQuery.paymentStatus?: OrderPaymentStatus`.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { cancelOrderPaymentSchema, createOrderPaymentSchema } from './payments.js';

describe('payment contracts', () => {
  it('normalizes a valid bank transfer command', () => {
    expect(createOrderPaymentSchema.parse({
      amount: '1200.00', method: 'BANK_TRANSFER', receivedAt: '2026-09-20T12:00:00.000Z',
      bankAccountId: '11111111-1111-4111-8111-111111111111', carrier: null, note: 'Передоплата',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })).toMatchObject({ amount: '1200.00', method: 'BANK_TRANSFER', carrier: null });
  });

  it('rejects zero money, missing method-specific data, and a blank cancellation reason', () => {
    expect(() => createOrderPaymentSchema.parse({ amount: '0.00', method: 'CASH', receivedAt: '2026-09-20T12:00:00.000Z', idempotencyKey: crypto.randomUUID() })).toThrow();
    expect(() => createOrderPaymentSchema.parse({ amount: '10.00', method: 'BANK_TRANSFER', receivedAt: '2026-09-20T12:00:00.000Z', idempotencyKey: crypto.randomUUID() })).toThrow();
    expect(() => cancelOrderPaymentSchema.parse({ reason: ' ', idempotencyKey: crypto.randomUUID() })).toThrow();
  });
});
```

- [ ] **Step 2: Run the contract test and verify the missing module failure**

Run: `pnpm --filter @autosale/contracts test -- payments.spec.ts`

Expected: FAIL because `./payments.js` does not exist.

- [ ] **Step 3: Implement the contracts and exports**

```ts
import { z } from 'zod';
import { moneyStringSchema } from './commercial.js';

export const paymentMethodSchema = z.enum(['BANK_TRANSFER', 'CASH', 'CASH_ON_DELIVERY', 'OTHER']);
export const orderPaymentStatusSchema = z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID']);
const commandBase = z.object({
  amount: moneyStringSchema.refine((value) => Number(value) > 0),
  receivedAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).nullable().optional().default(null),
  idempotencyKey: z.string().uuid(),
});

export const createOrderPaymentSchema = z.discriminatedUnion('method', [
  commandBase.extend({ method: z.literal('BANK_TRANSFER'), bankAccountId: z.string().uuid(), carrier: z.null().optional().default(null) }),
  commandBase.extend({ method: z.literal('CASH'), bankAccountId: z.null().optional().default(null), carrier: z.null().optional().default(null) }),
  commandBase.extend({ method: z.literal('CASH_ON_DELIVERY'), bankAccountId: z.null().optional().default(null), carrier: z.enum(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA']) }),
  commandBase.extend({ method: z.literal('OTHER'), bankAccountId: z.null().optional().default(null), carrier: z.null().optional().default(null) }),
]);
export const cancelOrderPaymentSchema = z.object({ reason: z.string().trim().min(3).max(500), idempotencyKey: z.string().uuid() }).strict();
```

Define summaries with decimal strings, ISO timestamps, masked account labels, actor display value, cancellation metadata, and `remainingAmount` allowed to be negative for overpayment. Add the new export map entry for `./payments` following `./commercial`.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @autosale/contracts test -- payments.spec.ts && pnpm --filter @autosale/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contract increment**

```bash
git add packages/contracts
git commit -m "feat(contracts): define order payment facts"
```

---

### Task 2: Add the database model and pure summary calculation

**Files:**
- Create: `packages/database/prisma/migrations/20260920220000_order_payment_facts/migration.sql`
- Create: `packages/database/src/order-payments.ts`
- Create: `packages/database/src/order-payments.spec.ts`
- Create: `packages/database/src/order-payments-migration.spec.ts`
- Create: `packages/database/src/order-payments.postgres.spec.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: `OrderPaymentStatus` and payment summary types from Task 1.
- Produces: `calculateOrderPaymentSummary(expectedAmount: string, payments: PaymentAmountRow[]): PaymentAmounts`.
- Produces: Prisma model `OrderPayment` with tenant-scoped command uniqueness and cancellation audit.

- [ ] **Step 1: Write failing pure domain tests**

```ts
describe('calculateOrderPaymentSummary', () => {
  it.each([
    [[], 'UNPAID', '0.00', '500.00'],
    [[{ amount: '200.00', cancelledAt: null }], 'PARTIALLY_PAID', '200.00', '300.00'],
    [[{ amount: '500.00', cancelledAt: null }], 'PAID', '500.00', '0.00'],
    [[{ amount: '550.00', cancelledAt: null }], 'OVERPAID', '550.00', '-50.00'],
    [[{ amount: '500.00', cancelledAt: new Date() }], 'UNPAID', '0.00', '500.00'],
  ])('derives %s as %s', (payments, status, paidAmount, remainingAmount) => {
    expect(calculateOrderPaymentSummary('500.00', payments)).toEqual({ status, expectedAmount: '500.00', paidAmount, remainingAmount });
  });
});
```

- [ ] **Step 2: Run the domain test and verify failure**

Run: `pnpm --filter @autosale/database test -- order-payments.spec.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement decimal-safe summary calculation**

Use integer minor units for arithmetic rather than JavaScript floating point. Reject mismatched decimal precision at the contract boundary; return fixed two-decimal strings and choose status by comparing paid minor units with expected minor units.

```ts
export function calculateOrderPaymentSummary(expectedAmount: string, payments: PaymentAmountRow[]): PaymentAmounts {
  const expected = toMinorUnits(expectedAmount);
  const paid = payments.filter((payment) => payment.cancelledAt === null).reduce((sum, payment) => sum + toMinorUnits(payment.amount), 0n);
  return {
    expectedAmount: fromMinorUnits(expected), paidAmount: fromMinorUnits(paid), remainingAmount: fromMinorUnits(expected - paid),
    status: paid === 0n ? 'UNPAID' : paid < expected ? 'PARTIALLY_PAID' : paid === expected ? 'PAID' : 'OVERPAID',
  };
}
```

- [ ] **Step 4: Write schema and migration tests before the migration**

Assert the migration contains: enum/check values for four methods, `tenant_id`, `order_id`, positive amount check, three-character currency, `received_at`, creator, command key/hash, cancellation actor/reason/time/key/hash, `UNIQUE (tenant_id, idempotency_key)`, composite tenant/order relation, and indexes for order history and active records. In the PostgreSQL test, insert two payments with distinct keys, reject a duplicate tenant/key, allow the same key in another tenant, and ensure cancellation fields do not alter the original amount.

- [ ] **Step 5: Run migration tests and verify failure**

Run: `pnpm --filter @autosale/database test -- order-payments-migration.spec.ts order-payments.postgres.spec.ts`

Expected: FAIL because the migration/model is missing.

- [ ] **Step 6: Add Prisma schema and additive SQL migration**

Add `PaymentMethod` and `OrderPayment`; relate it to `Tenant`, `Order`, `User` for creator/canceller, and optional `TenantBankAccount`. Use `Decimal(14,2)`, `VarChar(3)`, and separate create/cancel request hashes. Add `@@unique([tenantId, idempotencyKey])`, `@@index([tenantId, orderId, receivedAt(sort: Desc)])`, and `@@index([tenantId, orderId, cancelledAt])`. Generate Prisma output with `pnpm --filter @autosale/database generate`.

```prisma
enum PaymentMethod { BANK_TRANSFER CASH CASH_ON_DELIVERY OTHER }

model OrderPayment {
  id                         String        @id @default(uuid()) @db.Uuid
  tenantId                   String        @map("tenant_id") @db.Uuid
  orderId                    String        @map("order_id") @db.Uuid
  amount                     Decimal       @db.Decimal(14, 2)
  currency                   String        @db.VarChar(3)
  method                     PaymentMethod
  receivedAt                 DateTime      @map("received_at")
  bankAccountId              String?       @map("bank_account_id") @db.Uuid
  carrier                    String?
  note                       String?
  createdBy                  String        @map("created_by") @db.Uuid
  idempotencyKey             String        @map("idempotency_key") @db.Uuid
  requestHash                String        @map("request_hash") @db.VarChar(64)
  cancelledAt                DateTime?     @map("cancelled_at")
  cancelledBy                String?       @map("cancelled_by") @db.Uuid
  cancellationReason         String?       @map("cancellation_reason")
  cancellationIdempotencyKey String?       @map("cancellation_idempotency_key") @db.Uuid
  cancellationRequestHash    String?       @map("cancellation_request_hash") @db.VarChar(64)
  createdAt                  DateTime      @default(now()) @map("created_at")
  order                      Order         @relation(fields: [tenantId, orderId], references: [tenantId, id], onDelete: Cascade)
  tenant                     Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  bankAccount                TenantBankAccount? @relation(fields: [bankAccountId], references: [id], onDelete: SetNull)
  creator                    User          @relation("OrderPaymentCreatedBy", fields: [createdBy], references: [id], onDelete: Restrict)
  canceller                  User?         @relation("OrderPaymentCancelledBy", fields: [cancelledBy], references: [id], onDelete: Restrict)

  @@unique([tenantId, idempotencyKey])
  @@unique([tenantId, cancellationIdempotencyKey])
  @@index([tenantId, orderId, receivedAt(sort: Desc)])
  @@index([tenantId, orderId, cancelledAt])
  @@map("order_payments")
}
```

- [ ] **Step 7: Run all database tests and typecheck**

Run: `pnpm --filter @autosale/database test && pnpm --filter @autosale/database typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the database increment**

```bash
git add packages/database
git commit -m "feat(database): store order payment facts"
```

---

### Task 3: Implement tenant-safe payment commands and reads

**Files:**
- Create: `apps/api/src/orders/payments.service.ts`
- Create: `apps/api/src/orders/payments.service.spec.ts`
- Create: `apps/api/src/orders/payments.controller.ts`
- Create: `apps/api/src/orders/payments.controller.spec.ts`
- Modify: `apps/api/src/orders/orders.module.ts`

**Interfaces:**
- Consumes: Task 1 command/summary contracts and Task 2 calculation helper/model.
- Produces: `PaymentsService.get(tenantId, orderId)`, `record(tenantId, orderId, actorUserId, input)`, and `cancel(tenantId, orderId, paymentId, actorUserId, input)`.
- Produces: `GET/POST /api/orders/:id/payments` and `POST /api/orders/:id/payments/:paymentId/cancel`.
- Produces: bounded `order_payment_record` and `order_payment_cancel` operation metrics with only `operation` and `result` labels.

- [ ] **Step 1: Write failing service tests**

Cover these exact cases with Prisma mocks: missing tenant order returns 404; incomplete commercial terms returns 400; future time beyond five minutes returns 400; bank account must match tenant/entity/currency; same command key/hash replays the existing payment; same key/different hash returns 409; manager can record; cancellation excludes amount from summary; non-owner never reaches cancellation service; a second cancellation is idempotent only for the same cancellation key/hash.

- [ ] **Step 2: Run service tests and verify missing service failure**

Run: `pnpm --filter @autosale/api test -- payments.service.spec.ts`

Expected: FAIL because `PaymentsService` does not exist.

- [ ] **Step 3: Implement transactional command handling**

Canonicalize command JSON in stable field order and hash it with SHA-256. In one Prisma transaction: load order and ready terms by `{ tenantId, orderId }`; validate method-specific references; replay or reject an existing idempotency key; insert the payment; append `AuditLog(action: 'ORDER_PAYMENT_RECORDED')`. Cancellation updates only rows matching `{ id, tenantId, orderId, cancelledAt: null }`, sets cancellation fields, and appends `ORDER_PAYMENT_CANCELLED`. Return a freshly computed summary after commit.

Catch a unique-key `P2002` from a concurrent create, reload `{ tenantId, idempotencyKey }`, and apply the same hash comparison instead of returning a generic 500. Use the existing bounded serializable retry pattern for `P2034` transaction conflicts. Cancellation replays by its separate tenant-scoped cancellation key/hash and never changes the original financial fields.

```ts
async record(tenantId: string, orderId: string, actorUserId: string, input: CreateOrderPayment) {
  const requestHash = commandHash(input);
  await this.prisma.$transaction(async (tx) => {
    const context = await this.readyOrder(tx, tenantId, orderId);
    await this.validateMethodReference(tx, context, input);
    const replay = await tx.orderPayment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (replay) return assertReplay(replay, requestHash);
    const payment = await tx.orderPayment.create({ data: paymentData(context, actorUserId, input, requestHash) });
    await tx.auditLog.create({ data: paymentAudit(tenantId, orderId, actorUserId, payment) });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return this.get(tenantId, orderId);
}
```

Never log command bodies. Audit `changes` contains payment ID, amount, currency, method, and safe account/carrier identifiers, but excludes note, reason, IBAN, customer, and delivery data.

Instrument both commands through `@autosale/observability`: increment `autosale_operations_total` and observe `autosale_operation_duration_seconds` using only `operation: 'order_payment_record' | 'order_payment_cancel'` and bounded `result`. Add assertions to the service/security tests that note, reason, IBAN, IDs, and personal data never become labels.

- [ ] **Step 4: Write failing controller integration tests**

Use the existing session/CSRF test harness. Assert GET works for manager; POST requires valid CSRF and accepts manager; cancel returns 403 for manager and succeeds for owner; malformed UUID/body returns 400; cross-tenant order returns 404.

- [ ] **Step 5: Run controller tests and verify missing route failure**

Run: `pnpm --filter @autosale/api test -- payments.controller.spec.ts`

Expected: FAIL because routes are not registered.

- [ ] **Step 6: Add controller and module wiring**

Apply class-level `@RequireMembership('MANAGER')`; override cancellation with method-level `@RequireMembership('OWNER')`. Parse both bodies with Task 1 schemas and use `ParseUUIDPipe({ version: '4' })` for order/payment IDs. Register controller and service in `OrdersModule` using the existing `createPrismaClient(env.DATABASE_URL)` factory pattern.

```ts
@Post(':id/payments')
record(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', uuidPipe) id: string, @Body() body: unknown) {
  const parsed = createOrderPaymentSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Invalid payment');
  return this.payments.record(principal.tenantId!, id, principal.userId, parsed.data);
}

@Post(':id/payments/:paymentId/cancel')
@RequireMembership('OWNER')
cancel(@CurrentPrincipal() principal: AuthPrincipal, @Param('id', uuidPipe) id: string, @Param('paymentId', uuidPipe) paymentId: string, @Body() body: unknown) {
  const parsed = cancelOrderPaymentSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('Invalid payment cancellation');
  return this.payments.cancel(principal.tenantId!, id, paymentId, principal.userId, parsed.data);
}
```

- [ ] **Step 7: Run focused API tests and typecheck**

Run: `pnpm --filter @autosale/api test -- payments.service.spec.ts payments.controller.spec.ts && pnpm --filter @autosale/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the API payment lifecycle**

```bash
git add apps/api/src/orders
git commit -m "feat(api): add order payment facts lifecycle"
```

---

### Task 4: Integrate payment summaries, filtering, and commercial locks

**Files:**
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/orders.service.spec.ts`
- Modify: `apps/api/src/orders/orders.controller.ts`
- Modify: `apps/api/src/orders/orders.controller.spec.ts`
- Modify: `apps/api/src/orders/commercial-terms.service.ts`
- Modify: `apps/api/src/orders/commercial-terms.service.spec.ts`

**Interfaces:**
- Consumes: `OrderPaymentSummary`, `OrderPaymentStatus`, and `calculateOrderPaymentSummary`.
- Produces: every `ManagerOrder` includes `paymentSummary`, and `GET /api/orders?paymentStatus=...` returns accurate total/pagination.

- [ ] **Step 1: Add failing order-read and lock tests**

Assert detail/list returns `null` when pricing is unavailable and a calculated summary otherwise. Assert each payment status filter includes only orders whose ready total and active payment sum match. Assert item correction and commercial-term selection fail while an active payment exists, but customer/delivery corrections remain allowed and all corrections unlock after cancellation.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @autosale/api test -- orders.service.spec.ts orders.controller.spec.ts commercial-terms.service.spec.ts`

Expected: FAIL because payment relations, filters, and locks are absent.

- [ ] **Step 3: Include and map payment summaries**

Extend the canonical order include with payment rows ordered by `receivedAt desc, createdAt desc`, creator/canceller display data, and optional bank account label. Add one mapper shared by list/detail. Use no additional per-order database query.

```ts
payments: {
  orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
  include: {
    creator: { select: { id: true, name: true, email: true } },
    canceller: { select: { id: true, name: true, email: true } },
    bankAccount: { select: { id: true, label: true } },
  },
},
```

- [ ] **Step 4: Add an exact payment-status filter**

Before `count/findMany`, use one tenant-scoped aggregate query to derive matching order IDs from ready `order_commercial_terms` and non-cancelled `order_payments`. Use parameterized `Prisma.sql`, never string concatenation. Add the resulting IDs to the existing Prisma `where`; an empty result short-circuits to `{ items: [], total: 0 }`. This keeps pagination totals correct without storing payment status as source of truth.

```ts
const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
  SELECT o.id
  FROM orders o
  JOIN order_commercial_terms ct ON ct.order_id = o.id AND ct.tenant_id = o.tenant_id
  LEFT JOIN order_payments p ON p.order_id = o.id AND p.tenant_id = o.tenant_id AND p.cancelled_at IS NULL
  WHERE o.tenant_id = ${tenantId}::uuid AND ct.pricing_status = 'READY' AND ct.total_amount IS NOT NULL
  GROUP BY o.id, ct.total_amount
  HAVING ${paymentStatusPredicate(query.paymentStatus)}
`);
```

Implement `paymentStatusPredicate` as a closed switch that returns static `Prisma.sql` fragments for the four enum values; never interpolate an operator or SQL keyword.

- [ ] **Step 5: Add write locks at both mutation boundaries**

In `OrdersService.update`, only reject `changes.items` when an active payment exists; allow customer/delivery fields. In `CommercialTermsService.update`, reject any selection/initialization change while an active payment exists. Perform the active-payment check inside the same transaction as each write to prevent check/write races.

```ts
if (changes.items) {
  const activePayments = await tx.orderPayment.count({ where: { tenantId, orderId, cancelledAt: null } });
  if (activePayments > 0) throw new ConflictException('Order items are locked after payment');
}
```

- [ ] **Step 6: Run API regression tests and typecheck**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit order integration**

```bash
git add apps/api/src/orders
git commit -m "feat(api): expose payment status on orders"
```

---

### Task 5: Build the localized order payment card

**Files:**
- Create: `apps/web/src/components/order-payments-card.tsx`
- Create: `apps/web/src/components/order-payments-card.spec.tsx`
- Modify: `apps/web/src/components/order-review-panel.tsx`
- Modify: `apps/web/src/components/order-review-panel.spec.tsx`
- Modify: `apps/web/app/(workspace)/orders/[id]/page.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `ManagerOrder.paymentSummary` and membership role.
- Produces: `OrderPaymentsCard({ orderId, initial, role, onChange })` with local, no-full-page-refresh updates.

- [ ] **Step 1: Write failing component tests**

Test Ukrainian and English renderings; exact/partial/overpaid summaries; unavailable pricing explanation; method-specific account/carrier controls; disabled button with visible spinner during save; successful POST updates only the card; API error remains visible; cancelled row remains shown; only owner sees cancel; mobile markup has no table-only dependency.

- [ ] **Step 2: Run component tests and verify missing component failure**

Run: `pnpm --filter @autosale/web test -- order-payments-card.spec.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the add-payment interaction**

Use `mutatingFetch`, `crypto.randomUUID()` once per submitted command, `LoadingButton`, controlled fields, and `onChange(nextSummary)`. Default amount to a positive remaining balance and date to local now, while transmitting an ISO timestamp. Regenerate the key only after success or when the user intentionally changes the payload following an idempotency conflict.

```tsx
const response = await mutatingFetch(`/api/orders/${orderId}/payments`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amount, method, receivedAt: new Date(receivedAt).toISOString(), bankAccountId, carrier, note: note || null, idempotencyKey }),
});
if (!response.ok) throw new Error(await paymentError(response, t));
const next = await response.json() as OrderPaymentSummary;
onChange(next);
setIdempotencyKey(crypto.randomUUID());
```

- [ ] **Step 4: Implement owner cancellation**

Use an accessible confirmation form with required reason, its own pending/error state, and a fresh idempotency key. Replace local summary from the response; do not call `router.refresh()` or reload the page.

```tsx
<form aria-label={t('orders.cancelPayment')} onSubmit={cancelPayment}>
  <label>{t('orders.cancellationReason')}<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
  <LoadingButton pending={pending === `cancel:${payment.id}`} type="submit">{t('orders.confirmCancellation')}</LoadingButton>
</form>
```

- [ ] **Step 5: Mount the card and enforce visible locks**

Pass `session.membershipRole` from the server page to `OrderReviewPanel`. Mount the card directly after `OrderCommercialTermsCard`. When `paymentSummary.payments` contains an active payment, disable item product/quantity/color/size changes and commercial selections, but leave customer and delivery fields governed by existing fulfillment rules. Show a localized explanation beside locked controls.

```tsx
const hasActivePayment = order.paymentSummary?.payments.some((payment) => payment.cancelledAt === null) ?? false;
<OrderCommercialTermsCard locked={!correctionAllowed || hasActivePayment} {...commercialProps} />
<OrderPaymentsCard initial={order.paymentSummary} onChange={(paymentSummary) => applyOrder({ ...order, paymentSummary })} orderId={order.id} role={role} />
```

- [ ] **Step 6: Add responsive styling and localization**

Use a compact four-value summary grid on desktop and two columns/one column at existing mobile breakpoints. Payment history becomes stacked rows on mobile, has no horizontal scroll, and keeps action controls right-aligned on desktop. Add every label, error, status, method, carrier, pending state, and accessibility string to both locale files.

```css
.payment-summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--space-3); }
.payment-history-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:var(--space-3); align-items:center; }
@media (max-width: 760px) {
  .payment-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .payment-history-row { grid-template-columns:1fr; }
}
```

- [ ] **Step 7: Run web tests and typecheck**

Run: `pnpm --filter @autosale/web test -- order-payments-card.spec.tsx order-review-panel.spec.tsx && pnpm --filter @autosale/web typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the order payment UI**

```bash
git add apps/web
git commit -m "feat(web): record payments on orders"
```

---

### Task 6: Add payment status to the orders table and navigation

**Files:**
- Modify: `apps/web/app/(workspace)/orders/page.tsx`
- Modify: `apps/web/src/api/orders.ts`
- Modify: `apps/web/src/components/orders-table.tsx`
- Modify: `apps/web/src/components/orders-table.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `OrderPaymentStatus` and `ManagerOrder.paymentSummary`.
- Produces: persistent `paymentStatus` query parameter, dropdown, desktop badge column, and mobile card field.

- [ ] **Step 1: Write failing table/navigation tests**

Assert the filter includes all four statuses; changing it calls `router.replace` without scroll; search, order/procurement/shipment filters, pagination, sorting, and `returnTo` preserve `paymentStatus`; rows/cards render localized badge or `—` when payment summary is unavailable; empty-state detection includes this filter.

- [ ] **Step 2: Run table tests and verify failure**

Run: `pnpm --filter @autosale/web test -- orders-table.spec.tsx`

Expected: FAIL because payment status is not accepted or rendered.

- [ ] **Step 3: Thread the filter through server and API helpers**

Add a strict `paymentStatusParam` parser to the page; extend `getOrders`; extend `ordersUrl`, `navigate`, and `returnTo`; forward only known enum values.

```ts
function paymentStatusParam(value: string | string[] | undefined): OrderPaymentStatus | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID'].includes(candidate) ? candidate as OrderPaymentStatus : undefined;
}
if (query.paymentStatus) params.set('paymentStatus', query.paymentStatus);
```

- [ ] **Step 4: Render desktop and mobile status**

Add one concise `Оплата / Payment` column after order status and one definition-list row in the mobile card. Use semantic badges with existing green/amber/neutral/error tokens: unpaid neutral, partial amber, paid green, overpaid blue/attention. Do not add monetary columns to the list.

```tsx
function PaymentStatusBadge({ summary }: { summary: OrderPaymentSummary | null }) {
  const { t } = useI18n();
  if (!summary) return <span aria-label={t('orders.paymentUnavailable')}>—</span>;
  return <span className={`payment-status payment-${summary.status.toLowerCase()}`}>{paymentStatusLabel(summary.status, t)}</span>;
}
```

- [ ] **Step 5: Run web regression tests and build**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web typecheck && pnpm --filter @autosale/web build`

Expected: PASS.

- [ ] **Step 6: Commit list integration**

```bash
git add apps/web
git commit -m "feat(web): filter orders by payment status"
```

---

### Task 7: Add end-to-end coverage and canonical documentation

**Files:**
- Modify: `tests/e2e/orders.spec.ts`
- Create: `docs/acceptance/order-payment-facts-checklist.md`
- Modify: `docs/features/README.md`
- Modify: `docs/acceptance/order-commercial-terms-checklist.md`
- Modify: `tasks/todo.md`

**Interfaces:**
- Consumes: completed database/API/web flow.
- Produces: repeatable acceptance evidence and an accurate feature index.

- [ ] **Step 1: Write the failing E2E scenario**

Create fictional tenant/order fixtures with ready UAH terms. As manager add `200.00` cash and observe `PARTIALLY_PAID`; add `300.00` bank transfer to a compatible account and observe `PAID`; verify quantity is locked. As owner cancel the second payment with a reason and observe `PARTIALLY_PAID`; verify the cancelled row remains visible. Assert no customer names, phones, IBANs, or real credentials are committed in fixtures.

```ts
test('payment facts support partial, exact, and owner cancellation', async ({ page }) => {
  await page.getByRole('button', { name: 'Додати оплату' }).click();
  await page.getByLabel('Сума').fill('200.00');
  await page.getByLabel('Спосіб оплати').selectOption('CASH');
  await page.getByRole('button', { name: 'Зберегти оплату' }).click();
  await expect(page.getByText('Частково оплачено')).toBeVisible();
});
```

- [ ] **Step 2: Run the focused E2E test and verify failure before final wiring**

Run: `pnpm exec playwright test tests/e2e/orders.spec.ts --grep "payment facts"`

Expected: FAIL until the complete route/UI flow is wired in the test environment.

- [ ] **Step 3: Finish fixture wiring and make E2E pass**

Reuse the existing authenticated owner/manager fixtures and CSRF behavior. Do not add provider credentials; bank transfer uses a fictional stored account and COD does not call a carrier.

```ts
await seedOrderCommercialTerms({ totalAmount: '500.00', currency: 'UAH', pricingStatus: 'READY' });
await seedTenantBankAccount({ label: 'Тестовий UAH', iban: 'UA213223130000026007233566001', currency: 'UAH' });
```

- [ ] **Step 4: Update canonical documentation**

Change payment facts from designed to available only after all tests pass. The acceptance checklist must record migration, tenant isolation, role behavior, idempotency, partial/exact/overpayment, cancellation, locks, mobile layout, and explicit proof that order/delivery transitions do not create payments. Keep bank/COD reconciliation, refunds, and reports unchecked in Task 73/backlog.

```markdown
| Manual order payment facts and calculated balances | Available | [`payment facts design`](../superpowers/specs/2026-09-20-order-payment-facts-design.md), [`acceptance`](../acceptance/order-payment-facts-checklist.md) | `apps/api/src/orders/payments*`, `apps/web/src/components/order-payments-card.tsx` |
```

- [ ] **Step 5: Run documentation checks and inspect the diff**

Run: `rg -n "T[B]D|T[O]DO|FIXM[E]|placeholde[r]" docs/superpowers/specs/2026-09-20-order-payment-facts-design.md docs/acceptance/order-payment-facts-checklist.md; git diff --check`

Expected: `rg` returns no matches and `git diff --check` succeeds.

- [ ] **Step 6: Commit acceptance coverage**

```bash
git add tests/e2e/orders.spec.ts docs/features/README.md docs/acceptance tasks/todo.md
git commit -m "test: verify order payment facts workflow"
```

---

### Task 8: Verify, review, release, and deploy

**Files:**
- Verify only; update `docs/acceptance/order-payment-facts-checklist.md` if measured evidence differs from planned evidence.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: reviewed `master`, pushed release, production migration, and health/smoke evidence.

- [ ] **Step 1: Run the complete local verification suite**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm test:e2e`

Expected: all unit/integration/type/build tests pass; only already documented credential-gated E2E tests may skip.

- [ ] **Step 2: Inspect schema safety and repository hygiene**

Run: `git diff master...HEAD --check && git status --short && git diff master...HEAD -- . ':!packages/database/src/generated/**'`

Confirm the migration is additive, no `.env`, credentials, dumps, runtime state, generated build output, or production personal data are staged, and every changed behavior is documented.

- [ ] **Step 3: Perform the project review gate**

Review each commit against the spec, with special attention to tenant-scoped writes, transaction boundaries, cancellation authorization, idempotency hashes, item/commercial locks, aggregate-filter pagination, and mobile overflow. Fix findings in scoped commits and rerun affected tests.

- [ ] **Step 4: Merge and push according to repository policy**

From a clean worktree, fast-forward `master` to the verified branch, push `master`, and confirm `git status --short --branch` reports `master...origin/master` with no changes. Do not force-push.

- [ ] **Step 5: Back up and deploy manually**

Use the existing production runbook and scripts: create and verify a backup, then run `infra/scripts/deploy.sh` for the pushed master commit. Never print environment files or tokens.

- [ ] **Step 6: Run production-safe smoke checks**

Verify public `/health/live` and `/login`, internal API/worker health, applied migration, and authenticated fictional-order flow: add one payment, observe partial status, cancel it as owner, and observe unpaid status. Confirm unrelated approval, procurement, export, and shipment paths remain available.

- [ ] **Step 7: Clean the merged branch**

Delete the merged short-lived branch only after proving no unique tracked or untracked work remains. Record the final master SHA, backup identifier, deploy result, migration state, and smoke result in the handoff.
