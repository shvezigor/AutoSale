# Procurement and Telegram Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати конкурентно безпечну комплектацію замовлень зі складськими резервами, керованими статусами постачання та персональними Telegram-сповіщеннями.

**Architecture:** Спільний persistence-сервіс у database package виконує оцінку залишків, резервування й переходи статусів для API та worker. Supplier delivery фіксує точні позиції й синхронізує їхні статуси з довговічною Telegram-доставкою. Особисті alert-події створюють in-app notification і `PERSONAL_ALERT` outbox у тій самій транзакції, а наявний reconciler доставляє їх.

**Tech Stack:** TypeScript 5.9, NestJS, Prisma/PostgreSQL 17, BullMQ/Redis, Next.js 16/React, Vitest, Testing Library, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-10-procurement-and-telegram-notifications-design.md`

## Global Constraints

- Не змінювати approval-семантику `Order.status`; procurement має окремі стани.
- У supplier та personal Telegram-повідомленнях не передавати телефон, адресу або текст діалогу.
- Supplier message використовує `Tenant.name`, а не `AutoSale`.
- Supplier auto-dispatch залишається вимкненим; надсилання запускає менеджер.
- PostgreSQL є джерелом істини; BullMQ є лише wake-up механізмом.
- Кожна мутація tenant-scoped, role-checked, CSRF-protected та ідемпотентна.
- Міграції лише additive; історичні Telegram deliveries не змінюють нові procurement-статуси.
- Реалізація кожної поведінки починається з тесту, який падає з очікуваної причини.

---

## Карта файлів

**Нові файли**

- `packages/contracts/src/procurement.ts` — runtime schemas, enum types, summary і API payloads.
- `packages/contracts/src/procurement.spec.ts` — контрактні та summary tests.
- `packages/database/src/procurement-store.ts` — транзакційна оцінка, резервування, ручні переходи й hand-off.
- `packages/database/src/procurement-store.postgres.spec.ts` — реальні PostgreSQL тести конкуренції та tenant isolation.
- `packages/database/prisma/migrations/20260910120000_order_procurement/migration.sql` — additive schema, FK, index і backfill defaults.
- `apps/api/src/orders/procurement.controller.spec.ts` — API access, validation і transition tests.
- `apps/web/src/components/procurement-item-card.tsx` — статус і дії однієї позиції.
- `apps/web/src/components/procurement-item-card.spec.tsx` — component tests позиції.
- `apps/web/src/components/supplier-dispatch-dialog.tsx` — preview/confirm modal.
- `apps/web/src/components/supplier-dispatch-dialog.spec.tsx` — modal/loading/error tests.
- `apps/worker/src/notifications/telegram-alert.service.ts` — transactional in-app + personal Telegram fan-out.
- `apps/worker/src/notifications/telegram-alert.service.spec.ts` — default, opt-out та idempotency tests.
- `apps/worker/src/orders/procurement-backfill.reconciler.ts` — пакетна оцінка старих approved orders.
- `apps/worker/src/orders/procurement-backfill.reconciler.spec.ts` — bounded backfill tests.

**Основні модифікації**

- `packages/database/prisma/schema.prisma`, `packages/database/src/index.ts` — procurement models і exports.
- `packages/contracts/src/orders.ts`, `packages/contracts/src/telegram.ts`, `packages/contracts/src/index.ts` — response/query/preference contracts.
- `apps/api/src/orders/orders.service.ts`, `orders.controller.ts`, `orders.module.ts` — assessment, item transitions, hand-off, summary/filter.
- `apps/api/src/integrations/telegram.service.ts`, `telegram.controller.ts` — preview, exact item dispatch і preference API.
- `apps/worker/src/orders/triggered-order.processor.ts` — assessment та order alerts після AI-рішення.
- `apps/worker/src/telegram/telegram-delivery.service.ts` — supplier item transitions і terminal-failure alert.
- `apps/worker/src/main.ts` — alert wiring і backfill timer.
- `apps/web/src/components/order-review-panel.tsx`, `orders-table.tsx`, `telegram-settings-card.tsx`, відповідні specs і `apps/web/app/globals.css` — UX.
- `tasks/plan.md`, `tasks/todo.md`, operations docs — tracking і rollout evidence.

---

### Task 53: Procurement contracts and additive persistence

**Files:**
- Create: `packages/contracts/src/procurement.ts`
- Create: `packages/contracts/src/procurement.spec.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/telegram.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260910120000_order_procurement/migration.sql`
- Create: `packages/database/src/procurement-store.postgres.spec.ts`

**Interfaces:**
- Produces: `ProcurementStatus`, `ProcurementSummary`, `ProcurementDecisionSource`, `InventoryReservationStatus`, `TelegramAlertEventType`.
- Produces: `procurementTransitionSchema`, `telegramNotificationPreferencesSchema`, enriched `ManagerOrder` and `OrderListQuery` shapes.
- Produces persistence relations: `OrderItem.reservation`, `TelegramDelivery.items`, `TelegramNotificationPreference`.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(procurementTransitionSchema.parse({ status: 'TO_ORDER' })).toEqual({ status: 'TO_ORDER' });
expect(() => procurementTransitionSchema.parse({ status: 'SENDING' })).toThrow();
expect(procurementSummaryFor(['IN_STOCK', 'RECEIVED'], false)).toBe('READY');
expect(procurementSummaryFor(['IN_STOCK', 'TO_ORDER'], false)).toBe('PARTIALLY_READY');
expect(telegramNotificationPreferencesSchema.parse({
  ORDER_NEEDS_REVIEW: true,
  ORDER_AUTO_APPROVED: false,
  SUPPLIER_DELIVERY_FAILED: true,
})).toBeTruthy();
```

