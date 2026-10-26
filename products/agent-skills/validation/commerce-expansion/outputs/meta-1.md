# Instagram integration readiness: meta-1

Audit date: 2026-10-26. Fictional supplied-evidence audit only. No browser, network, provider calls, settings changes or credentials accessed.

Evidence M1: Instagram Login; API version absent; a role tester connects. M2: dashboard Ready for testing and reviewer instructions 100%; business verification pending. M3: configured callback host preview.example.invalid differs from deployed app host app.example.invalid. M4: webhook challenge succeeds, no signed-event test. M5: screencast starts after login and reviewer credentials have not been tried. Official documentation is unavailable in this exercise. These example hosts are evidence labels, not verified reachable URLs.

Technical readiness: partial/blocked for external-client acceptance. The callback/deployment discrepancy must be resolved or explained and tested; it does not identify a proven OAuth failure stage. Submission readiness: incomplete. Provider approval/external access: unverified; dashboard indicators and role tester success are insufficient. We cannot conclude the integration is ready for external clients.

| Action or gate | Path-specific requirement | Evidence | Status | Owner and next check |
|---|---|---|---|---|
| Identify integration | Instagram Login, exact API version, app type/use case, professional account eligibility, app mode and target actors | M1 only establishes Login path and role tester | Unknown beyond supplied path | Integration owner: provide redacted path/version, account and mode/access evidence. |
| Connect a role tester | Applicable actor/role acceptance and OAuth completion | M1 tester connects | Supported for that actor only | QA: retain scoped evidence; do not extrapolate to external actors. |
| Connect an external non-role client | Exact endpoint/capability, permissions, access levels and account eligibility must match verified current path/version documentation | No external actor evidence, exact action scope or official docs | Unknown | Owner: supply product actions and official requirements before naming permissions. |
| Callback routing | Exact authorization redirect, configured URI and deployed callback must be coherent and reachable | M3 host discrepancy | Blocked pending resolution/verification | Engineering: compare redacted full paths/schemes and deployment routing; propose alignment or explain intentional routing, then test when authorized. |
| Business/access/review gates | Applicable business verification and permission approval require path-specific verification | M2 pending business verification; badges do not establish approval | Unknown eligibility; pending verification is open | App owner: verify applicability and actual permission/access decisions. |
| Webhook challenge | Challenge succeeds at the tested endpoint | M4 | Supported for challenge only | Engineering: identify endpoint/environment. |
| Authentic events and downstream effects | Applicable subscription, authenticity/signature checks, acknowledgement and processing | No signed-event evidence | Unknown | Engineering/QA: authorized isolated event acceptance plan. |
| Reviewer walkthrough | Accessible reviewer actor, stable URLs, full login and visible permission-linked actions | M5 untried credentials, login omitted | Blocked/incomplete | Review owner: private provisioning, authorized rehearsal and replacement screencast. |
| Token/storage/revocation/deletion | Path-specific lifecycle and actual documented data practices | No evidence | Unknown | Engineering/privacy owner: supply redacted lifecycle and actual retention/deletion behavior. |

No exact permission or endpoint can responsibly be filled in: product actions and version-specific official requirements are missing. Instagram Login is the relevant path; do not import Facebook Login permissions or require a Facebook Page by assumption.

## Blocking dependency order

1. Integration owner establishes exact path/version, intended product actions, actors, account type, app mode and applicable official requirements. Official-doc verification remains open; this audit cannot supply it.
2. Engineering resolves or explains the callback/deployed-app discrepancy and verifies complete OAuth in the intended environment. Prior tester success may belong to another environment and does not settle the discrepancy.
3. Review owner privately provisions and actually rehearses the reviewer actor through the reachable login path. Untested credentials block a credible walkthrough; no credentials belong in this report.
4. Engineering/QA proves each requested action and relevant signed-event/downstream path, including token lifecycle and revocation/deletion. Produce the full screencast after this works.
5. App owner confirms separate business-verification, mode/access and permission-review gates for external users. Resolve applicable pending gates and capture provider decisions. This can progress alongside engineering; local success cannot replace it.
6. An explicitly authorized non-role test actor completes external-client acceptance once eligibility/access permits it. Record evidence before declaring readiness.

## Reviewer walkthrough

Proposed, not executed: the owner supplies a stable full app starting URL and privately provisions the reviewer account through the provider-designated process. The supplied app.example.invalid host is not proof of a working URL.

1. Start signed out at that URL; show the integration screen and click its actual connect control. Its label is not supplied and must be recorded from the UI.
2. Capture the full Instagram Login redirect and consent flow for the reviewer actor. Show permissions corresponding to the requested product scope, without secrets.
3. Return through the intended callback and show the connected account. Retain redacted state/code-stage evidence without exposing codes or tokens.
4. For each needed permission, record actual product screen, exact clicks, API capability and expected/observed visible result. The owner must supply the feature actions before this exact script can be completed. Use test actors; real messaging/provider side effects need separate authorization.
5. If webhooks are relevant, show an authorized isolated signed event received, acknowledged and reflected downstream; separately test invalid authenticity, retries and duplicates with a bounded plan.
6. Show persisted connection after reload where supported and actual disconnect/revoke/delete behavior, with expected outcomes grounded in the product contract and official path-specific docs.

Replace the partial screencast with end-to-end coverage including login. Independently rehearse private reviewer access before submission. Test-actor success still does not prove non-role eligibility.

## Data-handling questions for owner

Supply actual data categories/purposes, storage boundaries, processors, retention, credential protection and revoke/delete behavior, plus matching published policies. Identify the operational and reviewer-support owners; do not invent compliance answers.

## Proposed acceptance versus observed results

Observed only from supplied text: tester connection, dashboard indicators, pending verification, host discrepancy, challenge success, missing signed test and incomplete reviewer evidence. Full OAuth trace, official-doc verification, reviewer/browser rehearsal, signed-event processing, non-role acceptance and provider approval remain unverified.

Next acceptance step: integration/app owner supplies redacted path/version and callback evidence; engineering resolves the routing question, then arranges an authorized reviewer login rehearsal. Submission, settings edits, real messages and production acceptance require separate authorization. No approval outcome or date is promised.
