# Order commercial terms acceptance checklist

Verified on 2026-09-19 against the implementation described in [`order commercial terms and bank accounts design`](../superpowers/specs/2026-09-19-order-commercial-terms-and-bank-accounts-design.md).

## Automated evidence

- [x] Decimal-safe calculation uses `Prisma.Decimal`; `0.10 × 3` is stored as `0.30`.
- [x] Migration adds nullable order-item snapshots and commercial-term tables without inventing values for existing orders.
- [x] PostgreSQL prevents multiple active default legal entities per tenant and multiple active default accounts per entity/currency.
- [x] AI trigger, suggestion and automatic-order paths materialize item price snapshots and the expected total in the order transaction.
- [x] Missing catalogue price produces `NEEDS_REVIEW` commercial terms without silently changing the recognition status.
- [x] Quantity corrections recalculate from the immutable unit-price snapshot; product replacement takes a new snapshot from the selected catalogue product.
- [x] Legal-entity and bank-account mutations are owner-only; manager reads contain masked IBANs.
- [x] Account selection is enforced server-side by tenant, active legal entity and currency; cross-tenant or mismatched IDs are rejected.
- [x] Concurrent version changes return a conflict instead of overwriting a newer selection.
- [x] Existing orders support a read-only preview and require explicit initialization before snapshots are written.
- [x] Supplier dispatch, procurement handoff or shipment creation locks later commercial-term selection changes.
- [x] The settings accordions start closed and the order card remains usable at a 390 px viewport.
- [x] Order approval, supplier state, shipment state and delivery state do not create an actual-payment record.

## Verification commands

- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm build`
- [x] `pnpm test:e2e` (12 active scenarios passed; 19 credential-gated live scenarios skipped)
- [x] Focused settings and order-card component tests
- [x] Focused API, worker, contract and database tests

## Production rollout

- [ ] Apply migration `20260919230000_order_commercial_terms` before starting the new application version.
- [ ] Confirm a pre-migration order still shows no invented amount.
- [ ] Create a fictional UAH order from a priced catalogue item and verify the expected total.
- [ ] Add fictional UAH and USD accounts and verify only the UAH account is selectable.
- [ ] Change quantity before fulfillment and verify the expected total updates without duplicating the order export.
- [ ] Verify the settings and order card at desktop and mobile widths.
- [ ] Confirm application health after manual deployment.

## Explicitly not implemented

- [ ] Manual recording of money received.
- [ ] Bank webhook ingestion and reconciliation.
- [ ] Partial payments, overpayments, refunds or payment allocation.

These unchecked items require a separate audited payment-ledger design. They must not be inferred from approval, shipment, delivery or order closure.
