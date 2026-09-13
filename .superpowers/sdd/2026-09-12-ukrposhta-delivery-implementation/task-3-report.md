# Task 3 — Ukrposhta shipment lifecycle and PDF label

Implementation complete for the gated sandbox slice; production acceptance remains deliberately blocked. Base: `bb2e8bd`. Adapter/contracts checkpoint: `972dda2` (feat(delivery): add gated Ukrposhta eCom shipment adapter). The subsequent integration commit includes this report.

## Requirement coverage

| Brief | Implementation and evidence |
| --- | --- |
| 1. Carrier/contracts | Explicit NOVA_POSHTA/UKRPOSHTA draft and prefill; Ukrposhta exact BRANCH only. Strict recipient/parcel/payer/value/COD/description validation retained. |
| 2. Postcode | Adapter-owned strict opaque `up:{officeId}:{fiveDigitPostcode}` ref preserves stable office identity and postcode separately from labels. Classifier regression and API/worker tests prove labels are not parsed. Old numeric sender refs require branch re-selection and safely block review. |
| 3–5. Official provider boundary | Address create/read, client create/external-ID resolution, quote, shipment create/UUID/barcode/lifecycle read, CREATED-only update/delete and forms PDF. Fixed official environment-selected HTTPS hosts; redirects refused; documented bearer/token usage. Bounded and validated JSON (1 MiB) and PDF (10 MiB, including streaming size/signature/content type). Safe bounded error codes, without raw responses/secrets/personal data. |
| 6. Durable idempotency | Existing local Shipment and ShipmentAttempt committed before queueing; unique active-shipment constraint retained. Conditional lease and persisted createDispatched BEFORE POST prevent duplicate logical shipments on clicks/jobs/restarts. Renewed leases cannot be stolen by stale candidates. UNKNOWN never crosses POST again, even without metadata. |
| 7. Provisioning/storage | Deterministic tenant/intent/version/environment/generation/role client external-ID lookup before create. Address/client checkpoints reused. UUID, barcode, parcels, final cost and lifecycle persisted. One additive nullable JSONB provider_metadata migration with regenerated Prisma types and PostgreSQL tenant/uniqueness tests. |
| 8. Manager flow | Active carrier selector, carrier-scoped exact pickers, payer/description/parcel/value/COD review, estimate, save and async create. Ukrposhta create requires quote and gate. Gate-off still allows draft and quote. Quote failure ends loader with recovery text. |
| 9. PDF proxy | Existing authenticated and tenant-authorized label route downloads bytes; provider-aware sanitized filename, no tokenized browser URL. Connection environment/generation mismatch blocks provider access. |
| 10. Lifecycle/cancel | API checks CREATED before queueing; worker/adapter check again before DELETE. Non-CREATED maps to local state/refusal. Successful delete records DELETED; persisted delete-dispatched marker permits ambiguous deletion to converge on NOT_FOUND. Terminal errors reach UI. No StatusTracking polling. |
| 11. Customer message | Existing explicit tenant-branded preview/send path with Ukrposhta tracking URL. Barcode required. No automatic customer send during create or worker processing. |
| 12. Gate | UKRPOSHTA_SANDBOX_SHIPMENTS_ENABLED defaults false in API/worker. API, worker and adapter gate creation. Production is hard-disabled even when sandbox flag is true. Connection/directories/profile/quote/draft remain usable. |
| 13. Validation | Fake fetch/provider boundaries; TDD; focused/affected suites, actual ephemeral PostgreSQL and full workspace typechecks passed. No push/deploy/secret changes. |

## Official-source decisions and boundaries

