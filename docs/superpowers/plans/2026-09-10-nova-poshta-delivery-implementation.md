# Nova Poshta Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager connect the tenant's Nova Poshta account, review a pre-filled shipment, create one idempotent TTN, track or cancel it, download its label, and manually send the tracking number to the Instagram customer.

**Architecture:** Add provider-neutral delivery contracts and PostgreSQL records, then implement Nova Poshta behind a narrow validated adapter. API commands persist intent before BullMQ wakes a worker; the worker owns provider side effects and reconciliation, while the Next.js UI renders tenant-safe summaries and never receives credentials or raw provider payloads.

**Tech Stack:** TypeScript 5.9, Zod, NestJS, Prisma/PostgreSQL, BullMQ/Redis, Next.js App Router, React, Vitest, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-10-delivery-carriers-and-nova-poshta-design.md`

## Global Constraints

- PostgreSQL is authoritative; BullMQ only wakes durable work.
- Nova Poshta is the only provider implemented in this plan, but all public AutoSale types are provider-neutral.
- One order has at most one active shipment; cancelled and failed attempts remain queryable history.
- Creating a TTN and sending it to a customer both require separate explicit manager actions.
- External responses are untrusted and must pass Zod validation before use.
- Provider credentials are encrypted at rest and never returned to the browser, logs, audit changes, or metrics.
- Every state-changing endpoint is tenant-scoped, CSRF-protected by the existing global guard, role-checked, and idempotent.
- A create timeout is an unknown outcome: reconcile by stable client reference before retrying the provider create call.
- Initial scope excludes multi-parcel orders, international delivery, automatic customer messages, bank accounts, payment reconciliation, Meest, and Ukrposhta.

## File Map

- `packages/contracts/src/delivery.ts`: provider-neutral Zod schemas and public TypeScript contracts.
- `packages/integrations/src/nova-poshta.ts`: Nova Poshta HTTP boundary and provider error mapping only.
- `packages/database/prisma/schema.prisma`: tenant connection, sender defaults, shipment, attempt, and status-event persistence.
- `packages/database/prisma/migrations/20260910180000_delivery_foundation/migration.sql`: additive constraints, indexes, and the partial unique active-shipment rule.
- `apps/api/src/delivery/delivery.controller.ts`: authenticated REST boundary.
- `apps/api/src/delivery/delivery.service.ts`: tenant authorization, connection settings, drafts, quotes, commands, and safe summaries.
- `apps/api/src/delivery/delivery.module.ts`: Prisma, cipher, queue, and adapter wiring.
- `apps/worker/src/delivery/shipment-create.service.ts`: provider create side effect and unknown-outcome recovery.
- `apps/worker/src/delivery/shipment-status.service.ts`: status sync, cancel, and label preparation.
- `apps/worker/src/delivery/shipment-reconciler.ts`: recover missed queue wake-ups and schedule status checks.
- `apps/web/src/components/delivery-settings-card.tsx`: owner connection and sender defaults UI.
- `apps/web/src/components/shipment-panel.tsx`: order-detail shipment summary and actions.
- `apps/web/src/components/shipment-review-dialog.tsx`: responsive draft, location search, quote, and confirmation UI.
- `apps/web/src/components/shipment-customer-message-dialog.tsx`: editable manual Instagram message.

---

### Task 1 (Task 60): Provider-neutral contracts and persistence

**Files:**
- Create: `packages/contracts/src/delivery.ts`
- Create: `packages/contracts/src/delivery.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260910180000_delivery_foundation/migration.sql`
- Create: `packages/database/src/delivery.postgres.spec.ts`

**Interfaces:**
- Produces: `DeliveryProvider`, `ShipmentStatus`, `DeliveryConnectionSummary`, `DeliverySenderProfileInput`, `ShipmentDraftInput`, `ShipmentQuote`, `ShipmentSummary`, `ShipmentCreateJob`, and `ShipmentStatusJob`.
- Produces database models: `DeliveryConnection`, `DeliverySenderProfile`, `Shipment`, `ShipmentAttempt`, and `ShipmentStatusEvent`.
- Consumed by every later task.

- [ ] **Step 1: Write failing contract tests**

Cover valid provider-neutral drafts and reject negative money, zero weight, missing exact location refs, arbitrary provider/status values, and unexpected fields:

```ts
expect(shipmentDraftInputSchema.parse({
  provider: 'NOVA_POSHTA',
  recipient: { name: 'Ігор Швець', phone: '+380976536783' },
  destination: { type: 'BRANCH', cityRef: 'city-ref', locationRef: 'branch-ref', label: 'Відділення №22' },
  parcels: [{ weightKg: 2, lengthCm: 80, widthCm: 20, heightCm: 205 }],
  payer: 'RECIPIENT',
  declaredValue: 2500,
  codAmount: 2500,
})).toMatchObject({ provider: 'NOVA_POSHTA' });

