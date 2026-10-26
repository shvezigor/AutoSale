# PRD: reuse a saved CSV column mapping

The owner has chosen to extend existing CSV import so an eligible seller can reuse a saved mapping, explicitly approve a valid import and see the imported catalogue. This PRD preserves that decision. No provider change, implementation or telemetry activation is authorized. Repository boundaries and feasibility are provisional because repository access is unavailable.

## Scope and flow

Reuse the current CSV import: select a file, map required columns, validate, preview, explicitly approve, save and display the imported catalogue. Save the approved mapping for later reuse within the authorized account/workspace; after reload show it and revalidate it against the next file. A saved mapping never implies approval for another import.

Required-column names and existing access rules must come from the current import contract, not new invented schema. Out of scope: provider integrations, live sync, automatic approval and a replacement import service.

Proposed persistence rule for owner confirmation: a successfully approved import saves its mapping; invalid, cancelled or failed approval does not replace the previous saved mapping. If saving the mapping fails, report that failure accurately and preserve the entered mapping for recovery; do not imply the entire operation succeeded. Existing catalogue write authority and retry semantics must be verified before implementation.

## Acceptance criteria

| Trigger/precondition | Observable result | Failure/recovery check |
|---|---|---|
| Submit with a required destination column unmapped or mapped to an absent source column | A localized error appears beside each invalid mapping; controls expose aria-invalid and aria-describedby; focus moves to the first invalid control | Preserve the file and other mappings; editing one field clears only that field's error; do not persist catalogue changes |
| Correct mappings pass validation | Preview makes the resulting catalogue changes reviewable and offers explicit approval | Validation alone never imports data; cancelling leaves the catalogue unchanged |
| Authorized seller explicitly approves a valid preview | Persist the approved catalogue and approved mapping under the authorized account/workspace; show a clear completion state | Pending state prevents repeated submission; retry or double-click must not create duplicate products or duplicate application of the import |
| Reload after confirmed success, then return to import | Saved mapping is present and available for reuse | Revalidate against a changed file; missing source columns produce the same field errors rather than silent substitution |
| Navigate to the catalogue after success, then reload | Approved imported products are visibly present with the expected approved values | Do not show success based only on a request being sent; verify durable results and absence of unintended overwrites |
| Approval is forbidden, state conflicts, or an unknown server failure occurs | Show a safe form-level message without raw API details or credentials | Preserve entered mappings where safe; provide retry after the underlying issue is resolved; do not claim success or overwrite conflicting saved state |
| A different account/workspace attempts to load the mapping | Existing access rules prevent unauthorized disclosure or use | Verify isolation with fictional accounts; exact role/ownership rules require confirmation |

Required verification, not yet performed: automated validation/persistence/retry/access tests and complete browser acceptance in the intended environment with fictional data, including invalid submission, correction, preview, explicit approval, saved mapping after reload, catalogue visibility after reload and recovery from failed saves. Capture final browser evidence when implemented. No tests are claimed passed.

## Baseline and rollout measurement

The supplied fully observed baseline cohort has 50 unique eligible sessions starting import and 35 of those completing within 24 hours: 35 / 50 = 70%. The 120 submit events include retries and are neither the eligible-session denominator nor additional completions.

Confirm that the supplied completion definition means an explicitly approved, persisted catalogue visible within 24 hours. If it differs, retain 70% as the supplied completion baseline and establish a comparable baseline for the stricter outcome before judging rollout.

For a later authorized rollout:

- Primary unit/cohort: unique eligible import sessions entered at import start, with a stable session identity across retries. Define eligibility consistently with baseline; exclude internal tests consistently and include failures. Cohort membership is fixed at entry.
- Primary rate: eligible entry sessions reaching approved, persisted, visible catalogue completion within 24 hours / all eligible entry sessions starting import. Deduplicate repeated submits and completions by session. Wait 24 hours after the final enrolled session before reporting the complete cohort.
- Feature diagnostic: among eligible sessions with a prior compatible saved mapping available at entry, report mapping reuse and the same completion outcome separately. Do not compare that selected subset directly with all 50 baseline sessions as if populations were equivalent.
- Baseline: supplied 70%, subject to completion-definition comparability above. Proposed launch gate: all acceptance checks pass and no unauthorized writes, cross-account exposure or duplicate application is observed. This is a proposed gate, not measured performance.
- Business threshold: the owner must predefine a minimum useful improvement, tolerated regression and support/cost limits before rollout. The supplied cohort does not determine those values or a suitable sample size; no uplift promise is made.
- Proposed observation plan: two-week intake with full 24-hour follow-up, extended if eligible volume is too sparse for the agreed decision. Appoint a rollout/measurement owner before execution; the product owner owns the expansion decision. A powered sample plan depends on the chosen meaningful effect and uncertainty tolerance.
- Guardrails: catalogue correctness, duplicate application, unauthorized changes, data isolation, save failures and support burden. Stop expansion on a correctness or access failure; disable mapping reuse and return users to the existing reviewed CSV path while preserving already approved catalogue data. Confirm rollback controls before exposure.

After authorized verification, start with a bounded eligible cohort agreed by the owner, inspect matured outcomes and guardrails, then expand only against the predeclared gates. A small before/after change is descriptive evidence, not causal proof; use an adequately designed concurrent comparison if causal uplift is needed. Measurement and rollout remain plans until separately authorized.

## Open decisions

The product owner must confirm required columns, mapping ownership and save timing, compatible-file rules and acceptable catalogue update behavior with the existing import owner. The engineering owner must verify durable-write/retry boundaries and rollback controls. The measurement owner must confirm baseline event definitions, cohort eligibility and decision thresholds. These dependencies constrain readiness; they do not reopen the chosen saved-mapping direction.
