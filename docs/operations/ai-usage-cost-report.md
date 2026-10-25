# Private monthly AI usage and cost report

The operator-only reader in `apps/worker/src/ai-usage/{monthly-report,report-cli}.ts` produces one private local JSON artifact. There is no HTTP endpoint, customer entitlement, dashboard or billing integration. The [canonical design](../superpowers/specs/2026-10-24-ai-provider-usage-ledger-design.md) owns the accounting boundaries; [data protection](data-protection-and-retention.md#ai-usage-measurement-approval-and-maintenance) owns approval and retention. Implementation does not authorize collection or deletion: keep `AI_USAGE_COLLECTION_ENABLED=false` and `AI_USAGE_RETENTION_ENABLED=false` until the separate approvals and rollout gates pass.

## Invocation and artifact protection

Build the worker and its dependencies, prepare an operator-owned private directory outside **every** Git repository/worktree, and place the reviewed input JSON there. On POSIX systems its directory must be owned by the operator with no group/other permission bits (normally `0700`); new report files are exclusively created with `0600`. On Windows, configure directory ACLs allowing only the current operator, SYSTEM and Administrators. The CLI checks actual ACLs through the Windows filesystem API, passing paths via environment values to a fixed PowerShell program. If PowerShell or reliable ACL inspection is unavailable, it fails closed with a fixed operator error. File access inherits from that checked private directory. The CLI never changes the permissions of an existing directory and never overwrites a report.

```sh
pnpm --filter @autosale/worker... build
pnpm --filter @autosale/worker ai-usage:report --input /private/ai-costs/operator-input-v1.json --month 2026-09 --output /private/ai-costs/report-2026-09-new.json
```

For Windows use absolute drive-qualified paths in the same invocation. Supply `DATABASE_URL` through the approved secret environment using the existing restricted RLS worker runtime identity; do not use an owner/superuser or backup connection, put a connection string in shell history, or write it into the JSON. The CLI reads this environment variable directly and does not load `.env`. It validates all arguments, external input, month and private output destination **before** reading any database rows. It returns exit code `0` only after writing and syncing the report. Successful runs print no report, tenant totals or output path to stdout/stderr. Failures return `1` with bounded fixed messages; database, filesystem, validation and raw provider errors are never printed. Read the artifact only in the private operator context.

The input and existing parent output directory must resolve outside the current checkout and any other checkout detected by an ancestor `.git` directory or gitfile. Symlinked paths are checked after resolution. Choose a new output filename on every run. Each explicitly authorized tenant is read in its own repeatable-read `withTenantTransaction`; no tenant-directory or unrestricted ledger scan exists. Limits are 100 authorized UUIDs and 100,000 attempts / 100,000 canonical orders per tenant/month. Exceeding a row bound aborts rather than writing a truncated report. The report is read-only apart from its private local file; it has no provider or queue dependency.

## Version 1 operator input

The following is **fictional format documentation**, not a tariff, invoice or activation approval. Keep the real file outside Git, with real reviewed evidence references in its `source` strings. All keys are required, unknown keys fail validation, monetary fields are nonnegative plain decimal **strings** with at most 12 integer and 12 fractional digits, and per-attempt token counts come only from the integer ledger columns. Timestamps must include seconds, end in `Z` and have no fractional seconds or at most three fractional digits; seconds and 1–3 digits retain their exact value. More than three digits (including trailing zeros) are rejected before `Date` construction and before any database query, never silently truncated to an earlier rate boundary. Rate ranges must have increasing endpoints. UUID membership, not a tenant name, defines authorization and the test cohort; UUIDs are normalized to lowercase and duplicates/unauthorized test UUIDs fail validation.

```json
{
  "version": 1,
  "month": "2026-09",
  "authorizedTenantIds": ["11111111-1111-4111-8111-111111111111"],
  "testTenantIds": [],
  "providerScope": {
    "accountId": "fictional-account",
    "projectId": "fictional-project",
    "verified": false
  },
  "rates": [{
    "version": "fictional-tariff-v1",
    "source": "FICTIONAL: replace with controlled tariff/invoice evidence reference",
    "model": "fictional-model",
    "currency": "USD",
    "effectiveFrom": "2026-09-01T00:00:00.000Z",
    "effectiveUntil": "2026-10-01T00:00:00.000Z",
    "inputPerMillion": null,
    "outputPerMillion": null,
    "cachedInputPerMillion": null
  }],
  "providerInvoice": {
    "month": "2026-09",
    "accountId": "fictional-account",
    "projectId": "fictional-project",
    "currency": "USD",
    "subtotal": "0",
    "credits": "0",
    "taxes": "0",
    "evidenceReviewed": false,
    "tenantIds": ["11111111-1111-4111-8111-111111111111"]
  },
  "infrastructureInvoice": {
    "month": "2026-09",
    "currency": "USD",
    "attributableAmount": "0",
    "evidenceReviewed": false,
    "allocationApproved": false
  },
  "collectionEvidence": null,
  "collectionGaps": [{
    "tenantId": null,
    "from": "2026-09-01T00:00:00.000Z",
    "until": "2026-10-01T00:00:00.000Z",
    "reason": "HISTORICAL_INCOMPLETE"
  }]
}
```

Use `null` for an unavailable `providerInvoice`, `infrastructureInvoice` or `collectionEvidence`; use `[]` for rates not yet established or no declared collection gaps. Unknown prices are `null`, never invented zeros. Explicit zero prices are permitted only when backed by the actual tariff. Model/account/project/version identifiers are bounded machine identifiers; source evidence references remain private and are not copied into the report.

`collectionEvidence`, when available, is `{ "from": "...Z", "until": "...Z", "tenantIds": ["..."], "complete": true }`. Only attest completeness after checking collection activation throughout the entire period, every authorized tenant, metering failure signals, retention/restore history and missing historical evidence. An empty ledger with collection OFF is **not** evidence of zero spend. Missing attestation, partial ranges, mismatched UUID scope or `complete=false` keeps the period provisional. Record actual overlapping gaps using `COLLECTION_DISABLED`, `METERING_FAILURE`, `RETENTION_EXPIRED`, `HISTORICAL_INCOMPLETE` or `OTHER`; use `tenantId=null` for a global gap. Do not put customer data, exception text, prompts, responses or credentials in any field.

## Reconciliation and interpretation

The period is the UTC half-open interval `[first day 00:00, next first day 00:00)`. Attempts use `started_at`; canonical distinct `orders.id` use `created_at`. Product-table token metadata, intent evaluations, order status transitions, retries of webhooks and exports never enter the AI numerator. Each ledger attempt counts once; explicit duplicate attempt evidence is rejected. Calls finalized in the next month expose a boundary caveat. All included-tenant calls count, including unused drafts, ignored intent checks and catalogue batches. Catalogue setup is also reported separately. Explicit test-cohort spend/order counts are separate and excluded from included unit-economics ratios. Zero-order ratios are `null`.

For each attempt use the returned model when present, otherwise its requested model, and the single effective tariff at dispatch time. Money uses a local high-precision `Prisma.Decimal` configuration, never binary floating-point arithmetic. Input cost splits into uncached input and cached input; output is priced separately. If the cached split is missing for nonzero input, leave that input unpriced while retaining any known output cost. A missing dimension/rate or ambiguous overlapping tariffs stays unpriced, with a coverage reason. Known token totals are sums of available counts; `coverage` and `unpricedAttempts` distinguish missing evidence from explicit zero. `NOT_SENT` is a known non-charge; `STARTED`, `CHARGE_UNKNOWN` and `USAGE_MISSING` remain visible. Ratios are rounded to 12 decimal places.

In the private report JSON, **all** `inputTokens`, `outputTokens` and `cachedInputTokens` totals are nonnegative base-10 integer strings, including `"0"`, at the tenant, purpose/model bucket and included/test-cohort levels. Every intermediate token addition uses `BigInt`; no aggregate is converted back to a JavaScript number. This preserves totals above `Number.MAX_SAFE_INTEGER` within the unchanged 100-tenant/100,000-row limits. For example, 100 tenants with 99,999 calls of 2,147,483,647 tokens produce `"21474621721635300"`. Attempt/order/unpriced-attempt counts remain JSON numbers; per-attempt database token fields remain integers. Consumers must retain token strings or parse them as arbitrary-precision integers, never use `Number` to read aggregate token totals.

The provider subtotal must be **pre-credit and pre-tax**, in the provider invoice currency, for the exact month, verified Sales AITO account/project and the full authorized tenant set, including test tenants. Before marking `verified` / `evidenceReviewed`, verify that this project boundary excludes unrelated products and that all project tenants are authorized and included in the reconciliation scope. The ledger has no historical project ID: this verification is an explicit operator attestation, not an inference from a model name. `variance = computedPreCredit - invoiceSubtotal`; any nonzero variance stays provisional. The artifact separately shows credits, taxes and `subtotal - credits + taxes`, but these adjustments never hide usage variance or alter the direct pre-tax AI numerator. Rate versions are reported; preserve tariff/source provenance in the private input alongside the invoice evidence. No rate or exchange rate is embedded in application code.

Infrastructure is a separate attributable pre-tax host/storage/services invoice input. `allocationApproved=true` attests an evidence-backed Sales AITO included-cohort amount, including an approved separation of technical/test or other workloads on a shared host. Without that approval the blended figure is provisional. The report presents this amount once globally and computes `(included known AI cost + attributable infrastructure) / included canonical orders`. It does not allocate shared infrastructure to individual tenants. Infrastructure retains its own invoice currency; when currencies differ the blended ratio is `null`, with a coverage gap. No conversion is performed.

The entire report is `PROVISIONAL` whenever collection evidence, scope, invoice review, matching month/scope, rate, usage breakdown or approved infrastructure allocation is missing, a month boundary caveat exists, or provider variance is unexplained. Known money is a **lower bound** in that state; zero known money is not a claim of zero charges. Labour, taxes, payment fees and customer carrier/message fees are explicitly excluded. `COMPLETE` is only an evidence/reconciliation status for the supplied scope, not permission to bill or proof of willingness to pay or the pricing hypothesis.

## Verification and disposal

The [usage-ledger acceptance checklist](../acceptance/ai-usage-cost-report-checklist.md) records the refreshed 2026-10-25 local release preflight against implementation `4fa109f`, including catalogue dispatch freeze/lease regressions, migration/grant review and exact pending live gates. Before release, record current master, running/candidate image IDs, a verified backup and actual deployed flags. Source defaults do not prove live configuration. The controller owns the additive deployment; a release with collection/deletion OFF is schema/code-only acceptance, not measured usage. No production image, backup, invoice or activation approval was inspected in the local preflight.

Focused acceptance is `pnpm --filter @autosale/worker exec vitest run src/ai-usage/monthly-report.spec.ts src/ai-usage/report-cli.spec.ts`, plus worker typechecking/build and the worker regression suite. Fictional real-PostgreSQL tests cover the restricted worker role, empty/cross-tenant RLS, explicit test cohort, UTC boundaries and an actual private CLI artifact without product-table token double counting. Filesystem tests exercise private writes, broad/unverifiable Windows ACL refusal, exclusive output and cross-checkout path refusal. There is no UI/browser flow in this task. Deployment, real-provider/invoice reconciliation, privacy/accounting activation approval and the existing product-flow/browser/restore rollout gates remain open.

Artifacts contain confidential tenant UUIDs and cost aggregates. Never attach them to source control, logs, public storage or an unapproved ticket. Use the approved private evidence store only for the authorized review period; this task authorizes no longer-lived tenant-linked summaries or new retention schedule. After review, delete the exact input/report copies from the operator directory and any approved temporary working copies under the existing disposal policy. Filesystem deletion alone does not prove physical erasure on SSDs or remove backups; use approved encrypted storage, normal backup expiry and the documented restore/deletion process. Keep only approved aggregate conclusions without tenant identifiers when a separate policy permits that retention.