- [ ] **Step 2: Run contracts tests and verify RED**

Run: `pnpm --filter @autosale/contracts exec vitest run src/procurement.spec.ts`

Expected: FAIL because the procurement exports do not exist.

- [ ] **Step 3: Implement exact contracts and deterministic summary**

```ts
export const procurementStatusSchema = z.enum([
  'UNASSESSED', 'IN_STOCK', 'TO_ORDER', 'SENDING',
  'ORDERED', 'SUPPLIER_CONFIRMED', 'RECEIVED', 'UNAVAILABLE',
]);
export const procurementTransitionSchema = z.object({
  status: z.enum(['IN_STOCK', 'TO_ORDER', 'SUPPLIER_CONFIRMED', 'RECEIVED', 'UNAVAILABLE']),
}).strict();
export const procurementReasonSchema = z.enum([
  'STOCK_AVAILABLE', 'STOCK_INSUFFICIENT', 'STOCK_UNKNOWN',
  'PRODUCT_UNMATCHED', 'RESERVATION_CONFLICT',
  'MANUAL_IN_STOCK', 'MANUAL_TO_ORDER', 'DELIVERY_FAILED',
]);
export const telegramAlertEventTypeSchema = z.enum([
  'ORDER_NEEDS_REVIEW', 'ORDER_AUTO_APPROVED', 'SUPPLIER_DELIVERY_FAILED',
]);
```

Implement `procurementSummaryFor(statuses, handedOff)` with the precedence approved in the spec. Add to each order item: `procurementStatus`, `procurementSource`, `procurementReason`, `stockAtDecision`, `availableAtDecision`, and `reservation`. Add order-level `procurementSummary`, `procurementHandedOffAt`, `supplierDispatch`, and list query `procurementStatus`. Export `SupplierOrderPreview { orderId, companyName, supplierName, items }` and `TelegramNotificationPreferences` with the exact three boolean event keys so API and web do not redefine these shapes.

- [ ] **Step 4: Run contracts tests and verify GREEN**

Run: `pnpm --filter @autosale/contracts test && pnpm --filter @autosale/contracts typecheck`

Expected: all contract tests and typecheck PASS.