expect(() => shipmentDraftInputSchema.parse({
  provider: 'NOVA_POSHTA', recipient: { name: 'Ігор', phone: '097' },
})).toThrow();
```

- [ ] **Step 2: Run the contract test and confirm the red state**

Run: `pnpm --filter @autosale/contracts test -- delivery.spec.ts`

Expected: FAIL because `delivery.ts` and its exports do not exist.

- [ ] **Step 3: Add the provider-neutral schemas**

Define closed unions and strict boundary schemas:

```ts
export const deliveryProviderSchema = z.enum(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA']);
export type DeliveryProvider = z.infer<typeof deliveryProviderSchema>;

export const shipmentStatusSchema = z.enum([
  'DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT',
  'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED', 'FAILED',
]);

export const shipmentDraftInputSchema = z.object({
  provider: z.literal('NOVA_POSHTA'),
  recipient: z.object({ name: z.string().trim().min(2).max(120), phone: z.string().regex(/^\+380\d{9}$/) }).strict(),
  destination: z.discriminatedUnion('type', [
    z.object({ type: z.enum(['BRANCH', 'PARCEL_LOCKER']), cityRef: z.string().min(1), locationRef: z.string().min(1), label: z.string().min(1).max(240) }).strict(),
    z.object({ type: z.literal('ADDRESS'), cityRef: z.string().min(1), addressRef: z.string().min(1), building: z.string().min(1).max(32), flat: z.string().max(32).nullable() }).strict(),
  ]),
  parcels: z.array(z.object({ weightKg: z.number().positive().max(1_000), lengthCm: z.number().positive().max(300), widthCm: z.number().positive().max(300), heightCm: z.number().positive().max(300) }).strict()).length(1),
  payer: z.enum(['SENDER', 'RECIPIENT']),
  declaredValue: z.number().positive().max(10_000_000),
  codAmount: z.number().nonnegative().max(10_000_000).nullable(),
  description: z.string().trim().min(1).max(100),
}).strict();
```

Add safe summaries and job schemas with UUID identifiers. Export them from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run contracts tests**

Run: `pnpm --filter @autosale/contracts test`

Expected: all contract tests PASS.

- [ ] **Step 5: Write failing PostgreSQL isolation/idempotency tests**

Test all of these in `delivery.postgres.spec.ts`:

- a connection is unique by `tenantId + provider`;
- a sender profile cannot reference another tenant's connection;
- a shipment cannot reference another tenant's order;
- a second active shipment for the same order is rejected;
- a cancelled shipment permits a new active shipment;
- `tenantId + idempotencyKey` is unique;
- status events cascade only with their own shipment.

- [ ] **Step 6: Run the database test and confirm the red state**

Run: `pnpm --filter @autosale/database test -- delivery.postgres.spec.ts`

Expected: FAIL because the Prisma models do not exist.

- [ ] **Step 7: Add the additive Prisma models and migration**

Use provider-neutral enums and compound tenant foreign keys. `ShipmentAttempt` carries request hash, provider operation, state (`PENDING | PROCESSING | SUCCEEDED | UNKNOWN | FAILED`), lease, safe error code, and timestamps. Create the PostgreSQL-only partial unique index in SQL:

```sql
CREATE UNIQUE INDEX "shipments_one_active_per_order"
ON "shipments" ("tenant_id", "order_id")
WHERE "status" IN ('DRAFT', 'CREATING', 'CREATED', 'ACCEPTED', 'IN_TRANSIT', 'RETURNING');
```

Store credential ciphertext in `DeliveryConnection.encryptedCredential`; never add a plaintext column. Add `shipments` relations to `Tenant`, `Order`, and `User` only through tenant-safe keys.

- [ ] **Step 8: Generate Prisma client and run database tests**

Run: `pnpm --filter @autosale/database prisma:generate`

Run: `pnpm --filter @autosale/database test`

Expected: all database tests PASS, including cross-tenant and partial-unique cases.

- [ ] **Step 9: Commit the foundation**

```bash
git add packages/contracts packages/database
git commit -m "feat: add delivery domain foundation"
```

---

### Task 2 (Task 61): Validated Nova Poshta API adapter

**Files:**
- Create: `packages/integrations/src/nova-poshta.ts`
- Create: `packages/integrations/src/nova-poshta.spec.ts`
- Modify: `packages/integrations/src/index.ts`

**Interfaces:**
- Consumes: normalized types from `@autosale/contracts/delivery`.
- Produces: `NovaPoshtaClient` with `validateCredential`, `listSenderProfiles`, `searchCities`, `searchLocations`, `calculateShipment`, `findShipmentByClientRef`, `createShipment`, `getShipmentStatus`, `getLabel`, and `cancelShipment`.
- Produces: `NovaPoshtaError` with safe codes `UNAUTHORIZED | VALIDATION | RATE_LIMITED | TIMEOUT | NETWORK | INVALID_RESPONSE | PROVIDER_ERROR`.

- [ ] **Step 1: Write failing adapter tests with a fake fetch boundary**

Test the request envelope and each response mapper without network access:

```ts
const client = new NovaPoshtaClient({
  apiKey: 'secret',
  fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true,
    data: [{ Ref: 'city-ref', Description: 'Луцьк' }],
    errors: [], warnings: [], info: [],
  }), { status: 200 })),
});

