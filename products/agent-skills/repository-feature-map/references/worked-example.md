# Fictional example: shipment export

Supplied evidence, not a real repository:

- `docs/features.md` calls shipment export available.
- `src/providers/carrier.ts` translates payloads only.
- `src/shipments/export-service.ts::requestExport` checks permission and idempotency, writes an outbox record and owns export eligibility.
- `src/workers/export.ts::processExport` calls the provider adapter and records delivery.
- `src/settings.ts` defaults the export flag to false.
- `tests/export.spec.ts` covers duplicate requests; no live-provider acceptance evidence is supplied.

Request: add a new provider and explain what to reuse, without editing.

Decision: extend the existing export boundary and add the provider translation behind its interface. Preserve permission, eligibility, idempotency and outbox ownership in `requestExport`; creating another export service inside the provider directory would duplicate that boundary. Keep worker delivery handling within the existing worker contract.

Status: implementation is evidenced by supplied source descriptions and duplicate-request coverage. Actual production configuration and provider acceptance are unknown. The feature index's unqualified available claim conflicts with the default-off configuration and absent acceptance evidence; propose a scoped correction, rather than claiming the feature is live or changing files during a read-only request.

Next evidence: adapter interface and registration call sites, provider failure tests and authorized environment configuration. The filename map is provisional until those source boundaries are inspected. No new files, commits or deployments are performed by this analysis.