- [ ] **Step 5: Write a failing PostgreSQL schema test**

Create a real PostgreSQL test that inserts two reservations for one `order_item_id` and expects the second insert to fail, inserts a cross-tenant `TelegramDeliveryItem` and expects its composite FK to fail, and inserts duplicate `(tenant_id,user_id,event_type)` preferences and expects uniqueness failure.

- [ ] **Step 6: Run the database test and verify RED**

Run: `pnpm --filter @autosale/database exec vitest run src/procurement-store.postgres.spec.ts`

Expected: FAIL because the tables, columns, enums and constraints are absent.

- [ ] **Step 7: Add Prisma models and migration**

Add:

```prisma
enum ProcurementStatus { UNASSESSED IN_STOCK TO_ORDER SENDING ORDERED SUPPLIER_CONFIRMED RECEIVED UNAVAILABLE }
enum ProcurementDecisionSource { AUTO MANUAL }
enum InventoryReservationStatus { ACTIVE CONSUMED RELEASED }
enum TelegramAlertEventType { ORDER_NEEDS_REVIEW ORDER_AUTO_APPROVED SUPPLIER_DELIVERY_FAILED }
```

Add `Order.procurementHandedOffAt`, `Order.procurementHandedOffBy`, `Order.supplierDispatchVersion @default(0)`. Add a required, backfilled `OrderItem.tenantId`, `@@unique([tenantId,id])`, and procurement snapshot fields. Add matching tenant-inclusive unique keys to referenced `Product`, `TelegramDelivery`, and `UserNotification` rows. Add optional `UserNotification.eventKey` with `@@unique([tenantId,userId,eventKey])`. Add `InventoryReservation`, `TelegramDeliveryItem`, and `TelegramNotificationPreference` with composite tenant-inclusive foreign keys and the uniqueness rules from the spec. Add optional `TelegramDelivery.orderId` and `TelegramDelivery.sourceNotificationId` relations. The SQL migration fills `OrderItem.tenantId` from `Order.tenantId`, validates before `NOT NULL`, sets existing order items to `UNASSESSED`, and does not associate historical deliveries.

- [ ] **Step 8: Generate Prisma and verify schema tests GREEN**

Run: `pnpm --filter @autosale/database generate && pnpm --filter @autosale/database exec vitest run src/procurement-store.postgres.spec.ts && pnpm --filter @autosale/database typecheck`

Expected: schema test and typecheck PASS.

- [ ] **Step 9: Commit Task 53**

```powershell
git add packages/contracts packages/database
git commit -m "feat: add order procurement persistence"
```

---

### Task 54: Automatic assessment and concurrent inventory reservations

**Files:**
- Create: `packages/database/src/procurement-store.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/procurement-store.postgres.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/orders.module.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.ts`
- Modify tests: `apps/api/src/orders/orders.service.spec.ts`, `apps/worker/src/orders/triggered-order.processor.spec.ts`

**Interfaces:**
- Consumes: Task 53 enums/models.
- Produces: `ProcurementStore.assessApprovedOrder(tenantId, orderId, actor): Promise<ProcurementAssessment>`.
- Produces: `ProcurementStore.releaseOrderReservations(tenantId, orderId, actor): Promise<void>`.

- [ ] **Step 1: Add failing real-database assessment tests**