await expect(client.searchCities('Луцьк')).resolves.toEqual([
  { ref: 'city-ref', label: 'Луцьк' },
]);
```

Also test HTTP 401/429, `success:false`, malformed `data`, AbortError, network failure, error text redaction, and a TTN response missing `Ref` or `IntDocNumber`.

- [ ] **Step 2: Run the focused integration test and confirm failure**

Run: `pnpm --filter @autosale/integrations test -- nova-poshta.spec.ts`

Expected: FAIL because `NovaPoshtaClient` does not exist.

- [ ] **Step 3: Implement one request helper and strict method mappers**

Use only the official JSON endpoint `https://api.novaposhta.ua/v2.0/json/`. The helper posts `{ apiKey, modelName, calledMethod, methodProperties }`, applies `AbortSignal.timeout(10_000)`, parses JSON as `unknown`, and never includes provider messages in thrown errors:

```ts
private async request(modelName: string, calledMethod: string, methodProperties: Record<string, unknown>) {
  const response = await this.fetchFn(this.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: this.apiKey, modelName, calledMethod, methodProperties }),
    signal: AbortSignal.timeout(this.timeoutMs),
  });
  const payload = novaPoshtaEnvelopeSchema.safeParse(await safeJson(response));
  if (!payload.success) throw new NovaPoshtaError('INVALID_RESPONSE', response.status);
  if (!response.ok || !payload.data.success) throw mapNovaPoshtaError(response.status, payload.data);
  return payload.data.data;
}
```

Keep raw Nova Poshta field names inside this file. Normalize phone numbers, decimals, refs, labels, TTN, and status codes at the adapter boundary.

- [ ] **Step 4: Run integration package tests**

Run: `pnpm --filter @autosale/integrations test`

Expected: all tests PASS and no test contacts Nova Poshta.

- [ ] **Step 5: Commit the adapter**

```bash
git add packages/integrations
git commit -m "feat: add Nova Poshta API adapter"
```

---

### Task 3 (Task 62): Connection and sender defaults

**Files:**
- Create: `apps/api/src/delivery/delivery.module.ts`
- Create: `apps/api/src/delivery/delivery.controller.ts`
- Create: `apps/api/src/delivery/delivery.service.ts`
- Create: `apps/api/src/delivery/delivery.controller.spec.ts`
- Create: `apps/api/src/delivery/delivery.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/config/src/api-env.ts`
- Modify: `packages/config/src/worker-env.ts`
- Modify: `packages/config/src/api-env.spec.ts`
- Modify: `packages/config/src/worker-env.spec.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Create: `apps/web/src/components/delivery-settings-card.tsx`
- Create: `apps/web/src/components/delivery-settings-card.spec.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.tsx`
- Modify: `apps/web/src/components/settings-tabs.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `NovaPoshtaClient`, `CredentialCipher`, `DeliveryConnectionSummary`, `DeliverySenderProfileInput`.
- Produces API: `GET /api/integrations/delivery`, `PUT/DELETE /api/integrations/delivery/nova-poshta`, `GET/PUT /api/integrations/delivery/nova-poshta/sender-profile`.
- Produces UI settings tab ID `delivery`.

