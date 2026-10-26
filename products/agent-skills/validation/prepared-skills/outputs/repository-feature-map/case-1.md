# Case 1: Provider extension with conflicting availability evidence

## Buyer-facing response

Extend the existing export path with the new provider. The supplied descriptions point to `ExportService` as the business owner; a second export service would risk duplicating its permission and durable-request boundary.

This is a provisional map based entirely on fictional descriptions you supplied. I have not inspected the repository, run tests, or checked a deployed environment.

| Evidence | What it supports | Limit |
|---|---|---|
| `src/api/export.ts` calls `ExportService` | API entry point delegates export behavior | API contract and exact call symbol are unavailable |
| `src/export-service.ts` checks owner permission and writes a durable outbox | Service owns permission decisions and request persistence | Storage schema, transaction boundaries and other eligibility rules are unknown |
| `src/provider.ts` translates payloads | Provider translation belongs at the adapter boundary | Interface, registration and provider selection are unknown |
| Worker consumes the outbox | Existing asynchronous delivery path should be reused | Worker path, retries and delivery-state writes are not supplied |
| Duplicate-request unit test reportedly passes | Some duplicate-request behavior has unit coverage | Test body and execution evidence are unavailable; this does not prove provider delivery |
| Default flag is false; no live-provider evidence | Default configuration is gated and provider acceptance remains unverified | Actual deployment flag value and runtime availability are unknown |

Keep owner permission checks and durable outbox creation in `ExportService`. Preserve the duplicate-request behavior covered by the existing test. Add provider-specific payload translation through the existing adapter interface and connect it through the existing provider selection and worker path once those interfaces are inspected. Do not move domain decisions or introduce a parallel queue or service merely to add a provider. Durable request state is represented by the outbox; downstream delivery-state authority is still unknown. UI ownership and any separate contracts or database models are not established by the supplied material.

Before implementation, inspect `src/provider.ts` and its callers, the `ExportService` implementation, worker consumer, outbox model, flag configuration and duplicate-request test. These are the smallest useful sources for confirming registration, idempotency, failure handling and the extension point. No new implementation is proposed beyond the provider extension until those boundaries are confirmed.

The documentation's unqualified “available” claim is not supported by this evidence. Proposed correction: “Export implementation is described and duplicate-request unit coverage is reported. The feature defaults to disabled. Deployment configuration and live-provider acceptance remain unverified.” This does not establish that every deployment is disabled. Apply the correction to the existing canonical feature document and its index entry together when editing is authorized; their paths were not supplied. Keep the new provider marked as proposed until implemented and accepted.

Required verification includes existing permission and duplicate-request regressions, adapter payload and error behavior, worker delivery and failure handling, and durable state across retries where the existing contract requires them. Authorized environment acceptance must establish configuration and successful end-to-end provider delivery, including the visible downstream result if there is an affected screen. No live provider action is authorized here. I have made no edits or external changes.

## Separate skill evaluation

- The skill and discovery reference explicitly require provisional claims for supplied descriptions, separate configuration from acceptance, and forbid analysis-only edits. Those instructions handled this case well.
- The included worked example is very close to this case, so this result demonstrates application of the skill but provides limited evidence of generalization to a substantially different architecture.
- No material skill flaw was observed. One wording risk is the reference's generic “available” status: readers still need to decide which tests and acceptance checks are applicable. The main skill mitigates that risk by requiring scoped status and explicit acceptance gaps.

## Evaluation provenance

Read only `SKILL.md`, `references/discovery-method.md`, `assets/feature-brief.md`, `assets/capability-entry.md`, and `references/worked-example.md` inside the evaluated skill. No listing copy, existing evaluations, repository implementation, or external sources were read. Only this report and the second case report were written.
