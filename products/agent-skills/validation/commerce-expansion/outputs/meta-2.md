# Instagram integration readiness: meta-2

Audit date: 2026-10-26. Fictional supplied-callback-trace analysis only. Login/API path and version are unspecified. Official documentation is unavailable; version-sensitive requirements remain unverified. No credentials, browser/network calls, provider calls, database access or settings changes were used.

Evidence T1: state was checked. T2: first authorization-code exchange succeeded. T3: a later token request returned HTTP 400; no safe category or error body is available. No product action, endpoint identity, actor/account eligibility or full token-lifecycle trace was supplied.

Technical verdict: the later token stage is unresolved; a complete connection cannot be declared ready. Submission verdict: readiness not established by this trace. Provider approval status: unknown, with no approval or access-level evidence.

There is no justified exact permission to add. HTTP 400 is not a permission diagnosis, and the later request must first be identified. Connecting a Facebook Page is not a universal fix: requirements differ by login/API path and version, and neither has been supplied. Do not edit permissions, link accounts or re-run exchanges to guess.

## Smallest evidence request

Ask the integration owner for one redacted diagnostic bundle limited to this failed attempt:

- Configured login/API path and API version, intended next capability, and the failing request's lifecycle stage (for example exchange, refresh or another token operation). Give HTTP method and host/path/version; omit query secrets and all credential-bearing values.
- The later response's safe provider error code/subcode, category/type and sanitized message, plus a correlation/request ID if safe. If unavailable, explicitly say it was not captured; do not supply raw response or tokens just to obtain it.
- A short ordered timeline of the successful code exchange and failed later operation, listing only parameter names and which credential class was used, not values. Include redacted application error classification and whether the same code was reused if already known.

Do not request customer exports, login credentials, app secrets, authorization codes, access/refresh tokens or authorization headers. Request only follow-up context relevant to the safe error/stage once this bundle is examined. Official path/version documentation links or a dated excerpt can be supplied for later verification; unavailable docs remain a limitation.

| Action/gate | Path-specific requirement | Evidence | Status | Owner and next check |
|---|---|---|---|---|
| State verification | Valid request/response binding for the selected OAuth path | T1 says checked; implementation detail absent | Supported only as a reported check | Engineering: preserve redacted trace; do not infer broader security guarantees. |
| Initial code exchange | Applicable exchange succeeds | T2 | Supported for first exchange | Engineering: retain stage/timing evidence. |
| Later token operation | Correct operation, endpoint/version, parameter/credential classes and applicable lifecycle requirements | T3 HTTP 400 only | Blocked pending diagnosis | Engineering: supply the minimal safe bundle. |
| Exact product permission | Needed endpoint/capability maps to exact permission/access level/account eligibility in official path/version docs | Path/version and action missing; docs unavailable | Unknown | Integration owner: establish action and path before considering changes. |
| Facebook Page linkage | Applicable only if the verified integration path requires it | No path/account linkage evidence | Unknown applicability | Integration owner: verify with official path-specific requirements, not a universal workaround. |
| App mode, actor and approval gates | Applicable eligibility, role acceptance, external access and review status | None supplied | Unknown | App owner: supply these only when relevant to diagnosed stage or external readiness. |
| Webhooks | Applicable subscription, challenge, authenticity, acknowledgement and downstream behavior | None supplied; scope not specified | Unknown applicability | Engineering: include later only if part of intended product scope. |
| Reviewer, storage and revoke/delete readiness | Actual accessible flow and documented lifecycle/data handling | None supplied | Unknown | Review/engineering owner: provide before full readiness acceptance. |

## Blocking dependency order and diagnostic plan

1. Identify the exact failing operation using the minimal bundle. The successful first exchange narrows the trace but does not establish that the later operation is a refresh, that credentials remain valid, or that permissions are sufficient.
2. Read safe error classification and inspect existing redacted request-construction evidence. Compare endpoint/version, parameter names, credential class and operation order with the exact path's requirements when official documentation becomes available. Do not retry a potentially single-use authorization code.
3. Form hypotheses conditional on that evidence: malformed/missing parameters, wrong endpoint/path, an inapplicable token operation, wrong token class, reuse/expiry, or permission/access eligibility. These are possible branches, not findings. A safe code/message may eliminate most branches. Never log secret values for comparison.
4. Only if the error and verified docs identify access scope as the cause, map the intended product action to the smallest exact permission and access level. Confirm actor/account eligibility, mode and any documented linking requirements. Until then propose no permission additions or Page linking.
5. Produce a scoped proposed fix for owner review. Keep live settings edits and provider calls out of this audit. Once separately authorized, use fictional/test actors for one bounded reproduction and acceptance flow; no real customer messages.

## Reviewer plan and data handling

A reviewer-ready walkthrough cannot be reconstructed from this callback fragment. After the defect is diagnosed and an authorized fix is verified, the review owner should privately provision and rehearse an accessible reviewer actor, start from a stable app URL, record full login/consent/callback, then demonstrate each requested capability and its visible downstream result. Record actual labels and clicks from the product; none were supplied. Keep credentials in the provider-designated private process. Cover relevant reload persistence, token lifecycle and revoke/delete behavior, and any authentic webhook processing if required by scope.

Ask the operational owner for actual storage boundaries, retained data, retention/deletion policy and processor practices only as needed for the broader readiness report; this trace proves none of them. Do not fabricate privacy or compliance statements.

## Proposed acceptance versus observed results

Observed from supplied evidence: state checked, first code exchange succeeded, later token request failed HTTP 400. No exact root cause, permission deficiency or Page-link deficiency is established. No browser/provider checks, reproduction, token calls, settings changes, review submission or external-client acceptance occurred.

Next acceptance step: engineering supplies the sanitized stage/error/path bundle. Documentation verification follows for that exact path/version; a bounded separately authorized test would then demonstrate the corrected lifecycle and visible connected-account/capability result. Technical, submission and provider-approval readiness remain distinct and open.
