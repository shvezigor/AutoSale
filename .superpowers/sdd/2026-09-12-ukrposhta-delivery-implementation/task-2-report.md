# Task 2 report — Ukrposhta classifier and sender defaults

Date: 2026-09-12
Base commit: `462f0c1`
Scope: classifier-backed delivery directory, tenant-scoped sender defaults, API wiring, and the existing settings card. Shipment/client creation, labels, tracking, deployment, and production configuration were intentionally excluded.

## Outcome

- Added Ukrposhta classifier city and branch search on the fixed `https://www.ukrposhta.ua/address-classifier-ws/` host.
- Classifier requests use the connected eCom bearer, JSON accept header, redirect rejection, and an abortable timeout per attempt.
- Added a bounded three-attempt retry policy for 429, 5xx, network, timeout, and temporarily empty classifier results, with deterministic injectable backoff for tests.
- Normalized single-record and array classifier envelopes defensively. Malformed JSON, malformed envelopes, and malformed records fail with bounded `UkrposhtaError` messages that do not include provider bodies or credentials.
- Filtered blocked/unavailable offices through classifier capability fields and retained stable city/office references, Ukrainian labels, and postcode when present.
- Extended the public directory contract and shared location picker to Ukrposhta `CITY` and `BRANCH`; Ukrposhta parcel lockers remain rejected.
- Routed Ukrposhta searches through the tenant's active encrypted connection and retained credential-generation-aware cache isolation.
- Added a strict `UkrposhtaSenderProfileInput` contract covering sender name, Ukrainian phone, exact branch, payer, parcel defaults, notification suggestion, and template. Connection summaries expose only this safe profile and never credentials or counterparty UUIDs.
- Persisted sender defaults in the existing tenant-scoped `DeliverySenderProfile` relation only when an active Ukrposhta connection exists.
- Added owner-only `PUT /api/integrations/delivery/ukrposhta/sender-profile`; managers continue to read the safe connection summary.
- Extended the existing Ukrposhta settings card with exact city/branch selection, sender/default fields, stable activity/loading/toast behavior, and a complete read-only manager summary.
- Reused the existing responsive delivery form/grid styles; no new wizard or navigation was introduced.

## TDD evidence

The inherited partial contract/client tests were reviewed first. For remaining behavior, tests were added and observed failing before implementation:

- API service tests failed because sender-profile persistence and safe summary mapping did not exist.
- Directory service tests failed because Ukrposhta routing and generation-aware cache selection did not exist.
- Controller tests failed because the owner-only sender-profile method did not exist.
- Web tests failed because the sender form, complete manager summary, and save action did not exist.
- Picker tests exercised the real picker with an injected search boundary and failed at the former provider restriction before it was expanded.

The implementation was then added in minimal red/green passes, followed by strict type fixes and full affected-package verification.

## Verification

All provider calls in tests use fake `fetch`; no live Ukrposhta endpoint was contacted.

| Command | Result |
| --- | --- |
| `pnpm --filter @autosale/contracts test` | 9 files, 61 tests passed |
| `pnpm --filter @autosale/integrations test` | 10 files, 135 tests passed |
| `pnpm --filter @autosale/api test` | 70 files, 406 tests passed |
| `pnpm --filter @autosale/web test` | 57 files, 194 tests passed |
| contracts typecheck | passed |
| integrations typecheck | passed |
| API typecheck | passed |
| web typecheck | passed |

## Security and compatibility review

- Classifier URLs are constructed from a fixed official base and fixed internal endpoint names.
- The counterparty token is not sent to classifier endpoints.
- Provider bodies and caught error messages are not propagated.
- Secrets and counterparty UUIDs do not cross the sender-profile contract or manager UI.
- Persistence and cache keys remain tenant scoped; cache keys also include provider and credential generation.
- Existing Nova Poshta and Meest test suites remain green.

## Residual concerns

- Per task constraints, the official 2026 classifier contract is covered by fixtures only; a controlled sandbox contract check remains a later rollout activity.
- The existing shared delivery feature flag still gates Ukrposhta, matching Task 1 and avoiding a production-configuration change in this slice.

## Fix round 1/5 — response-body transport errors and dependent origin reset

- Preserved `TIMEOUT` for `AbortError`/`TimeoutError` and `NETWORK` for `TypeError` raised while reading a successful classifier response body, so the existing transient retry policy applies for at most three attempts.
- Kept malformed JSON classified as non-retryable `INVALID_RESPONSE`.
- Cleared the full dependent branch origin (`cityRef`, `locationRef`, and label) when an owner edits, clears, or replaces the selected city; the sender-profile save action disables immediately.
- Added focused fake-fetch and real picker/card regressions. Both test groups were observed failing before the fixes and passing afterward.

Verification commands and results:

| Command | Result |
| --- | --- |
| `pnpm exec vitest run src/ukrposhta.spec.ts` (integrations) | 1 file, 19 tests passed |
| `pnpm exec vitest run src/components/ukrposhta-settings-card.spec.tsx` (web) | 1 file, 5 tests passed |
| `pnpm --filter @autosale/integrations test` | 10 files, 138 tests passed |
| `pnpm --filter @autosale/web test` | 57 files, 195 tests passed |
| `pnpm --filter @autosale/integrations typecheck` | passed |
| `pnpm --filter @autosale/web typecheck` | passed |