- [ ] **Step 1: Write failing controller and service tests**

Cover owner-only connect/update/disconnect, manager read-only summary, invalid key rejection, ciphertext storage, masked response, tenant isolation, replace-key credential generation, and preserving shipment history on disconnect.

Assert no response object contains `apiKey` or `encryptedCredential`:

```ts
expect(JSON.stringify(await service.summary(tenantId))).not.toMatch(/apiKey|encryptedCredential|secret/i);
expect(cipher.encrypt).toHaveBeenCalledWith('np-live-key');
```

- [ ] **Step 2: Run API tests and confirm failure**

Run: `pnpm --filter @autosale/api test -- delivery`

Expected: FAIL because the delivery module does not exist.

- [ ] **Step 3: Implement the API module and feature flag**

Add `NOVA_POSHTA_DELIVERY_ENABLED` as a strict optional boolean defaulting to `false` in both API and worker schemas. Wire `DeliveryModule.register(env)` into `AppModule`. Construct a request-scoped client only after decrypting a tenant credential server-side.

Connection commands must:

1. validate the submitted key before persistence;
2. encrypt it with `CredentialCipher`;
3. upsert by `tenantId_provider` and increment `credentialGenerationId` on replacement;
4. return only `{ provider, status, accountLabel, lastVerifiedAt, lastErrorCode, senderProfile }`.

- [ ] **Step 4: Run API and config tests**

Run: `pnpm --filter @autosale/config test && pnpm --filter @autosale/api test -- delivery`

Expected: all focused tests PASS.

- [ ] **Step 5: Write failing settings UI tests**

Test tab visibility, owner key entry, manager read-only state, stable `Підключаємо…` loading, safe error toast, sender/contact/origin selection, disconnect confirmation, and no rendered secret after success.

- [ ] **Step 6: Implement the delivery settings card**

Add `delivery` to `SettingsTabId`. Owners see the connection form and defaults after validation; managers see status only. Reuse `LoadingButton`, `useToast`, and the global confirmation dialog. Keep all form labels visible and stack actions below 720px.

- [ ] **Step 7: Run web tests and typecheck**

Run: `pnpm --filter @autosale/web test -- delivery-settings-card settings`

Run: `pnpm typecheck`

Expected: tests and typecheck PASS.

- [ ] **Step 8: Commit connection settings**

```bash
git add .env.example compose.yaml packages/config apps/api/src/delivery apps/api/src/app.module.ts apps/web
git commit -m "feat: connect tenant Nova Poshta accounts"
```

---

### Task 4 (Task 63): Cached city, branch, and parcel-locker search

**Files:**
- Modify: `packages/contracts/src/delivery.ts`
- Modify: `packages/contracts/src/delivery.spec.ts`
- Create: `apps/api/src/delivery/delivery-location.service.ts`
- Create: `apps/api/src/delivery/delivery-location.service.spec.ts`
- Modify: `apps/api/src/delivery/delivery.controller.ts`
- Create: `apps/web/src/components/delivery-location-picker.tsx`
- Create: `apps/web/src/components/delivery-location-picker.spec.tsx`

**Interfaces:**
- Produces: `DeliveryLocation = { ref: string; provider: DeliveryProvider; type: 'CITY' | 'BRANCH' | 'PARCEL_LOCKER'; label: string; cityRef?: string; number?: string }`.
- Produces API: `GET /api/delivery/locations?provider=NOVA_POSHTA&type=CITY|BRANCH|PARCEL_LOCKER&query=<text>&cityRef=<ref>`.
- Consumed by shipment review in Task 5.

- [ ] **Step 1: Add failing contract/API tests**

Require query length 2–120, provider `NOVA_POSHTA`, allowed location type, cityRef for branch/locker, maximum 50 normalized results, and no request when the feature/connection is inactive.

- [ ] **Step 2: Add failing cache behavior tests**

Use a fake clock and fake Nova Poshta client. Assert identical tenant/provider/type/query requests reuse a five-minute cache, different credential generations do not, rejected calls are not cached, and returned arrays cannot mutate cached values.

- [ ] **Step 3: Implement the location service and endpoint**

Use an in-process bounded cache keyed by `tenantId:credentialGenerationId:provider:type:cityRef:normalizedQuery`, maximum 1,000 entries, TTL five minutes. Do not cache PII; only provider directory data is stored. Escape nothing into logs except type and result count.

