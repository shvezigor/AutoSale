# Order Commercial Terms and Bank Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically snapshot the expected total for each new order and let each tenant manage legal entities and active bank accounts filtered by entity and currency.

**Architecture:** Add a provider-neutral commercial-terms domain beside orders, procurement, delivery, and subscription billing. PostgreSQL stores immutable line-price snapshots plus a versioned one-to-one order total; owner-only settings manage legal entities and accounts, while order reads expose only server-filtered eligible accounts. Actual received payments remain outside this plan.

**Tech Stack:** TypeScript 5.9, Node.js, NestJS 11, Prisma 7/PostgreSQL, Zod 4, Next.js 16/React 19, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-19-order-commercial-terms-and-bank-accounts-design.md`

## Global Constraints

- PostgreSQL is the source of truth for commercial terms, legal entities, and bank accounts.
- Expected totals are computed from immutable decimal-string price snapshots; never use JavaScript floating-point arithmetic for money.
- Approval, procurement, shipment, delivery, or order closure never records money as received.
- Account eligibility is enforced server-side by tenant, legal entity, currency, and `active = true`.
- Existing orders receive no historical price automatically; legacy initialization requires an explicit preview and save before fulfillment starts.
- Full IBAN values must not appear in logs, metrics, toast messages, error payloads, or audit changes.
- The change is additive and must preserve existing order, procurement, delivery, and Google Sheets behavior.
- Test fixtures use fictional identifiers and `UA000000000000000000000000000`-style non-routable IBANs.

---

## File Structure

- `packages/database/prisma/schema.prisma` and a new migration own persistence, constraints, and relations.
- `packages/database/src/commercial-terms.ts` owns decimal-safe calculation and transactional materialization; neither API nor worker duplicates pricing rules.
- `packages/contracts/src/commercial.ts` owns public schemas and DTOs; `orders.ts` references its summaries.
- `apps/api/src/commercial-settings/*` owns owner-only legal-entity and bank-account administration.
- `apps/api/src/orders/commercial-terms.controller.ts` owns manager-safe preview and selection endpoints; `orders.service.ts` only integrates summaries and order corrections.
- `apps/worker/src/orders/triggered-order.processor.ts` materializes snapshots for newly recognized orders in the same database transaction.
- `apps/web/src/components/commercial-settings-hub.tsx` owns the closed-by-default settings accordion.
- `apps/web/src/components/order-commercial-terms-card.tsx` owns expected-total review and compatible account selection.

### Task 1: Add the additive financial schema and decimal-safe calculation boundary

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260919230000_order_commercial_terms/migration.sql`
- Create: `packages/database/src/commercial-terms.ts`
- Create: `packages/database/src/commercial-terms.spec.ts`
- Create: `packages/database/src/commercial-terms-migration.spec.ts`
- Modify: `packages/database/src/index.ts`
- Regenerate: `packages/database/src/generated/prisma/**`

**Interfaces:**
- Produces: `CommercialLineInput`, `CommercialCalculation`, `calculateCommercialTerms(lines)` and `materializeCommercialTerms(tx, input)`.
- Produces Prisma models `TenantLegalEntity`, `TenantBankAccount`, `OrderCommercialTerms` and nullable snapshot fields on `OrderItem`.
- Consumes: existing `Product.price`, `Product.currency`, `OrderItem.quantity`, and Prisma transaction clients.

- [ ] **Step 1: Write failing pure-calculation tests**

```ts
import { describe, expect, it } from 'vitest';
import { calculateCommercialTerms } from './commercial-terms.js';

describe('calculateCommercialTerms', () => {
  it('uses decimal strings and quantity without floating point drift', () => {
    expect(calculateCommercialTerms([
      { itemId: 'one', quantity: 3, unitPrice: '0.10', currency: 'UAH', sourceSku: 'SKU-1' },
    ])).toMatchObject({ pricingStatus: 'READY', currency: 'UAH', itemsSubtotal: '0.30', totalAmount: '0.30' });
  });

  it('refuses missing prices and mixed currencies', () => {
    expect(calculateCommercialTerms([
      { itemId: 'one', quantity: 1, unitPrice: null, currency: null, sourceSku: null },
      { itemId: 'two', quantity: 1, unitPrice: '5.00', currency: 'USD', sourceSku: 'SKU-2' },
    ])).toMatchObject({ pricingStatus: 'NEEDS_REVIEW', totalAmount: null, issueCodes: ['ITEM_PRICE_MISSING'] });
  });
});
```

- [ ] **Step 2: Run the focused test and observe the missing module failure**

Run: `pnpm --filter @autosale/database test -- commercial-terms.spec.ts`

Expected: FAIL because `commercial-terms.ts` and `calculateCommercialTerms` do not exist.

- [ ] **Step 3: Add Prisma models and additive nullable order-item fields**

Add enums `CommercialPricingStatus { READY NEEDS_REVIEW }`, `LegalEntityType { COMPANY SOLE_PROPRIETOR OTHER }`, and models with these required constraints:

```prisma
model TenantLegalEntity {
  id              String                  @id @default(uuid()) @db.Uuid
  tenantId        String                  @map("tenant_id") @db.Uuid
  displayName     String                  @map("display_name")
  legalName       String                  @map("legal_name")
  type            LegalEntityType
  registrationId  String?                 @map("registration_id")
  active          Boolean                 @default(true)
  isDefault       Boolean                 @default(false) @map("is_default")
  createdAt       DateTime                @default(now()) @map("created_at")
  updatedAt       DateTime                @updatedAt @map("updated_at")
  tenant          Tenant                  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  bankAccounts    TenantBankAccount[]
  commercialTerms OrderCommercialTerms[]

  @@unique([tenantId, displayName])
  @@index([tenantId, active])
  @@map("tenant_legal_entities")
}

model TenantBankAccount {
  id                  String                  @id @default(uuid()) @db.Uuid
  tenantId            String                  @map("tenant_id") @db.Uuid
  legalEntityId       String                  @map("legal_entity_id") @db.Uuid
  label               String
  iban                String
  normalizedIban      String                  @map("normalized_iban")
  bankName            String?                 @map("bank_name")
  currency            String                  @db.VarChar(3)
  active              Boolean                 @default(true)
  isDefault           Boolean                 @default(false) @map("is_default")
  createdAt           DateTime                @default(now()) @map("created_at")
  updatedAt           DateTime                @updatedAt @map("updated_at")
  tenant              Tenant                  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  legalEntity         TenantLegalEntity       @relation(fields: [legalEntityId], references: [id], onDelete: Restrict)
  commercialTerms     OrderCommercialTerms[]

  @@unique([tenantId, normalizedIban, currency])
  @@index([tenantId, legalEntityId, currency, active])
  @@map("tenant_bank_accounts")
}

model OrderCommercialTerms {
  id                  String                  @id @default(uuid()) @db.Uuid
  tenantId            String                  @map("tenant_id") @db.Uuid
  orderId             String                  @unique @map("order_id") @db.Uuid
  legalEntityId       String?                 @map("legal_entity_id") @db.Uuid
  bankAccountId       String?                 @map("bank_account_id") @db.Uuid
  currency            String?                 @db.VarChar(3)
  itemsSubtotal       Decimal?                @map("items_subtotal") @db.Decimal(14, 2)
  discountAmount      Decimal                 @default(0) @map("discount_amount") @db.Decimal(14, 2)
  deliveryAmount      Decimal                 @default(0) @map("delivery_amount") @db.Decimal(14, 2)
  totalAmount         Decimal?                @map("total_amount") @db.Decimal(14, 2)
  pricingStatus       CommercialPricingStatus @map("pricing_status")
  issueCodes          Json                    @map("issue_codes")
  legalEntitySnapshot Json?                   @map("legal_entity_snapshot")
  bankAccountSnapshot Json?                   @map("bank_account_snapshot")
  version             Int                     @default(1)
  updatedBy           String                  @map("updated_by")
  createdAt           DateTime                @default(now()) @map("created_at")
  updatedAt           DateTime                @updatedAt @map("updated_at")
  tenant              Tenant                  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  order               Order                   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  legalEntity         TenantLegalEntity?      @relation(fields: [legalEntityId], references: [id], onDelete: SetNull)
  bankAccount         TenantBankAccount?      @relation(fields: [bankAccountId], references: [id], onDelete: SetNull)

  @@index([tenantId, pricingStatus])
  @@map("order_commercial_terms")
}
```

Add `unitPriceSnapshot Decimal? @db.Decimal(14, 2)`, `currencySnapshot String? @db.VarChar(3)`, `lineTotalSnapshot Decimal? @db.Decimal(14, 2)`, and `priceSourceSku String?` to `OrderItem`. Add reverse relations to `Tenant`, `Order`, `TenantLegalEntity`, and `TenantBankAccount`.

- [ ] **Step 4: Write the SQL migration with database-level default uniqueness**

Create tables and foreign keys from the Prisma diff, then add partial unique indexes Prisma cannot express:

```sql
CREATE UNIQUE INDEX "tenant_legal_entities_one_default"
  ON "tenant_legal_entities" ("tenant_id") WHERE "active" = TRUE AND "is_default" = TRUE;
CREATE UNIQUE INDEX "tenant_bank_accounts_one_default_per_currency"
  ON "tenant_bank_accounts" ("legal_entity_id", "currency") WHERE "active" = TRUE AND "is_default" = TRUE;
```

The migration must not populate `order_commercial_terms` or snapshot fields for existing rows.

- [ ] **Step 5: Implement decimal-safe calculation and transactional materialization**

Export these exact types and functions:

```ts
export type CommercialLineInput = {
  itemId: string;
  quantity: number;
  unitPrice: string | null;
  currency: string | null;
  sourceSku: string | null;
};
export type CommercialCalculation = {
  pricingStatus: 'READY' | 'NEEDS_REVIEW';
  currency: string | null;
  itemsSubtotal: string | null;
  totalAmount: string | null;
  issueCodes: Array<'ITEM_PRICE_MISSING' | 'ITEM_CURRENCY_MISSING' | 'MIXED_CURRENCIES'>;
  lines: Array<CommercialLineInput & { lineTotal: string | null }>;
};
export function calculateCommercialTerms(lines: CommercialLineInput[]): CommercialCalculation;
export async function materializeCommercialTerms(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; orderId: string; actor: string; lines: CommercialLineInput[] },
): Promise<CommercialCalculation>;
```

Use `Prisma.Decimal` for multiplication, addition, and two-decimal serialization. `materializeCommercialTerms` updates item snapshots and upserts the one-to-one terms row, default entity, and compatible default account atomically.

- [ ] **Step 6: Add migration integration assertions**

Assert a fresh database rejects a second active default entity, rejects a second active default account for the same entity/currency, accepts defaults for different currencies, and leaves a pre-migration order without terms.

- [ ] **Step 7: Generate Prisma, run tests, and typecheck**

Run:

```bash
pnpm --filter @autosale/database generate
pnpm --filter @autosale/database test -- commercial-terms.spec.ts commercial-terms-migration.spec.ts
pnpm --filter @autosale/database typecheck
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the database boundary**

```bash
git add packages/database
git commit -m "feat(database): add order commercial terms"
```

### Task 2: Define stable commercial contracts

**Files:**
- Create: `packages/contracts/src/commercial.ts`
- Create: `packages/contracts/src/commercial.spec.ts`
- Modify: `packages/contracts/src/orders.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Consumes: database enum names only as string-literal equivalents; contracts do not import Prisma.
- Produces: `LegalEntitySummary`, `BankAccountSummary`, `CommercialSettingsSummary`, `OrderCommercialTermsSummary`, `CommercialTermsUpdate`, and Zod request schemas.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(commercialTermsUpdateSchema.safeParse({
  version: 2,
  legalEntityId: '11111111-1111-4111-8111-111111111111',
  bankAccountId: '22222222-2222-4222-8222-222222222222',
}).success).toBe(true);
expect(bankAccountInputSchema.safeParse({
  legalEntityId: '11111111-1111-4111-8111-111111111111',
  label: 'Основний UAH', iban: 'not-an-iban', currency: 'UAH', active: true, isDefault: true,
}).success).toBe(false);
```

- [ ] **Step 2: Run the contract test and observe the missing exports**

Run: `pnpm --filter @autosale/contracts test -- commercial.spec.ts`

Expected: FAIL because the commercial schemas are absent.

- [ ] **Step 3: Implement schemas and summaries**

Use decimal strings matching `/^(0|[1-9]\d*)(\.\d{2})$/`, uppercase three-letter currencies, UUIDs, and normalized IBAN input. Define the order summary as:

```ts
export interface OrderCommercialTermsSummary {
  pricingStatus: 'READY' | 'NEEDS_REVIEW';
  issueCodes: CommercialIssueCode[];
  currency: string | null;
  itemsSubtotal: string | null;
  discountAmount: string;
  deliveryAmount: string;
  totalAmount: string | null;
  legalEntity: LegalEntitySummary | null;
  bankAccount: BankAccountSummary | null;
  eligibleAccounts: BankAccountSummary[];
  version: number;
  legacy: boolean;
}
```

Add `commercialTerms: OrderCommercialTermsSummary | null` and item snapshot fields to `ManagerOrder` without making legacy API responses invalid.

- [ ] **Step 4: Export the contracts and package subpath**

Add `export * from './commercial.js'` and a `./commercial` package export matching the existing `./orders` conditions.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @autosale/contracts test -- commercial.spec.ts
pnpm --filter @autosale/contracts typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the public interface**

```bash
git add packages/contracts
git commit -m "feat(contracts): define commercial terms APIs"
```

### Task 3: Build owner-only legal entity and bank account settings APIs

**Files:**
- Create: `apps/api/src/commercial-settings/commercial-settings.module.ts`
- Create: `apps/api/src/commercial-settings/commercial-settings.controller.ts`
- Create: `apps/api/src/commercial-settings/commercial-settings.service.ts`
- Create: `apps/api/src/commercial-settings/commercial-settings.controller.spec.ts`
- Create: `apps/api/src/commercial-settings/commercial-settings.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: input schemas and summaries from `@autosale/contracts/commercial`.
- Produces: `GET/POST/PATCH /api/settings/legal-entities`, `GET/POST/PATCH /api/settings/bank-accounts`, and owner-only `GET /api/settings/bank-accounts/:id` for editing the unmasked value.
- Produces: `CommercialSettingsService.list(tenantId)`, `createLegalEntity`, `updateLegalEntity`, `createBankAccount`, and `updateBankAccount`.

- [ ] **Step 1: Write controller authorization and validation tests**

Cover owner success, manager `403`, missing CSRF rejection, invalid IBAN `400`, and cross-tenant IDs returning `404`. Assert responses mask IBAN as `UA••••0000` while authorized edit data returns the full value only from the dedicated account detail response.

- [ ] **Step 2: Run the focused API tests and observe missing module failures**

Run: `pnpm --filter @autosale/api test -- commercial-settings.controller.spec.ts commercial-settings.service.spec.ts`

Expected: FAIL because the controller and service do not exist.

- [ ] **Step 3: Implement transactional default switching**

Use a single transaction when `isDefault` is true:

```ts
await tx.tenantBankAccount.updateMany({
  where: { tenantId, legalEntityId: input.legalEntityId, currency: input.currency, isDefault: true },
  data: { isDefault: false },
});
return tx.tenantBankAccount.create({ data: { ...input, tenantId, normalizedIban } });
```

Reject deactivation of the active default entity until another default is selected. Reject account entity IDs outside the principal tenant. Map unique conflicts to safe `409` responses without echoing the full IBAN.

- [ ] **Step 4: Register the module and role boundary**

Use `@RequireMembership('OWNER')` on mutations and `@RequireMembership('MANAGER')` on safe list endpoints so managers can receive eligible display data without changing settings.

- [ ] **Step 5: Run API tests and typecheck**

Run:

```bash
pnpm --filter @autosale/api test -- commercial-settings.controller.spec.ts commercial-settings.service.spec.ts
pnpm --filter @autosale/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit settings APIs**

```bash
git add apps/api/src/commercial-settings apps/api/src/app.module.ts
git commit -m "feat(api): manage tenant bank accounts"
```

### Task 4: Snapshot prices for every newly recognized order

**Files:**
- Modify: `apps/worker/src/orders/triggered-order.processor.ts`
- Modify: `apps/worker/src/orders/triggered-order.processor.spec.ts`
- Modify: `apps/api/src/demo/demo-scenario.service.ts`
- Modify: `apps/api/src/demo/demo-scenario.service.spec.ts`

**Interfaces:**
- Consumes: `materializeCommercialTerms(tx, { tenantId, orderId, actor, lines })` from Task 1.
- Produces: new AI-created and demo orders with item snapshots plus `OrderCommercialTerms` in the same transaction.

- [ ] **Step 1: Add failing worker scenarios**

Assert a product `{ sku:'DOOR-1', price:'4395.00', currency:'UAH' }` with quantity `2` produces unit `4395.00`, line `8790.00`, total `8790.00`, and `READY`. Assert missing price produces `NEEDS_REVIEW` with null total but does not fail order recognition. Repeat the ready assertion for both phrase-triggered and conversational-intent creation paths.

- [ ] **Step 2: Run the worker tests and verify snapshots are absent**

Run: `pnpm --filter @autosale/worker test -- triggered-order.processor.spec.ts`

Expected: FAIL on missing snapshots/terms.

- [ ] **Step 3: Select prices with the existing catalogue query**

Extend the existing product selection to include `price`, `currency`, and `active`. Convert Prisma decimals to strings before passing them to the calculator. Do not send prices to the AI prompt.

- [ ] **Step 4: Materialize terms inside each existing order transaction**

After inserting order items and before returning the transaction, call `materializeCommercialTerms` with `actor: 'SYSTEM'`. Use the inserted item IDs instead of adding a second order creation path. A `NEEDS_REVIEW` pricing result does not alter the existing recognition status in this first slice; the payment card carries its own blocking reason.

- [ ] **Step 5: Apply the same invariant to demo order creation**

Demo orders use clearly fictional products and call the same materializer. This prevents demo behavior from diverging from production behavior.

- [ ] **Step 6: Run worker/API tests and typechecks**

Run:

```bash
pnpm --filter @autosale/worker test -- triggered-order.processor.spec.ts
pnpm --filter @autosale/api test -- demo-scenario.service.spec.ts
pnpm --filter @autosale/worker typecheck
pnpm --filter @autosale/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit automatic pricing snapshots**

```bash
git add apps/worker/src/orders apps/api/src/demo
git commit -m "feat(orders): snapshot expected totals"
```

### Task 5: Integrate commercial terms with order reads, corrections, and legacy preview

**Files:**
- Create: `apps/api/src/orders/commercial-terms.controller.ts`
- Create: `apps/api/src/orders/commercial-terms.service.ts`
- Create: `apps/api/src/orders/commercial-terms.controller.spec.ts`
- Create: `apps/api/src/orders/commercial-terms.service.spec.ts`
- Modify: `apps/api/src/orders/orders.module.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `calculateCommercialTerms`, `materializeCommercialTerms`, and commercial contracts.
- Produces: `POST /api/orders/:id/commercial-terms/preview` and `PUT /api/orders/:id/commercial-terms`.
- Extends `GET /api/orders/:id` and list mappings with `commercialTerms` and line snapshots.

- [ ] **Step 1: Write failing service tests for filtering and correction**

Cover these exact behaviors:

1. eligible accounts include only `tenantId + legalEntityId + currency + active`;
2. selecting a USD account for a UAH order returns `400`;
3. stale `version` returns `409` and leaves the record unchanged;
4. changing quantity recomputes from `unitPriceSnapshot`, not current `Product.price`;
5. changing `catalogId` snapshots the newly selected product and clears an incompatible account;
6. procurement handoff, supplier dispatch, or shipment blocks snapshot changes;
7. previewing a legacy order has no database side effect;
8. explicit save materializes the preview and records an audit event without full IBAN.

- [ ] **Step 2: Run focused tests and observe missing behavior**

Run: `pnpm --filter @autosale/api test -- commercial-terms.service.spec.ts orders.service.spec.ts`

Expected: FAIL because commercial terms are not mapped or recalculated.

- [ ] **Step 3: Implement safe summaries and eligible-account lookup**

Add `commercialTerms` to `OrdersService.include`. Map all decimals with `.toFixed(2)`. The service query must include:

```ts
where: {
  tenantId,
  legalEntityId,
  currency,
  active: true,
}
```

Never accept client-provided eligible-account arrays or totals.

- [ ] **Step 4: Recalculate corrections in the existing order transaction**

When quantity changes, retain the stored unit snapshot. When catalog selection changes, read the active product by `{ tenantId, sku }`, copy its current price/currency, recalculate all lines, upsert terms, release procurement reservations as today, and keep the order in `NEEDS_REVIEW`. If currency changes, set `bankAccountId` and `bankAccountSnapshot` to null unless the selected account remains eligible.

- [ ] **Step 5: Add preview and versioned update endpoints**

`preview` returns an `OrderCommercialTermsSummary` with `legacy: true` and does not write. `PUT` accepts only `{ version, legalEntityId, bankAccountId }` for existing terms or `{ version: 0, legalEntityId, bankAccountId, initializeLegacy: true }` before fulfillment. The server recomputes totals and snapshots; it never trusts a submitted amount.

- [ ] **Step 6: Run API tests and typecheck**

Run:

```bash
pnpm --filter @autosale/api test -- commercial-terms.controller.spec.ts commercial-terms.service.spec.ts orders.service.spec.ts
pnpm --filter @autosale/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit order integration**

```bash
git add apps/api/src/orders
git commit -m "feat(api): expose order commercial terms"
```

### Task 6: Add the closed-by-default Payment settings hub

**Files:**
- Create: `apps/web/src/components/commercial-settings-hub.tsx`
- Create: `apps/web/src/components/commercial-settings-hub.spec.tsx`
- Create: `apps/web/src/api/commercial-settings.ts`
- Modify: `apps/web/src/components/settings-tabs.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.tsx`
- Modify: `apps/web/app/(workspace)/settings/page.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: settings APIs and commercial summaries from Tasks 2–3.
- Produces: settings tab ID `payments` and owner UI for legal entities and accounts.

- [ ] **Step 1: Write failing interaction tests**

Render one entity and one account. Assert both accordion rows start with `aria-expanded="false"`, clicking opens only that row, owner forms submit normalized values, manager sees read-only summaries, success updates local state without page reload, and 400/409 errors remain inside the active panel.

- [ ] **Step 2: Run the component tests and observe the missing hub**

Run: `pnpm --filter @autosale/web test -- commercial-settings-hub.spec.tsx settings/page.spec.tsx`

Expected: FAIL because the component and `payments` tab do not exist.

- [ ] **Step 3: Add typed browser API helpers**

Create functions `getCommercialSettings`, `createLegalEntity`, `updateLegalEntity`, `createBankAccount`, and `updateBankAccount`. Mutations use `mutatingFetch`; no component calls `fetch` directly.

- [ ] **Step 4: Build the accordion UI using the delivery hub pattern**

The hub contains `Юридичні особи` and `Банківські рахунки`; `open` initializes to `null`. Account rows show entity, currency, default/active badges, and masked IBAN. Editing reveals the full IBAN only inside the owner form returned by the authorized API.

- [ ] **Step 5: Add the settings tab in setup order**

Extend `SettingsTabId` with `payments`, parse `?tab=payments`, fetch `/api/settings/legal-entities` and `/api/settings/bank-accounts`, and insert the tab after `delivery` and before `notifications`. Managers receive the read-only variant.

- [ ] **Step 6: Add Ukrainian and English copy plus responsive styles**

Add labels for entity type, legal name, account label, bank, IBAN, currency, active/default states, loading, success, conflict, and empty states. At `max-width: 720px`, forms become one column and actions become full-width without horizontal scrolling.

- [ ] **Step 7: Run web tests and typecheck**

Run:

```bash
pnpm --filter @autosale/web test -- commercial-settings-hub.spec.tsx settings/page.spec.tsx
pnpm --filter @autosale/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit settings UI**

```bash
git add apps/web/src/components/commercial-settings-hub* apps/web/src/api/commercial-settings.ts apps/web/src/components/settings-tabs.tsx apps/web/app/\(workspace\)/settings apps/web/src/i18n apps/web/app/globals.css
git commit -m "feat(web): add payment settings hub"
```

### Task 7: Add the expected-payment card to order review

**Files:**
- Create: `apps/web/src/components/order-commercial-terms-card.tsx`
- Create: `apps/web/src/components/order-commercial-terms-card.spec.tsx`
- Modify: `apps/web/src/components/order-review-panel.tsx`
- Modify: `apps/web/src/components/order-review-panel.spec.tsx`
- Modify: `apps/web/src/i18n/messages/uk.ts`
- Modify: `apps/web/src/i18n/messages/en.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `ManagerOrder.commercialTerms` and versioned preview/update endpoints.
- Produces: an order card that displays expected total, pricing issues, entity, and server-filtered active account choices.

- [ ] **Step 1: Write failing UI-state tests**

Cover `READY` total formatting, `NEEDS_REVIEW` issue labels, legacy preview without immediate write, explicit legacy save, an eligible-account selector that contains no inactive/mismatched options, `409` refresh guidance, save spinner, and the explanatory text `Сума до сплати — не підтвердження отримання коштів.` Assert the card is read-only after external fulfillment starts.

- [ ] **Step 2: Run the focused tests and observe the missing card**

Run: `pnpm --filter @autosale/web test -- order-commercial-terms-card.spec.tsx order-review-panel.spec.tsx`

Expected: FAIL because the card is absent.

- [ ] **Step 3: Implement local card state and versioned mutation**

Use `mutatingFetch` for preview/update, preserve a stable card height during loading, disable only card controls while saving, and return the updated `ManagerOrder` through `onOrderChange`. Do not reload or remount the full order page.

- [ ] **Step 4: Integrate the card between products and fulfillment**

Render after the product section and before Sheets/procurement/delivery actions. When the main order editor saves a quantity or product change, apply the returned order so the card total updates immediately from the API response.

- [ ] **Step 5: Add localized money and issue presentation**

Format decimal strings with `Intl.NumberFormat` only for display; never parse and resubmit formatted amounts. Map `ITEM_PRICE_MISSING`, `ITEM_CURRENCY_MISSING`, and `MIXED_CURRENCIES` to concrete Ukrainian and English guidance.

- [ ] **Step 6: Run web tests and typecheck**

Run:

```bash
pnpm --filter @autosale/web test -- order-commercial-terms-card.spec.tsx order-review-panel.spec.tsx
pnpm --filter @autosale/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the order card**

```bash
git add apps/web/src/components/order-commercial-terms-card* apps/web/src/components/order-review-panel* apps/web/src/i18n apps/web/app/globals.css
git commit -m "feat(web): show expected order payment"
```

### Task 8: Prove cross-feature compatibility and prepare rollout

**Files:**
- Create: `tests/e2e/order-commercial-terms.spec.ts`
- Modify: `tests/e2e/order-review.spec.ts`
- Modify: `tests/e2e/settings.spec.ts`
- Modify: `docs/features/README.md`
- Modify: `tasks/todo.md`
- Create: `docs/acceptance/order-commercial-terms-checklist.md`

**Interfaces:**
- Consumes: all production interfaces from Tasks 1–7.
- Produces: regression evidence, canonical status updates, and a manual production acceptance checklist that does not claim actual payment tracking.

- [ ] **Step 1: Add the end-to-end happy path**

Create a fictional owner, entity, UAH and USD accounts, and a two-item UAH order. Verify total calculation, UAH-only account choices, quantity correction recalculation, approval, procurement, and shipment readiness. Assert no payment-received state exists or changes during this flow.

- [ ] **Step 2: Add legacy and isolation cases**

Verify an existing order shows `Суму не зафіксовано`, preview makes no write, explicit save creates terms, another tenant's entity/account IDs are rejected, and fulfillment blocks subsequent snapshot changes.

- [ ] **Step 3: Run focused end-to-end tests**

Run:

```bash
pnpm exec playwright test tests/e2e/order-commercial-terms.spec.ts tests/e2e/order-review.spec.ts tests/e2e/settings.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
```

Expected: all tests, typechecks, builds, and whitespace checks PASS.

- [ ] **Step 5: Update canonical status and acceptance evidence**

Change the feature-map row from `Planned` to `Available` only after the full suite passes. Mark Task 73 first-stage items complete, leave actual payment recording/reconciliation unchecked, and record migration, owner settings, automatic snapshots, legacy behavior, tenant isolation, mobile UI, and regression evidence in the acceptance checklist.

- [ ] **Step 6: Commit verification and documentation**

```bash
git add tests docs/features/README.md docs/acceptance/order-commercial-terms-checklist.md tasks/todo.md
git commit -m "test: verify commercial terms workflow"
```

## Final Delivery Gate

- [ ] Review every commit for secrets, production personal data, generated build output, `.env` files, dumps, PID/token files, and unrelated user changes.
- [ ] Apply the migration in a pre-production copy and confirm existing orders remain without invented terms.
- [ ] Verify one fictional new order and one legacy preview in the browser at desktop and mobile widths.
- [ ] Merge the short-lived `codex/order-payments-design` branch into current `master`, push `master`, deploy manually under the existing runbook, and run production health plus migration checks.
- [ ] Delete the merged branch only after confirming no unique tracked or untracked work remains.
