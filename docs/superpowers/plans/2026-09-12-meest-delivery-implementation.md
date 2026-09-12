# Meest delivery implementation

## Confirmed provider constraints

- Production API login and password are issued by Meest after a customer contract is signed.
- Meest publishes test client parameters and browser sandboxes for query and shipment functions.
- Query and document requests use XML envelopes signed as MD5 of the documented ordered fields.
- AutoSale uses the working HTTPS variants of the official endpoints; credentials must never be sent over HTTP.
- Shipment creation and registration are separate provider operations. AutoSale will not register a shipment for carriage without an explicit manager action in the first release.

## Delivery slices

1. Add a credential-safe query client and map cities and branches into the existing provider-neutral location types.
2. Store encrypted `login`, `password` and `ClientUID` per tenant, expose only status/account label, and add owner-only connection controls.
3. Make location search provider-aware while preserving cache isolation by tenant, provider and credential generation.
4. Persist the Meest sender name, phone, exact origin branch and parcel defaults before enabling shipment actions.
5. Add quote and draft support, then create/delete/register with durable idempotency and unknown-outcome reconciliation.
6. Add label and tracking mappings, then run sandbox acceptance before exposing Meest in the shipment dialog.

## Security and compatibility

- Disable XML entity processing and reject malformed or structurally unexpected responses.
- Escape the provider filter language and XML independently.
- Keep passwords, signed request bodies and recipient data out of logs, errors and frontend responses.
- Existing Nova Poshta endpoints and stored credentials remain compatible throughout the additive rollout.
- The deferred real Nova Poshta acceptance remains required before Nova Poshta is opened beyond the current workspace.