- [ ] **Step 4: Run contract and API tests**

Run: `pnpm --filter @autosale/contracts test && pnpm --filter @autosale/api test -- delivery-location`

Expected: all focused tests PASS.

- [ ] **Step 5: Write failing accessible picker tests**

Use fake timers to assert 300 ms debounce, spinner without layout shift, keyboard selection with ArrowDown/Enter/Escape, exact selected ref retained separately from the label, and stale selection cleared when city changes.

- [ ] **Step 6: Implement the picker**

Implement a combobox/listbox with `aria-expanded`, `aria-controls`, `aria-activedescendant`, visible empty/error states, and abort of superseded fetches. Never accept free text as an exact `locationRef`.

- [ ] **Step 7: Run web tests and commit**

Run: `pnpm --filter @autosale/web test -- delivery-location-picker`

```bash
git add packages/contracts apps/api/src/delivery apps/web/src/components
git commit -m "feat: search Nova Poshta delivery locations"
```

---

### Task 5 (Task 64): Shipment draft, quote, and responsive manager review

**Files:**
- Modify: `packages/contracts/src/delivery.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `apps/api/src/delivery/delivery.service.ts`
- Modify: `apps/api/src/delivery/delivery.controller.ts`
- Modify: `apps/api/src/delivery/delivery.service.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/orders.service.spec.ts`
- Create: `apps/web/src/components/shipment-review-dialog.tsx`
- Create: `apps/web/src/components/shipment-review-dialog.spec.tsx`
- Create: `apps/web/src/components/shipment-panel.tsx`
- Create: `apps/web/src/components/shipment-panel.spec.tsx`
- Modify: `apps/web/src/components/order-review-panel.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Produces API: `GET /api/orders/:orderId/shipments`, `PUT /api/orders/:orderId/shipments/draft`, `POST /api/orders/:orderId/shipments/quote`.
- Extends `ManagerOrder` with `shipment: ShipmentSummary | null` and `canCreateShipment: boolean`.
- Consumes exact location refs from Task 4.

- [ ] **Step 1: Write failing readiness and prefill tests**

Assert shipment creation is allowed only when order status is `APPROVED | AUTO_APPROVED` and every item is `IN_STOCK | RECEIVED`. Assert prefill uses customer name/phone, AI city/branch text only as search hints, tenant sender defaults, one parcel, item-derived description, and a manually editable declared value/COD.

- [ ] **Step 2: Write failing quote tests**

Assert quote validates the complete provider-neutral draft, makes no shipment `CREATING`, returns `{ currency:'UAH', cost, estimatedDeliveryDate }`, and rejects cross-tenant orders, incomplete procurement, stale sender profile, and a COD below zero or above declared value.

- [ ] **Step 3: Implement draft/readiness/quote services**

Keep readiness as a pure function:

```ts
export function shipmentReadiness(order: {
  status: string;
  items: Array<{ procurementStatus: string }>;
}): { allowed: true } | { allowed: false; reason: 'ORDER_NOT_APPROVED' | 'PROCUREMENT_INCOMPLETE' } {
  if (!['APPROVED', 'AUTO_APPROVED'].includes(order.status)) return { allowed: false, reason: 'ORDER_NOT_APPROVED' };
  return order.items.every((item) => ['IN_STOCK', 'RECEIVED'].includes(item.procurementStatus))
    ? { allowed: true }
    : { allowed: false, reason: 'PROCUREMENT_INCOMPLETE' };
}
```

Persist draft snapshots without calling Nova Poshta. Quote uses the selected sender profile and decrypted credential but stores no raw provider response.

- [ ] **Step 4: Run API tests**

Run: `pnpm --filter @autosale/api test -- delivery orders.service`

Expected: all focused tests PASS.

- [ ] **Step 5: Write failing review UI tests**

Test disabled reason, prefilled fields, exact city/location selection, quote refresh after parcel changes, COD validation, stable button dimensions, close/focus return, Escape, background scroll lock, and 390px drawer layout.

- [ ] **Step 6: Implement shipment panel and review dialog**

Place `ShipmentPanel` below procurement in `order-review-panel.tsx`. Use a desktop modal and full-height mobile drawer through the same semantic dialog. Fetch quote only after all required fields are valid. The final button says `Створити ТТН` but remains a no-op until Task 6 wires the command.

- [ ] **Step 7: Run web tests and typecheck**

