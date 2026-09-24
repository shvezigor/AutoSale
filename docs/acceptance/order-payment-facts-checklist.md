# Order payment facts acceptance checklist

Verified on 2026-09-21 against [`order payment facts design`](../superpowers/specs/2026-09-20-order-payment-facts-design.md).

## Automated evidence

- [x] Additive tenant-safe migration stores immutable payment facts and complete cancellation metadata.
- [x] Decimal-safe calculation covers unpaid, partial, exact and overpaid states without storing a derived status.
- [x] Create and cancel commands are idempotent; conflicting replay is rejected.
- [x] Manager and owner can record a payment; only owner can cancel one.
- [x] Bank transfer requires an active account matching the selected legal entity and order currency.
- [x] Cash on delivery requires a supported carrier.
- [x] Cancelled payments remain in history and no longer affect the paid balance.
- [x] Active payment locks item and commercial-term changes while customer and delivery corrections remain available.
- [x] List totals and pagination use the exact derived payment-status filter.
- [x] Ukrainian and English order cards show loading, error, success and owner-only cancellation states without a page reload.
- [x] Desktop table and mobile cards show payment status; all filter and return URLs preserve it.
- [x] Mobile payment summary, form and history have no horizontal overflow at 390 px.
- [x] Audit events and metrics omit notes, cancellation reasons, IBANs and customer data.

## Verification commands

- [x] Contract tests and typecheck
- [x] Database unit, migration and PostgreSQL integration tests
- [x] API tests and typecheck
- [x] Web tests, typecheck and production build
- [x] `pnpm exec playwright test tests/e2e/order-payment-facts.spec.ts --workers=1`

## Production rollout

- [x] Apply migration `20260920220000_order_payment_facts` before starting the new application version.
- [ ] Create a fictional priced UAH order and record a partial cash payment.
- [ ] Record the remaining amount to a compatible fictional UAH account and observe `Оплачено`.
- [ ] Confirm item quantity and payment details are locked while an active payment exists.
- [ ] As owner, cancel one payment with a fictional reason and observe `Частково оплачено` with the row retained.
- [ ] Verify all four table filters and mobile layout in production.
- [x] Confirm API, web and worker health after deployment.
- [x] 2026-09-24, тестовий акаунт: `MN-000001` із явно збереженою сумою 4 840 UAH — готівковий тестовий факт 1 UAH перевів баланс у «Частково оплачено» та заблокував редагування товару; owner скасував запис із поясненням, баланс повернувся до 0 UAH, історія збереглась, редагування знову доступне. Це не був реальний платіж.
- [x] 2026-09-24: після ручного релізу `de751ee` на `MN-000002` форма оплати з'явилася одразу після першого збереження розрахунку 3 430 UAH, без reload. Запис фактичної оплати для цього замовлення не створювали.

### Backlog decision

- 2026-09-24: власник відклав решту production acceptance оплат. Часткова оплата, доплата до повної суми, блокування під час активної оплати, скасування, фільтри та мобільний сценарій будуть перевірені разом з іншими відкладеними end-to-end інтеграціями. Це не скасовує вже реалізований ledger і не означає, що незавершені live-сценарії перевірені.
- Автоматичну банківську звірку, звірку післяплати, повернення та allocation також залишено в backlog до окремого погодженого етапу.

### Deployment evidence

- Deployed commit: `70ed657749cb5b8c567cf63c3a4a432bee825d8f`.
- Pre-migration backup: `20260921T053217Z`; PostgreSQL, MinIO and configuration checksums verified locally.
- Migration `20260920220000_order_payment_facts` completed successfully before the application containers were replaced.
- API, web and worker reported `healthy`; `https://sales-aito.com/health/live` and `/login` returned HTTP 200 after deployment.
- The remaining unchecked items require an authenticated fictional-order smoke test and must not be inferred from container or public-route health.

## Explicitly not implemented

- Automatic bank statement or webhook reconciliation.
- Automatic carrier cash-on-delivery reconciliation.
- Refunds, payment allocation, online acquiring or accounting reports.
- Subscription billing for Sales AITO.