Cover exact cases: stock 5 / quantity 2 -> `IN_STOCK` and ACTIVE reservation 2; null stock -> `TO_ORDER`; unknown SKU -> `TO_ORDER`; two parallel quantity-4 orders against stock 5 -> exactly one `IN_STOCK`, one `TO_ORDER`, and total ACTIVE reservation 4; repeated assessment -> one reservation.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @autosale/database exec vitest run src/procurement-store.postgres.spec.ts`

Expected: FAIL because `ProcurementStore` is missing.

- [ ] **Step 3: Implement transactional assessment**

```ts
export class ProcurementStore {
  constructor(private readonly prisma: PrismaClient) {}
  assessApprovedOrder(tenantId: string, orderId: string, actor: string): Promise<ProcurementAssessment>;
  releaseOrderReservations(tenantId: string, orderId: string, actor: string): Promise<void>;
}
```

In one transaction, lock candidate product rows in deterministic ID order, sum ACTIVE reservations, calculate availability, upsert one reservation per order item, set status/source/reason snapshots, and add one `AuditLog` with action `PROCUREMENT_ASSESSED`. Reject non-approved orders without mutation.

- [ ] **Step 4: Run assessment tests and verify GREEN**

Run: `pnpm --filter @autosale/database exec vitest run src/procurement-store.postgres.spec.ts`

Expected: all assessment and concurrency cases PASS.

- [ ] **Step 5: Add failing API and worker wiring tests**

API test: manual `approve()` calls assessment before returning detail. Worker test: `AUTO_APPROVED` calls assessment after order items are persisted. Cancellation test: `cancel()` releases ACTIVE reservations.

- [ ] **Step 6: Run wiring tests and verify RED**

Run: `pnpm --filter @autosale/api exec vitest run src/orders/orders.service.spec.ts && pnpm --filter @autosale/worker exec vitest run src/orders/triggered-order.processor.spec.ts`

Expected: FAIL because assessment hooks are not wired.

- [ ] **Step 7: Wire manual approval, auto-approval and cancellation**

Inject `ProcurementStore` into `OrdersService` and `TriggeredOrderProcessor`. Manual approval persists approval, then assessment, then export. Auto-approval persists items, assesses, then schedules export. Cancellation releases reservations inside the cancellation transaction. Preserve current idempotency of `triggerMessageId`.

- [ ] **Step 8: Run focused and package tests**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/worker test && pnpm --filter @autosale/database test`

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 54**

```powershell
git add packages/database apps/api/src/orders apps/worker/src/orders
git commit -m "feat: assess and reserve approved order stock"
```

---

### Task 55: Manual procurement transitions, hand-off and audit

**Files:**
- Modify: `packages/database/src/procurement-store.ts`
- Modify: `packages/database/src/procurement-store.postgres.spec.ts`
- Modify: `apps/api/src/orders/orders.controller.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Create: `apps/api/src/orders/procurement.controller.spec.ts`
- Modify: `apps/api/src/orders/orders.controller.spec.ts`

**Interfaces:**
- Produces: `setItemStatus(tenantId, orderId, itemId, status, actor)`.
- Produces: `handOffOrder(tenantId, orderId, actor)`.
- Exposes: `PUT /api/orders/:orderId/items/:itemId/procurement`, `POST /api/orders/:id/hand-off`.

- [ ] **Step 1: Write failing transition matrix tests**

Assert: `IN_STOCK -> TO_ORDER` releases the reservation; `TO_ORDER -> IN_STOCK` reserves only if availability is sufficient; `ORDERED -> SUPPLIER_CONFIRMED`; `SUPPLIER_CONFIRMED -> RECEIVED`; `UNAVAILABLE -> TO_ORDER`; `TO_ORDER -> RECEIVED` rejects; cross-tenant item rejects without mutation.

- [ ] **Step 2: Run focused database tests and verify RED**

Run: `pnpm --filter @autosale/database exec vitest run src/procurement-store.postgres.spec.ts`

Expected: the new transition cases FAIL.

- [ ] **Step 3: Implement allowed transitions and hand-off**

Use a literal transition map. `handOffOrder` requires summary `READY`, marks ACTIVE reservations `CONSUMED`, decrements corresponding internal product stock once, sets `procurementHandedOffAt/By`, and records `ORDER_HANDED_OFF`. A repeated hand-off returns the same result without another decrement.

- [ ] **Step 4: Verify database tests GREEN**

Run: `pnpm --filter @autosale/database exec vitest run src/procurement-store.postgres.spec.ts`

Expected: transition and idempotent hand-off tests PASS.

- [ ] **Step 5: Write failing controller tests**

Assert valid manager requests call the service, malformed/manual-forbidden statuses return 400, unauthenticated requests return 401, non-members return 403, CSRF is enforced by the current global guard, and unknown/cross-tenant identifiers return the safe not-found response.

- [ ] **Step 6: Run controller tests and verify RED**

Run: `pnpm --filter @autosale/api exec vitest run src/orders/procurement.controller.spec.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 7: Add controller/service methods and mapped responses**