Run: `pnpm --filter @autosale/web test -- shipment`

Run: `pnpm typecheck`

Expected: all tests PASS.

- [ ] **Step 8: Commit the review flow**

```bash
git add packages/contracts apps/api/src/delivery apps/api/src/orders apps/web
git commit -m "feat: review and quote Nova Poshta shipments"
```

---

### Task 6 (Task 65): Idempotent TTN creation and unknown-outcome reconciliation

**Files:**
- Modify: `packages/contracts/src/delivery.ts`
- Modify: `apps/api/src/delivery/delivery.service.ts`
- Modify: `apps/api/src/delivery/delivery.controller.ts`
- Modify: `apps/api/src/delivery/delivery.module.ts`
- Create: `apps/worker/src/delivery/shipment-create.service.ts`
- Create: `apps/worker/src/delivery/shipment-create.service.spec.ts`
- Create: `apps/worker/src/delivery/shipment-reconciler.ts`
- Create: `apps/worker/src/delivery/shipment-reconciler.spec.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/web/src/components/shipment-review-dialog.tsx`
- Modify: `apps/web/src/components/shipment-review-dialog.spec.tsx`

**Interfaces:**
- Produces API: `POST /api/orders/:orderId/shipments` returning HTTP 202 and `ShipmentSummary`.
- Produces BullMQ job: `shipment.create` with `{ shipmentId: uuid }`.
- Consumes stable key `shipment:create:v1:<shipmentId>:<version>` and matching request hash.

- [ ] **Step 1: Write failing API idempotency tests**

Test first command creates `Shipment(DRAFT -> CREATING)` plus `ShipmentAttempt(PENDING)` in one transaction, queues only after commit, and returns 202. Two concurrent commands for the same order must return the same active shipment. Reusing an explicit idempotency key with a different request hash returns 422; queue failure leaves durable work for reconciliation.

- [ ] **Step 2: Implement the command transaction and queue wake-up**

Claim uniqueness in PostgreSQL, not with read-then-insert. Configure queue `delivery` and job ID `shipment:create:<shipmentId>:<version>`. Catch only the known partial-unique conflict to replay the active shipment; propagate other database errors.

- [ ] **Step 3: Write failing worker tests**

Cover:

- one worker claims a pending attempt lease;
- a competing worker returns `IGNORED`;
- success stores provider document ID and TTN and sets `CREATED`;
- validation failure sets `FAILED` with a safe code;
- rate limit schedules `RETRYABLE` with bounded backoff;
- timeout/network after dispatch sets `UNKNOWN`, not a fresh create retry;
- `UNKNOWN` calls `findShipmentByClientRef`; found becomes `CREATED`, absent after the bounded reconciliation window permits exactly one new version;
- stale lease cannot overwrite a newer result.

- [ ] **Step 4: Implement create service and reconciler**

The reconciler finds due `PENDING | RETRYABLE | UNKNOWN` attempts and missed wake-ups. It enqueues deterministic job IDs and never invokes the provider itself. The service decrypts the credential only after a successful lease claim and drops the plaintext reference before logging.

- [ ] **Step 5: Wire the worker queue and metrics**

Add a `delivery` BullMQ worker with concurrency 2. Record operation/result/duration using existing observability helpers and only `shipmentId`, attempt version, provider, and safe error code. Add a five-second reconciliation loop and close it during shutdown.

- [ ] **Step 6: Run API and worker tests**

Run: `pnpm --filter @autosale/api test -- delivery`

Run: `pnpm --filter @autosale/worker test -- shipment`

Expected: all focused tests PASS, including concurrency and unknown outcomes.

- [ ] **Step 7: Wire stable UI progress**

Submit once, close the dialog only after the 202 response, show `Створюємо ТТН…`, poll the shipment summary while `CREATING`, and show one success or error toast. Keep the button's measured width and disable duplicate submission.

- [ ] **Step 8: Run web tests and commit**

Run: `pnpm --filter @autosale/web test -- shipment-review-dialog shipment-panel`

```bash
git add packages/contracts apps/api/src/delivery apps/worker apps/web/src/components
git commit -m "feat: create Nova Poshta TTNs safely"
```

---

### Task 7 (Task 66): Labels, cancellation, tracking, and order-list status

