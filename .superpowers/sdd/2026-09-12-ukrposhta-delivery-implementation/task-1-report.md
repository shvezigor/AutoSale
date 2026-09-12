# Task 1 — Safe Ukrposhta connection report

## Scope completed

- Added a strict, browser-safe `UkrposhtaConnectionSummary` contract and runtime schema. It contains only provider, status, safe account label, verification/error metadata, and selected environment.
- Added a tenant-scoped `UkrposhtaConnectionService` that validates through `UkrposhtaClient` before saving, encrypts the complete credential bundle as one JSON document, uses a fresh credential generation on each upsert, and exposes a decrypted active-client context for later directory work.
- Added the manager-readable and owner-only `GET`/`PUT`/`DELETE` endpoint at `/api/integrations/delivery/ukrposhta`. Provider rejections become the bounded `400 Ukrposhta rejected the connection` response.
- Registered the connection service and controller in `DeliveryModule` behind the existing delivery feature flag.
- Added the responsive Ukrposhta Settings → Delivery card. Managers see safe state only. Owners can choose sandbox or production, enter all four credential values, see an inline production warning, and use the established activity, toast, loading, and disconnect-confirmation components. Secret fields are cleared after every submission outcome. There is no sender-profile UI.
- Extended Settings server loading to fetch the Ukrposhta summary and updated the Delivery tab description.

## TDD evidence

1. Added the safe-summary contract test; it failed because `ukrposhtaConnectionSummarySchema` was absent, then passed after the minimal contract implementation.
2. Added the service tests; they failed because the Ukrposhta service did not exist, then passed after the tenant-scoped implementation.
3. Added the controller tests; they failed because the controller did not exist, then passed after route implementation.
4. Added the settings-card tests; they failed because the card did not exist, then passed after implementation.
5. Extended Settings page tests; they failed because server loading did not request the Ukrposhta summary, then passed after wiring it.

## Verification

- `pnpm --filter @autosale/contracts exec vitest run src/delivery.spec.ts` — 17 passed.
- `pnpm --filter @autosale/api exec vitest run src/delivery/delivery.controller.spec.ts src/delivery/ukrposhta-connection.service.spec.ts` — 23 passed.
- `pnpm --filter @autosale/web exec vitest run 'app/(workspace)/settings/page.spec.tsx' src/components/ukrposhta-settings-card.spec.tsx` — 4 passed.
- `pnpm --filter @autosale/contracts typecheck` — passed.
- `pnpm --filter @autosale/api typecheck` — passed.
- `pnpm --filter @autosale/web typecheck` — passed.
- `git diff --check` — passed.

## Safety notes

- No Ukrposhta network request was made.
- No production configuration was changed, and nothing was pushed or deployed.
- Nova Poshta and Meest behavior were left intact.
