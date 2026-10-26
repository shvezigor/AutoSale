# Evidence and counting method

## Fix the unit before the calculation

Record event semantics, window, segment, timezone, inclusion criteria and success definition. Check duplicates, missing events, retries, ordering, delayed ingestion and capture gaps. Deduplicate using available event identity and the declared unit; do not assume every repeated event is a duplicate. A second genuine attempt may be valid.

Count completion as unique eligible units with observed success / unique eligible entrants in the same cohort, within a stated completion window. Distinguish entry-cohort completion from calendar-period event totals. If entrants have not had their full completion window, report incomplete follow-up. If units cannot be linked reliably, report event counts instead of a conversion rate.

For steps A → B, a step drop-off rate is (eligible A units without observed B within the declared window) / eligible A units. Call this observed non-completion, not proven abandonment. A screenshot or truncated recording alone cannot establish that window.

Example: 100 eligible sessions enter; 70 save successfully; 90 submit events include retries. Completion is 70/100 = 70%, provided success and entry refer to the same eligible session cohort. Dividing 70 by 90 answers a different question and may mix event and session units.

## Sampling and attribution

A sample selected for errors can show what an error looks like. It cannot estimate how common that error is among all users. State the sample-selection rule, sample size and missing segments. Avoid generalizing from small samples or identifying people in rare segment combinations.

A provider error and a confusing error message can coexist. Separate the external failure from the interface's recovery behavior. Verify persistence after reload through supplied evidence or an authorized test before claiming data loss. Distinguish actual deletion from invisible, delayed or unsaved state.

When telemetry and recording disagree, list both sources, possible capture or timing differences and the reconciliation needed. Do not silently choose the source that supports a preferred story. A correlation across segments does not establish causality; device, role, integration status and traffic source can confound comparisons.

## Minimal event plan

Prefer fixed event names and allow-listed non-identifying properties: flow started, step reached, validation failed with a safe category, retry requested, save confirmed and task completed. Define each event's emission boundary and unit. Avoid free text, full URLs, message bodies, form values, credentials and persistent cross-site identifiers.

Describe proposed instrumentation separately from implementation. Name access, retention and deletion owners. Do not install a replay collector or enable collection as part of an analysis-only request.