**Files:**
- Modify: `packages/contracts/src/delivery.ts`
- Modify: `packages/contracts/src/orders.ts`
- Create: `apps/worker/src/delivery/shipment-status.service.ts`
- Create: `apps/worker/src/delivery/shipment-status.service.spec.ts`
- Modify: `apps/worker/src/delivery/shipment-reconciler.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/api/src/delivery/delivery.controller.ts`
- Modify: `apps/api/src/delivery/delivery.service.ts`
- Modify: `apps/api/src/delivery/delivery.controller.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/web/src/components/shipment-panel.tsx`
- Modify: `apps/web/src/components/shipment-panel.spec.tsx`
- Modify: `apps/web/src/components/orders-table.tsx`
- Modify: `apps/web/src/components/orders-table.spec.tsx`
- Modify: `apps/web/app/(workspace)/orders/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Produces jobs: `shipment.status.sync`, `shipment.cancel`.
- Produces API: `POST /api/shipments/:id/cancel`, `GET /api/shipments/:id/label`.
- Extends order list query with `shipmentStatus?: ShipmentStatus` and rows with compact `shipment` summary.

- [ ] **Step 1: Write failing status mapper and scheduler tests**

Map known Nova Poshta codes to `CREATED/ACCEPTED/IN_TRANSIT/DELIVERED/RETURNING/RETURNED/CANCELLED`. Unknown codes preserve the current internal status, append a status event with `mappedStatus:null`, and schedule a later check. Terminal states receive no next check.

- [ ] **Step 2: Implement status sync and event history**

Claim a lease before calling the provider. Update `Shipment` and append `ShipmentStatusEvent` in one transaction. Deduplicate repeated provider status codes by `shipmentId + providerCode + providerOccurredAt` when the provider supplies a time, otherwise by `shipmentId + providerCode + observed revision`.

- [ ] **Step 3: Write failing cancel and label authorization tests**

Assert cancel is idempotent, denied after terminal delivery, and retains history. Assert label download is tenant-scoped, accepts only `CREATED` or later supported states, streams a bounded PDF response, and never exposes a provider URL containing credentials.

- [ ] **Step 4: Implement cancel and label endpoints**

Persist cancel intent before queueing. For label, fetch server-to-server, validate `application/pdf`, enforce a 10 MB body limit, and return `Content-Disposition: attachment; filename="nova-poshta-<ttn>.pdf"`.

- [ ] **Step 5: Update shipment and orders UI**

Render localized statuses, TTN copy, tracking link, label download, cancel confirmation, and collapsed history. Add delivery status to the desktop table/mobile card and a URL-backed `shipmentStatus` filter while preserving search, approval, procurement, page, pageSize, and return-to navigation.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @autosale/worker test -- shipment-status shipment-reconciler`

Run: `pnpm --filter @autosale/api test -- delivery orders`

Run: `pnpm --filter @autosale/web test -- shipment-panel orders-table orders/page`

Expected: all focused tests PASS.

- [ ] **Step 7: Commit lifecycle support**

```bash
git add packages/contracts apps/api apps/worker apps/web
git commit -m "feat: track Nova Poshta shipments"
```

---

### Task 8 (Task 67): Explicit customer TTN message

**Files:**
- Modify: `packages/contracts/src/delivery.ts`
- Modify: `apps/api/src/delivery/delivery.controller.ts`
- Modify: `apps/api/src/delivery/delivery.service.ts`
- Modify: `apps/api/src/delivery/delivery.service.spec.ts`
- Create: `apps/web/src/components/shipment-customer-message-dialog.tsx`
- Create: `apps/web/src/components/shipment-customer-message-dialog.spec.tsx`
- Modify: `apps/web/src/components/shipment-panel.tsx`
- Modify: `apps/web/src/components/delivery-settings-card.tsx`

**Interfaces:**
- Produces API: `POST /api/shipments/:id/customer-message` with `{ text: string }` and existing Instagram outbound message summary.
- Consumes the existing conversation outbound queue; it does not call Meta synchronously.

- [x] **Step 1: Write failing message-policy tests**

Require a `CREATED | ACCEPTED | IN_TRANSIT` shipment with TTN, an Instagram conversation belonging to the same order/tenant, manager role, 1–1,000 character text, and an explicit request. Assert duplicate submission with the same shipment/message version returns the existing outbound message.

- [x] **Step 2: Implement tenant-branded preview and queue command**

Generate the default text server-side from tenant name and TTN:

