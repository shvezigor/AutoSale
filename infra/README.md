# Production integrations

## Nova Poshta owner setup

1. Open the Nova Poshta API-key settings at `https://my.novaposhta.ua/settings/index#apikeys` and create a key dedicated to AutoSale.
2. In AutoSale open `Налаштування → Доставка` and paste the key. AutoSale validates it before encrypted storage; the key is never returned to the browser afterwards.
3. Select the sender, contact person, phone, origin branch or parcel locker, payer and default parcel dimensions from the provider-backed lists.
4. Review the customer TTN message template. Supported placeholders are `{company}`, `{trackingNumber}` and `{trackingUrl}`.
5. Save the sender profile, then use one approved and fully procured test order for production acceptance.

Do not place the key in repository files, screenshots, logs, issues or acceptance records. Replacing or disconnecting a credential preserves existing shipment history.

## Controlled rollout

Keep `NOVA_POSHTA_DELIVERY_ENABLED=false` during image build and migration. Enable it only after API, web and worker health checks pass. The first live run must use a controlled tenant and a non-customer test shipment. Confirm the same single TTN in AutoSale and the Nova Poshta cabinet before inviting other owners to connect credentials.

Nova Poshta does not document a public sandbox account for the standard API 2.0 shipment flow. Connecting a key and loading sender directories is the safe non-mutating check. A full shipment acceptance creates a real electronic waybill in the owner's cabinet, so use the owner's test contact details, do not hand over a parcel, and cancel the waybill immediately after label and status verification.

The acceptance checklist is in `docs/acceptance/mvp-checklist.md`; automatic deployment setup is in `infra/AUTO_DEPLOY.md`.
