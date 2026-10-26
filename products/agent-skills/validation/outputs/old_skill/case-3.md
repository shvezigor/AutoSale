Decision: establish a baseline before choosing an onboarding fix. There are no proven causes or defensible conversion-uplift estimates in the supplied evidence.

Evidence window/segment: none supplied; eligible segment, observation window and successful onboarding event are undefined.

Three hypotheses to investigate, without ranking them as proven causes:
1. Required fields or instructions are unclear: inspect the existing flow and test whether fictional users can recover from validation errors.
2. The sequence or next action is confusing: conduct a small consented walkthrough using fictional data and ask participants to explain their next step.
3. Integration or save failures block completion: inspect existing sanitized error summaries and domain state, if available, and reproduce failures with fictional data.

Ranked actions: first define eligibility and completion; next run the manual checks above; then prioritize the smallest fix supported by observed frequency and severity. Do not install tools or enable recording.

Privacy limitations: no recordings or personal data are necessary for these initial checks. Use fictional data and sanitized existing evidence.

Instrumentation gaps: entrant and completion counts, step outcomes, validation categories and failure/retry outcomes. These are measurement needs, not authorization to add tracking.

Validation metric: unique eligible entrants completing onboarding within a predefined window, measured in a fully observed cohort. Establish the baseline and uncertainty first, then evaluate a selected change with comparable cohorts or a controlled experiment. The amount of conversion improvement is unknown.