Parse bodies with `procurementTransitionSchema`; use the authenticated principal as audit actor rather than accepting the current client-supplied `actor` for new endpoints. Return a refreshed `ManagerOrder` so React can update without navigation refresh.

- [ ] **Step 8: Run API tests and typecheck**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/api typecheck`

Expected: PASS.

- [ ] **Step 9: Commit Task 55**

```powershell
git add packages/database apps/api/src/orders
git commit -m "feat: manage order procurement transitions"
```

---

### Task 56: Exact supplier dispatch and delivery-driven statuses

**Files:**
- Modify: `apps/api/src/integrations/telegram.service.ts`
- Modify: `apps/api/src/integrations/telegram.controller.ts`
- Modify tests: `apps/api/src/integrations/telegram-supplier-dispatch.spec.ts`, `telegram.controller.spec.ts`
- Modify: `apps/worker/src/telegram/telegram-delivery.service.ts`
- Modify: `apps/worker/src/telegram/telegram-delivery.service.spec.ts`

**Interfaces:**
- Produces: `supplierOrderPreview(tenantId, orderId)`.
- Changes: `queueSupplierOrder` includes only `TO_ORDER`, persists `TelegramDeliveryItem`, and returns active delivery on duplicate click.
- Exposes: `GET /api/integrations/telegram/supplier/orders/:id/preview`.

- [ ] **Step 1: Write failing preview and queue tests**

Use an order containing one `IN_STOCK` and two `TO_ORDER` items. Assert preview/message contains only the two `TO_ORDER` items and `Tenant.name`, contains no `AutoSale`, phone or address, creates two delivery-item rows, marks them `SENDING`, and leaves the stock item unchanged. A second call returns the same active delivery.

- [ ] **Step 2: Run API Telegram tests and verify RED**

Run: `pnpm --filter @autosale/api exec vitest run src/integrations/telegram-supplier-dispatch.spec.ts src/integrations/telegram.controller.spec.ts`

Expected: FAIL on missing preview and item linkage.

- [ ] **Step 3: Implement transactional preview/dispatch**

Preview is read-only and rejects orders without `TO_ORDER`. Queue uses one Prisma transaction: lock order, return active delivery if any item is `SENDING`, increment `supplierDispatchVersion`, create delivery with key `supplier-order:<orderId>:<version>`, create links, and update selected items to `SENDING`. Queue wake-up happens after commit.

- [ ] **Step 4: Verify API Telegram tests GREEN**

Run: `pnpm --filter @autosale/api exec vitest run src/integrations/telegram-supplier-dispatch.spec.ts src/integrations/telegram.controller.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing worker transition tests**

Assert successful supplier delivery changes only linked `SENDING` items to `ORDERED`; `RETRYABLE` keeps them `SENDING`; terminal `FAILED` returns them to `TO_ORDER`; `TEST` and `PERSONAL_ALERT` deliveries never touch order items; stale lease completion changes nothing.

- [ ] **Step 6: Run worker tests and verify RED**

Run: `pnpm --filter @autosale/worker exec vitest run src/telegram/telegram-delivery.service.spec.ts`

Expected: new state-transition assertions FAIL.

- [ ] **Step 7: Make delivery completion transactional**

Replace the single delivery `updateMany` finish with a transaction that guards `(id,status='PROCESSING',leaseId)`, updates the delivery, and transitions its linked items according to the final result. Do not move items on retry or ambiguous stale completion.