```ts
`${tenantName}: відправлення створено. Номер ТТН: ${trackingNumber}. ` +
`Відстежити: https://tracking.novaposhta.ua/#/uk/${trackingNumber}`
```

Persist through the existing Instagram outbound message path with idempotency key `shipment-customer-message:v1:<shipmentId>:<messageVersion>`. An Instagram error changes only message delivery state, never shipment state.

- [x] **Step 3: Write failing dialog tests**

Assert the message is editable, character count is visible, send has stable spinner, success disables the already-sent version, provider-window rejection offers `Скопіювати текст`, and the TTN remains visible.

- [x] **Step 4: Implement the manual message UI**

Show `Повідомити клієнта` only after a TTN exists. Respect the tenant setting `suggestCustomerNotification`; when disabled, keep the action available but do not emphasize it. Do not auto-open or auto-send.

- [x] **Step 5: Run tests and commit**

Run: `pnpm --filter @autosale/api test -- delivery`

Run: `pnpm --filter @autosale/web test -- shipment-customer-message shipment-panel delivery-settings-card`

```bash
git add packages/contracts apps/api/src/delivery apps/web/src/components
git commit -m "feat: send TTNs to Instagram customers"
```

---

### Task 9 (Task 68): Full verification, feature-flag rollout, and production acceptance

**Files:**
- Create: `tests/e2e/nova-poshta-delivery.spec.ts`
- Create: `tests/e2e/nova-poshta-delivery-mobile.spec.ts`
- Modify: `docs/acceptance/mvp-checklist.md`
- Modify: `tasks/todo.md`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes every preceding task.
- Produces repeatable automated acceptance plus a controlled manual production checklist.

- [x] **Step 1: Add privacy and contract regression scans**

Extend tests to inspect API responses, structured logs, thrown errors, audit rows, and metrics labels for absence of the literal test API key, customer phone, address, and raw provider payload. Include a cross-tenant matrix for connection, location, shipment, label, cancel, and message endpoints.

- [ ] **Step 2: Add desktop E2E with a local fake provider**

Exercise connect → sender defaults → order draft → exact location → quote → create → background success → copy TTN → label → status update → manual customer message. Reload between command and completion to prove durable recovery. Double-click create and assert one fake-provider document.

- [x] **Step 3: Add mobile E2E at 390×844**

Assert settings and shipment drawer have no horizontal overflow, focused fields remain above the virtual-keyboard-safe footer, actions do not jump during loading, toast stays right-aligned within the viewport, and close returns focus to `Створити відправлення`.

- [ ] **Step 4: Run the complete local verification gate**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `pnpm test:e2e -- nova-poshta-delivery.spec.ts nova-poshta-delivery-mobile.spec.ts`

Run: `git diff --check`

Expected: all commands PASS with zero skipped delivery tests.

- [x] **Step 5: Validate migration and Compose rollout locally**

Run: `docker compose --env-file .env config`

Run: `docker compose --env-file .env up -d --build`

Run the Prisma deployment command used by the existing production runbook, then confirm API, web, worker, PostgreSQL, Redis, MinIO, and proxy health. Keep `NOVA_POSHTA_DELIVERY_ENABLED=false` until the containers are healthy.

- [ ] **Step 6: Controlled production acceptance**

Enable the global feature flag while connecting only the controlled test tenant, choose the real sender profile, and create one controlled shipment. Verify exactly one TTN in both AutoSale and the Nova Poshta business cabinet, quote, label, tracking update, allowed cancellation, history retention, and one manager-confirmed Instagram message. Revoke/replace the key and confirm safe `NEEDS_ATTENTION` recovery without losing shipment history. Only after this acceptance should other tenant owners be invited to connect their own credentials.

- [ ] **Step 7: Update project records**

Check Task 60–68 acceptance items only when corresponding evidence exists. Record command counts, migration name, production time, real shipment redacted reference, and any provider limitation in `docs/acceptance/mvp-checklist.md`. Add the owner setup steps to `infra/README.md` without including the key.

- [ ] **Step 8: Final commit and push**

```bash
git add tests docs tasks infra
git commit -m "docs: verify Nova Poshta delivery rollout"
git push origin master
```

## Post-plan backlog

After Task 68 is stable in production, create separate approved specs and plans in this order:

1. Meest domestic shipment adapter using the same `DeliveryProvider` contract.
2. Ukrposhta domestic shipment adapter.
3. Bank accounts filtered by tenant legal entity and payment currency.
4. Payment status, COD reconciliation, and financial reporting.
5. Optional high-confidence automatic TTN creation and automatic customer notification, gated by measured correction and failure rates.
