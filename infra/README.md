# Production integrations

## Nova Poshta owner setup

1. Open the Nova Poshta business cabinet and create an API key dedicated to AutoSale.
2. In AutoSale open `Налаштування → Доставка` and paste the key. AutoSale validates it before encrypted storage; the key is never returned to the browser afterwards.
3. Select the sender, contact person, phone, origin branch or parcel locker, payer and default parcel dimensions from the provider-backed lists.
4. Review the customer TTN message template. Supported placeholders are `{company}`, `{trackingNumber}` and `{trackingUrl}`.
5. Save the sender profile, then use one approved and fully procured test order for production acceptance.

Do not place the key in repository files, screenshots, logs, issues or acceptance records. Replacing or disconnecting a credential preserves existing shipment history.

## Controlled rollout

Keep `NOVA_POSHTA_DELIVERY_ENABLED=false` during image build and migration. Enable it only after API, web and worker health checks pass. The first live run must use a controlled tenant and a non-customer test shipment. Confirm the same single TTN in AutoSale and the Nova Poshta cabinet before inviting other owners to connect credentials.

The acceptance checklist is in `docs/acceptance/mvp-checklist.md`; automatic deployment setup is in `infra/AUTO_DEPLOY.md`.