- [ ] **Step 8: Run API/worker/database regression suites**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/worker test && pnpm --filter @autosale/database test`

Expected: PASS.

- [ ] **Step 9: Commit Task 56**

```powershell
git add apps/api/src/integrations apps/worker/src/telegram
git commit -m "feat: track supplier delivery per order item"
```

---

### Task 57: Procurement UX on order detail and order table

**Files:**
- Create: `apps/web/src/components/procurement-item-card.tsx`
- Create: `apps/web/src/components/procurement-item-card.spec.tsx`
- Create: `apps/web/src/components/supplier-dispatch-dialog.tsx`
- Create: `apps/web/src/components/supplier-dispatch-dialog.spec.tsx`
- Modify: `apps/web/src/components/order-review-panel.tsx`
- Modify: `apps/web/src/components/order-review-panel.spec.tsx`
- Modify: `apps/web/src/components/orders-table.tsx`
- Modify: `apps/web/src/components/orders-table.spec.tsx`
- Modify: `apps/web/src/api/orders.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: enriched `ManagerOrder`, preview endpoint, item transition and hand-off routes.
- Produces: dynamic, no-full-reload procurement interactions and `procurementStatus` list filter.

- [ ] **Step 1: Write failing item-card tests**

Assert localized badge/reason for known stock and unknown stock; manager actions call the exact item route; pending button keeps width and shows spinner; the returned order replaces local state; success/error uses global toast.

