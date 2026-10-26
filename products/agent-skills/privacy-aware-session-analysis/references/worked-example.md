# Worked example: fictional catalogue import

All data below is fictional. No customer or production data is included.

## Input

Decision: prioritize the next improvement to a catalogue-import wizard.

Aggregate E1: over a fully observed seven-day entry cohort, 120 unique eligible sessions start an import; 84 reach preview; 60 receive a successful-save confirmation within 24 hours of entry. Counts are deduplicated by session. There are 150 submit events including genuine retries. No device breakdown is available.

Replay notes E2: six sessions selected because they show mapping errors. In S1, S2, S3 and S4, the user submits an unmapped required column, sees only a generic banner and searches the form. In S5 the recording ends immediately after submit. In S6 a provider timeout appears and a retry succeeds. No recording contains identifying values.

## Example analysis

Recommendation: improve required-column error recovery, then measure it across all eligible mapping attempts. Confidence is medium that this is useful local UX work; its contribution to total non-completion is unknown.

E1 establishes start-to-preview 84/120 = 70%, start-to-save 60/120 = 50%, and preview-to-save 60/84 ≈ 71.4%, assuming the saved sessions belong to the preview cohort as specified. The 150 submit events are not a session denominator. Start-to-save observed non-completion is 60/120 = 50% within 24 hours, not proof that 60 people abandoned permanently.

The generic mapping-error banner is observed in 4/6 selected replays (E2, S1–S4). This is not a 66.7% population error rate: all six were selected for mapping errors. The notes have no timestamps, so exact timestamps are unavailable. The observation is supported, but its causal effect on completion is unproven. Alternative explanations include unfamiliar import formats or additional off-screen help.

S5 has an unknown outcome. S6 shows a provider failure with successful recovery, not permanent application failure. There is no evidence of data loss, device-specific differences or user intent after the recordings end.

Smallest action: place a safe error message beside each missing required mapping and focus the first invalid control while preserving mappings. Product engineering owns the change; UX reviews clarity.

Proposed validation: compare successful-save sessions / eligible mapping-start sessions within the same 24-hour window before and after release, segmenting only where sample size permits. Measure recovery within a session after a mapping-validation error. Baseline for recovery is unmeasured; collect it before assessing improvement. Observe two complete seven-day entry cohorts as a proposed starting window, extending if volume is insufficient. Guardrails: preserved mappings, no increase in duplicate imports or provider retries, and no form values in telemetry. Stop and investigate on data-loss evidence. A controlled rollout is needed for a stronger causal claim.
