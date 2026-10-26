# Fictional SaaS onboarding: decision

There is insufficient evidence to name three proven causes or estimate a numeric conversion improvement. The only source, E1, is the report that onboarding feels bad; it is a useful concern, not observed causal evidence. No recordings, analytics, counts or success definition are supplied. Do not install tools or enable recording.

## Scope and funnel

Assumption: the decision is how to improve a new customer's onboarding. Product owns the decision, supported by UX and engineering. The intended actor, eligibility, onboarding task, dates, timezone, segments and completion window remain unspecified. Establish the meaningful observable success event before calculating a funnel.

| Milestone | Count | Unit / denominator | Rate |
|---|---|---|---|
| Eligible entry | Unknown | Proposed unique eligible sessions | Unmeasured |
| Key action / validation response | Unknown | Same linked session cohort | Unmeasured |
| Persisted setup | Unknown | Same linked session cohort | Unmeasured |
| Visible useful outcome | Unknown | Same linked session cohort | Unmeasured |

## Three investigation hypotheses, not findings or ranked causes

1. **Unclear next step or value.** Classification: possible product misunderstanding/interface friction. E1 provides no sequence or timestamps; affected count and denominator are unknown. Severity and causal confidence are unassessed. Alternative: users understand the flow but lack required information. Check task comprehension using an authorized fictional walkthrough and sanitized notes.
2. **Hard-to-correct validation.** Classification: possible validation issue. No error observation exists; count, timestamps, severity and baseline are unknown; confidence in its presence is low. Alternative: a permission or provider failure may resemble invalid input. Check required inputs, safe messages, focus, preserved values and recovery in a fictional walkthrough.
3. **Failure or uncertainty after submission.** Classification: possible application/provider/display failure. No observed failed transition exists; affected count, timestamps and severity are unknown; confidence in its presence is low. Alternative: completion may be successful but poorly signposted or delayed. Check authorized fictional success, saved state after reload and visible downstream outcome; distinguish persistence from visibility.

These are starting questions, not a claim that these problems exist or are the top causes. There is no evidence-based corrective patch to prioritize yet.

## Minimal collection and validation plan

First request a sanitized description of the intended task, steps and observable success, plus any already-authorized aggregate counts or safe notes that become available. Use an authorized fictional walkthrough rather than requiring a recording collector. Keep relative timestamps or step order in notes; mark unobserved outcomes unknown. If real-session evidence is later authorized, use the smallest useful sample spanning success and non-completion within comparable segments; do not treat error-selected sessions as representative.

| Action | Owner | Metric / baseline | Proposed window | Guardrail / stopping condition |
|---|---|---|---|---|
| Define funnel and review a fictional task walkthrough | Product + UX + engineering | Observable completion and friction sequences; baseline absent | One scoped review before choosing a fix | No production personal data or external provider effects; stop and sanitize any exposed secret |
| Establish aggregate baseline, if collection is separately authorized | Analytics + privacy/data owner | Unique eligible entrant sessions completing declared success within declared window / unique eligible entrant sessions; unmeasured | Proposed seven-day entry cohort, then wait for every entrant's completion window; extend if sparse | Fixed safe events/categories, no form text or identifying URLs; document authorization, access, retention and deletion owners first |
| Validate a subsequently supported improvement | Engineering + UX + analytics | Same completion numerator/denominator; baseline must first be measured; include targeted recovery metric | Comparable mature cohorts or adequately powered controlled comparison | Check validation, saved state/reload and downstream result; stop on persistence loss, duplicate saves or new blocking errors |

Proposed telemetry is a plan only, not implemented: flow started, step reached, safe-category validation failure, save confirmed and task completed, with explicit emission boundaries and cohort linkage. No tracking, masking changes or tool installation has occurred.

## Limits and next decision

Conversion baseline, failure prevalence and expected uplift are unmeasured. A numeric improvement would be invented; even future replay evidence alone cannot establish causal uplift. The next decision is what evidence supports the first narrowly scoped fix after defining success and observing the flow. This report contains no identifying data.