- [ ] **Step 2: Run item-card tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/procurement-item-card.spec.tsx`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement the focused item component**

Render procurement controls outside editable product identity fields. Disable changes for `SENDING`, `HANDED_OFF`, or pending requests. Use existing `LoadingButton`, `ActivityProvider`, `ToastProvider`, and `mutatingFetch` rather than adding another loading/notification system.

- [ ] **Step 4: Write failing dispatch-dialog and panel tests**

Assert dialog shows company, supplier and only `TO_ORDER`; cancel sends nothing; confirm calls POST once; `SENDING/ORDERED` state replaces the button; `Передати у виконання` appears only for `READY`; no full-page navigation occurs.

- [ ] **Step 5: Run component tests and verify RED**

Run: `pnpm --filter @autosale/web exec vitest run src/components/supplier-dispatch-dialog.spec.tsx src/components/order-review-panel.spec.tsx`

Expected: FAIL on absent procurement UI.

- [ ] **Step 6: Implement dialog and panel integration**

Fetch preview only when the user opens the dialog. Keep the action row right-aligned, buttons stable during loading, and update `order`/`draft` with the returned JSON. Hide `Зберегти зміни` when the editable snapshot is unchanged.

- [ ] **Step 7: Write failing table/filter tests**

Assert desktop table and mobile cards show `Комплектація`, URL query preserves search/approval/pageSize while changing procurement filter, and row navigation remains client-side.

- [ ] **Step 8: Implement table column, badge and filter**

Extend `ordersUrl` with `procurementStatus`; add a separate select labelled `Комплектація`; use existing `router.replace(..., { scroll:false })` and `TablePagination`.

- [ ] **Step 9: Run web tests, typecheck and build**

Run: `pnpm --filter @autosale/web test && pnpm --filter @autosale/web typecheck && pnpm --filter @autosale/web build`

Expected: PASS with no hydration or accessibility errors.

- [ ] **Step 10: Commit Task 57**

```powershell
git add apps/web packages/contracts/src/orders.ts
git commit -m "feat: add procurement controls to orders"
```

---

### Task 58: Personal Telegram notification preferences and fan-out

**Files:**
- Modify: `apps/api/src/integrations/telegram.service.ts`
- Modify: `apps/api/src/integrations/telegram.controller.ts`
- Modify: `apps/api/src/integrations/telegram.controller.spec.ts`
- Create: `apps/worker/src/notifications/telegram-alert.service.ts`
- Create: `apps/worker/src/notifications/telegram-alert.service.spec.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.spec.ts`
- Modify: `apps/worker/src/telegram/telegram-delivery.service.ts`
- Modify: `apps/worker/src/telegram/telegram-delivery.service.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/web/src/components/telegram-settings-card.tsx`
- Modify: `apps/web/src/components/telegram-settings-card.spec.tsx`

**Interfaces:**
- Produces: `GET/PUT /api/integrations/telegram/preferences` for the current user.
- Produces: `TelegramAlertService.persist(tx, event): Promise<void>`.
- Consumes: `ORDER_NEEDS_REVIEW`, `ORDER_AUTO_APPROVED`, `SUPPLIER_DELIVERY_FAILED`.

- [ ] **Step 1: Write failing preference API tests**

Assert missing rows read as all `true`; PUT upserts only the current tenant/user; disconnect/reconnect preserves values; a manager cannot read or modify another user by supplied IDs because the routes accept none.

- [ ] **Step 2: Run API tests and verify RED**

Run: `pnpm --filter @autosale/api exec vitest run src/integrations/telegram.controller.spec.ts`

Expected: preference route assertions FAIL.

- [ ] **Step 3: Implement preference service and routes**

Use the authenticated principal for tenant/user. Parse the complete three-boolean object, upsert three rows in one transaction, and return the normalized object in the same shape as GET.

- [ ] **Step 4: Write failing fan-out tests**

Create two active members: one linked/default-enabled and one linked/opted-out. Assert one `UserNotification` is created for each intended in-app recipient, only the enabled linked member receives `PERSONAL_ALERT`, message contains tenant name/order number/status/link, contains no phone/address, and repeating the same event creates no duplicate delivery.

- [ ] **Step 5: Run worker alert tests and verify RED**

Run: `pnpm --filter @autosale/worker exec vitest run src/notifications/telegram-alert.service.spec.ts`

Expected: FAIL because fan-out does not exist.

- [ ] **Step 6: Implement transactional fan-out**

```ts
type TelegramAlertEvent = {
  eventId: string;
  tenantId: string;
  orderId: string;
  type: 'ORDER_NEEDS_REVIEW' | 'ORDER_AUTO_APPROVED' | 'SUPPLIER_DELIVERY_FAILED';
};
```

`persist(tx,event)` loads tenant and active memberships, upserts per-user `UserNotification` using `eventKey=<type>:<eventId>`, reads personal BOT destinations and preferences, and upserts `PERSONAL_ALERT` with `personal-alert:<notificationId>`. Message includes `${APP_PUBLIC_URL}/orders/${orderId}` and privacy-safe text only.

- [ ] **Step 7: Wire the three domain events**

In `TriggeredOrderProcessor`, call fan-out inside the transaction after the final AI status is known. In terminal supplier failure, call fan-out inside the guarded delivery/item transition transaction. Retryable failure emits nothing.

- [ ] **Step 8: Write failing settings UI tests**

Assert the three checked defaults appear only for a linked personal account, each toggle PUTs the complete object, pending control is disabled with stable layout, and success/error uses global toast.

- [ ] **Step 9: Implement preference toggles and run all focused tests**

Run: `pnpm --filter @autosale/api test && pnpm --filter @autosale/worker test && pnpm --filter @autosale/web test`

Expected: PASS.

- [ ] **Step 10: Commit Task 58**

```powershell
git add apps/api/src/integrations apps/worker apps/web/src/components/telegram-settings-card.tsx apps/web/src/components/telegram-settings-card.spec.tsx
git commit -m "feat: add personal Telegram order alerts"
```

---

### Task 59: Backfill, observability, documentation and production rollout

**Files:**
- Create: `apps/worker/src/orders/procurement-backfill.reconciler.ts`
- Create: `apps/worker/src/orders/procurement-backfill.reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `packages/observability/src/index.spec.ts`
- Modify: `docs/operations/deployment.md`
- Modify: `tasks/plan.md`
- Modify: `tasks/todo.md`

**Interfaces:**
- Consumes: `ProcurementStore.assessApprovedOrder`.
- Produces: bounded backfill result `{ attempted, assessed, skipped, failed }` and safe metrics.

