# Fictional onboarding: decision

Improve required-field error recovery as a small, targeted UX change, then measure its effect. The evidence supports an error-message problem in a selected sample; it does not establish the main cause of population non-completion.

## Scope and evidence

Product engineering owns the decision; the actor is an onboarding session. E1 is the supplied aggregate for a mature seven-day entry cohort, with 24-hour save follow-up. Calendar dates, timezone, eligibility definition and device mix are unspecified. Success is a saved session within 24 hours of entry; the counting unit is unique eligible sessions. E2 is five sanitized replay notes selected for errors, aliased S1–S5. Relative timestamps are unavailable. No additional recordings, collection or external actions are authorized or performed.

## Funnel

| Milestone | Count | Unit / denominator | Rate | Caveat |
|---|---:|---|---|---|
| Entry | 100 | Unique eligible sessions | — | E1, mature seven-day cohort |
| Submit | 140 | Events including retries | — | Not a session denominator; unique submitters unknown |
| Save within 24h | 60 | Same 100 entry sessions | 60% | E1 |
| No observed save within 24h | 40 | Same 100 entry sessions | 40% | Observed non-completion, not permanent abandonment |

Do not divide saves by 140 submits to estimate session conversion. Intermediate step counts and attempt-level recovery are unknown.

## Findings

1. **Generic required-field errors: validation/interface friction.** E2 S1–S3 show generic required-field errors; timestamps unavailable. Affected sample count is 3/5 error-selected replay sessions, not a 60% population error rate. Severity: moderate, provisionally, because correction may be harder; actual delay and completion consequence are unmeasured. Confidence is high in the repeated supplied symptom, medium in the proposed usability benefit and low in conversion attribution. Missing-field inputs may reflect confusing requirements, unfamiliarity or other off-screen context. Smallest action: give safe, specific inline required-field messages, focus the first invalid control, preserve entered values, and clear only the edited field's error.

2. **Outcome unknown after submit: unresolved.** E2 S4 ends after submit; timestamp unavailable. This affects 1/5 selected replays. Severity is unknown; confidence is high that the notes do not establish an outcome. Capture termination, a delayed response or later completion are alternatives to abandonment. Reconcile existing authorized save/audit evidence if available before diagnosing failure.

3. **Provider timeout followed by success: provider failure with recovery.** E2 S5, 1/5 selected replays, timestamp unavailable. Transient friction is supported; permanent failure is not. Severity: low to moderate for this recovered occurrence; confidence medium from the note. Network or provider instability could explain it; retry timing and duplicate-save behavior are unknown. Preserve recovery and inspect safe aggregate timeout/retry counts before prioritizing provider work.

## Validation plan

| Action | Owner | Metric and baseline | Proposed window | Guardrail / stop rule |
|---|---|---|---|---|
| Validate inline recovery in an authorized fictional test | Engineering + UX | Corrected submissions / sessions with required-field errors; baseline unmeasured | Before release; cover missing fields, focus, retained values and successful save/reload | Stop if values disappear, messages expose values, or saves duplicate |
| Measure completion | Product analytics | Unique eligible entrants saving within 24h / unique eligible entrants; baseline 60/100 = 60% | Two fully matured seven-day cohorts as a starting point; extend for adequate precision | Comparable eligibility, window and instrumentation; no increase in failed or duplicate saves |
| Measure validation recovery | Engineering + analytics | Unique sessions saving after required-field error within 24h / eligible sessions encountering that error; baseline unmeasured | Establish baseline first, then comparable mature cohorts | Safe error categories only; no form values; stop on persistence failure |

A controlled rollout with adequate sample size is needed to attribute a conversion change to the UI fix. No numeric uplift is justified. Any proposed new telemetry requires authorization, masking, access, retention and deletion owners before collection. Existing dates, event linkage, duplicates, ingestion completeness and comparable traffic should be checked before comparisons.

## Limits and next decision

No timestamps, device split, representative success sample or validation-recovery baseline is available. The selected replay sample cannot explain all 40 non-completing sessions. Next decision: ship the narrowly validated error-recovery improvement if it passes usability/persistence checks, then use comparable cohort evidence to decide whether to broaden investigation. This report contains only fictional aggregate data and neutral aliases.
