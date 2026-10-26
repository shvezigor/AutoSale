---
name: meta-instagram-integration-readiness-audit
description: Audit an Instagram API integration's readiness for OAuth testing and Meta App Review using supplied configuration and reviewer evidence. Use for permission mapping, callback or webhook blockers and review preparation. Separates technical readiness from Meta approval and does not change provider settings.
---

# Meta Instagram Integration Readiness Audit

Produce a dated map of technical blockers, review evidence and remaining provider decisions. This is an independent preparation workflow, not an official Meta product or an approval service. Default to read-only analysis; no account credentials are needed for supplied-text review.

## Identify the actual integration path

Record app type/use case, API/login path, API version, professional account type, app mode, intended external users, needed actions and test actors. Instagram Login and Facebook Login paths have different requirements; do not merge their permission sets or assume a Facebook Page link universally applies. Request redacted settings, exact safe error codes/stages and official documentation links rather than tokens or customer screenshots.

Consult [references/readiness-method.md](references/readiness-method.md). Before making version-sensitive assertions, verify the current official Meta documentation for that exact path/version and record the date/source. If access is blocked, label the requirement unverified and describe what must be checked. Previously working settings, a blog post or this skill cannot prove current provider eligibility.

## Map actions to minimal access

Make a table of required product action, API endpoint/capability, exact permission, access level, account eligibility and evidence. Classify each requirement as supported, blocked, unknown or not applicable. Separate app mode, business verification, permission review, account role/tester acceptance and successful external-client use; one completed gate does not satisfy the others.

Use the supplied feature scope to remove unrelated review requests from the proposed plan, without altering the live application. Do not request broad permissions “just in case.” A currently granted tester flow does not establish availability to a non-role customer. A dashboard percentage or “ready for testing” badge does not establish Advanced Access or approval.

## Trace the OAuth and webhook lifecycle

Trace authorize redirect, callback/state verification, code exchange, token lifecycle, account selection/linking, storage boundary and revocation/deletion flow. Distinguish the stage that failed; HTTP 400 alone is not a root cause. Inspect exact redirect matching and deployed callback reachability using redacted evidence; preserve app secrets and tokens. Do not ask for a login, paste credentials, call token endpoints or change access settings as part of an audit.

Map webhook subscription scope, verification challenge, authentic-delivery verification, acknowledgement and downstream processing. A challenge response proves endpoint ownership/reachability only, not that signed production events or app subscriptions work. Confirm which requirements apply from current path-specific documentation. Keep sandbox evidence distinct from live delivery and verify duplicate handling through a separate authorized test plan.

## Prepare a reviewer-ready handoff

Use [assets/readiness-report.md](assets/readiness-report.md). Connect each requested permission to a real product screen and a reviewer-visible success path. Specify accessible test account provisioning, stable URLs, exact clicks, expected visible result, screencast coverage, data handling and deletion/revocation evidence. Put real reviewer credentials only in the provider's designated private process, never in a public report or marketplace example.

Rank blockers by dependency: an inaccessible login blocks the screencast walkthrough; unverified business or access status remains a provider gate. Do not fabricate processor lists, privacy practices or compliance answers. Route missing operational facts to the owner.

See the [fictional example](references/worked-example.md). End with a technical-readiness verdict, review-submission readiness, provider approval status, owners and the next acceptance step. Proposed changes are proposals. Submission, permission edits, real messaging and production acceptance require separate authorization; never promise approval or infer it from a local audit.