- [ ] **Step 1: Write failing backfill tests**

Assert one pass selects at most 25 approved/auto-approved orders containing `UNASSESSED`, processes oldest first, skips non-approved orders, isolates one failure without stopping the batch, and a second pass does not reassess completed items.

- [ ] **Step 2: Run backfill tests and verify RED**

Run: `pnpm --filter @autosale/worker exec vitest run src/orders/procurement-backfill.reconciler.spec.ts`

Expected: FAIL because reconciler is missing.

- [ ] **Step 3: Implement reconciler and wire a five-second guarded timer**

Follow the existing Telegram/catalogue reconciler pattern: no overlapping runs, PostgreSQL query is bounded and deterministic, logs contain counts and safe error codes only. Stop the timer during worker shutdown.

- [ ] **Step 4: Add safe metrics assertions**

Cover `procurement_assessment`, `procurement_reservation_conflict`, `procurement_transition`, `telegram_supplier_delivery`, and `telegram_personal_alert` with result labels from a fixed allowlist. Assert no message, chat, phone or address label exists.

- [ ] **Step 5: Run complete verification before deployment**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm build
docker compose --env-file C:\Users\User\Documents\ChatGPT\AutoSales\.env -p autosale config --quiet
```

Expected: every command exits 0; all test counts report zero failures.

- [ ] **Step 6: Update operations and task tracking**

Document migration order, backfill observation, rollback boundary, personal-alert privacy, and the exact live acceptance checklist. Add Tasks 53–59 to `tasks/plan.md`/`tasks/todo.md` and mark only evidence-backed steps complete.

- [ ] **Step 7: Commit Task 59 before production rollout**

```powershell
git add apps/worker packages/observability docs/operations tasks
git commit -m "chore: prepare procurement rollout"
git push origin master
```

- [ ] **Step 8: Deploy through the existing safe script**

Run: `& .\scripts\deploy-local.ps1 -EnvFile C:\Users\User\Documents\ChatGPT\AutoSales\.env`

Expected: migration reports success, API/web/worker are recreated, and the command exits 0.

- [ ] **Step 9: Verify production without sending externally**

Run:

```powershell
docker compose --env-file C:\Users\User\Documents\ChatGPT\AutoSales\.env -p autosale ps
Invoke-WebRequest https://sales-aito.com/health/live -UseBasicParsing
Invoke-WebRequest https://sales-aito.com/login -UseBasicParsing
```

Expected: API, web, worker, PostgreSQL, Redis and MinIO are healthy; both HTTP requests return 200.

- [ ] **Step 10: Perform controlled live acceptance with action-time confirmation**

After explicit confirmation immediately before each external send: approve one test order with one stock and one supplier item, verify one reservation, preview only the supplier item, send it once, verify `SENDING -> ORDERED`, manually set `SUPPLIER_CONFIRMED -> RECEIVED`, and verify opted-in personal notification delivery exactly once. Prefix supplier content `ТЕСТ — НЕ ВИКОНУВАТИ` for acceptance data.

- [ ] **Step 11: Record evidence and final commit**

Record IDs only in a local acceptance note; do not record message bodies, chat IDs, tokens, phone numbers or addresses. Mark Tasks 53–59 complete only after the live evidence exists.

```powershell
git add tasks docs/operations
git commit -m "docs: verify procurement and Telegram alerts"
git push origin master
```

---

## Completion criteria

- Mixed orders reserve available stock and isolate supplier-needed positions.
- Concurrent approvals cannot over-reserve a product.
- Manual transitions and hand-off are audited and idempotent.
- Supplier delivery status drives only the exact linked order items.
- Personal Telegram preferences work per user with privacy-safe, duplicate-free alerts.
- Order detail/table UX updates dynamically with stable loading states and mobile support.
- Existing Instagram, catalogue, Google export, notification and Telegram tests remain green.
- Production services are healthy and live acceptance is explicitly confirmed and recorded.