Read local `docs/research/ukrposhta-api-integration-research.md` and verified the [official eCom document dated 09.03.2026](https://dev.ukrposhta.ua/uploads/API_documentation_09032026_ua.pdf): address/client sections 2–3, shipment section 4, domestic quote 6.2, forms 10. Only documentation was browsed, never live provider APIs.

- STANDARD/W2W is the deliberately narrow service for this stage. The documented POST /domestic/delivery-price gives a side-effect-free estimate; final deliveryPrice comes from create. Weight converts kg to integer grams and dimensions to integer centimetres.
- Individual clients use firstName/lastName/middleName/phoneNumber. Current Task 2 senderName is interpreted as surname, first name, optional patronymic; sender COD requires patronymic. Recipient follows surname-first convention. The worker refuses company prefixes; settings/review explain the supported input. Legal-entity support requires an explicit extension with legal/tax/bank data rather than guessing from a display name.
- Existing numeric-only branch references must be selected again. Display labels never supply postcodes.
- No undocumented shipment search-by-external-ID or provider idempotency guarantee is assumed. Correlation is sent, but automatic reconciliation requires a persisted UUID/barcode.
- Ordinary overview reads the persisted snapshot. eCom reads occur during reconciliation/cancellation; subsequent tracking is Task 4. No StatusTracking jobs are scheduled for Ukrposhta.
- Successful DELETE has an empty response, so DELETED uses local acknowledgement time rather than a claimed provider timestamp.

## Ambiguous outcome and recovery

A timeout/interrupted response/crash after dispatch keeps the existing intent active (CREATING, attempt UNKNOWN, UKRPOSHTA_OUTCOME_UNKNOWN). Repeated jobs reconcile persisted UUID/barcode; absent identity, the state stays unknown with a 15-minute delayed reconciliation. The UI explains that repeat create is blocked.

An operator must investigate in the same environment/counterparty and preserve the existing intent. Do not clear the marker, remove the active intent or create a replacement merely because POST timed out. A verified remote identity can be recovered into the existing intent through an audited operational procedure; no privileged recovery UI or guessed lookup endpoint is added here. Interrupted address provisioning can leave an unused remote address, but cannot create a second logical shipment.

Credential replacement fails closed for historical work: both environment and generation must match. This prevents counterparty/sandbox/production mixing, but historical access after credential rotation requires an explicit reconciliation decision. Terminal cancellation failures are retained for investigation; this slice adds no manager override to bypass a failed durable cancellation attempt.

## TDD and verification

Observed RED → GREEN for carrier/ref validation and classifier regression, eCom/forms boundary, default/explicit gate, migration, API/worker integration and carrier-specific UI. Follow-up regressions cover the five reported backend failures: replaced environment label access, stale sender ref, UNKNOWN without metadata, DELETED snapshot and ambiguous DELETE/404. Additional RED → GREEN checks cover stale lease renewal, terminal cancellation errors and quote-error loaders.

Final validation on 2026-09-13, all exit 0:

| Command | Result |
| --- | --- |
| `pnpm --filter @autosale/contracts --filter @autosale/config --filter @autosale/integrations test` | Contracts 70, config 28, integrations 169 passed, including Nova Poshta/Meest. |
| `pnpm --filter @autosale/api test delivery` | 75 passed, including authorized routes and affected connections. |
| `pnpm --filter @autosale/worker test delivery` | 45 passed, including routing/reconciler/message delivery. |
| `pnpm --filter @autosale/web test delivery shipment ukrposhta meest-settings-card` | 43 passed using normal web jsdom configuration. |
| `pnpm --filter @autosale/database test delivery.postgres` | 8 passed on ephemeral Testcontainers PostgreSQL 17.6. |
| `pnpm -r typecheck` | All 8 workspace packages/apps passed. |
| `git -c core.safecrlf=false diff --check` | Clean. |

Total: 438 tests across the listed suites. This is focused/affected validation, not every repository test, production build or browser E2E. No live carrier contract test or shipment was created. Prisma generation used a dummy DATABASE_URL; frozen offline installation refreshed injected workspace packages without lockfile changes. An API env test fixture was updated only to include the new default-false flag.

## Handoff

Apply the additive migration and generated client together during a later authorized deployment. Keep the sandbox flags false except during explicitly approved combined carrier acceptance; production creation stays blocked in code. Acceptance must verify actual STANDARD/W2W payloads, sender/COD contract permissions, estimate/final costs, PDF readability and controlled lifecycle/deletion. Legal-entity sender support, audited unknown-outcome tooling and StatusTracking are not silently supplied by this slice.

No push, deployment, real shipment, production API call or secret change was performed. Unrelated untracked orchestration briefs/progress files remain untouched.
