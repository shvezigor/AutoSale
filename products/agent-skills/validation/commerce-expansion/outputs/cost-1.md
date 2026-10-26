# AI task economics — cost-1

This supplied fictional cohort has inference cost of **3.80 USD** and included cost of **9.00 USD**, or **0.0475 USD** and **0.1125 USD per confirmed successful task**, respectively. Infrastructure is missing, so 9.00 USD is an included-cost subtotal, not complete all-in cost. No savings result is established.

## Boundary and evidence

The supplied complete same-cohort ledger covers 100 canonical business tasks, 140 attempts including failed work and retries, and 80 confirmed successful tasks. One confirmed success is counted per task; attempts do not create additional successes. The underlying business success criteria, window, timezone, model/version, workspace and test-traffic exclusions were not supplied. These results adopt the exercise's confirmed-success labels and same-cohort assertion, rather than claiming independently verified production outcomes.

| Source | Supplied input | Treatment and coverage |
|---|---|---|
| Fictional complete cohort ledger; date unspecified | 100 tasks; 140 attempts; 80 confirmed successes | All supplied attempts remain in cost, including failures. Remaining 20 tasks are not confirmed successes; no separate unresolved count is supplied. |
| Same ledger | Inclusive input 1,400,000 tokens; cached subset 400,000; output 200,000 | Cache is included in input and must be subtracted once to find uncached input. Counts are nonnegative integers; cached input does not exceed inclusive input. |
| Fictional supplied tariffs; effective date unspecified | USD per 1,000,000 tokens: uncached input 2; cached input 0.50; output 8 | Exercise assumptions only; no current provider-price assertion. |
| Supplied additional cohort costs | Tools 1.20 USD; human review 4.00 USD | Included once. Infrastructure was not supplied and is not assigned zero. |
| Matching supplied invoice | 3.90 USD before taxes/credits | Compare against inference tariff estimate; scope is accepted as matching for this exercise. |

## Reproducible calculation

Use exact integer token counts and decimal monetary arithmetic; retain precision through division.

- Uncached input = 1,400,000 − 400,000 = 1,000,000 tokens.
- Uncached input cost = 1,000,000 × 2 / 1,000,000 = 2.00 USD.
- Cached input cost = 400,000 × 0.50 / 1,000,000 = 0.20 USD.
- Output cost = 200,000 × 8 / 1,000,000 = 1.60 USD.
- Inference cost = 2.00 + 0.20 + 1.60 = **3.80 USD**.
- Included cost = 3.80 + 1.20 + 4.00 = **9.00 USD**.
- Inference cost per success = 3.80 / 80 = **0.0475 USD**.
- Included cost per success = 9.00 / 80 = **0.1125 USD**.
- Confirmed success rate = 80 / 100 = **80%**.
- Attempts per canonical task = 140 / 100 = **1.4**.

Monetary totals are shown to cents; unit costs retain four decimal places. Rounding unit costs to cents would conceal useful precision. The 40 attempts above one per task are not all independently classified as waste: retry/fallback details are not supplied.

## Coverage and interpretation

For the exercise, usage aggregates cover all 140 attempts and all supplied token categories are priced: 140/140 attempt coverage, 100%. Individual attempt rows are not available for independent linkage or duplicate verification. The confirmed-success denominator is 80 of the complete 100-task cohort; the remaining outcome categories cannot be separately reported. Known additional costs include tools and review; infrastructure remains a gap. Therefore there is no defensible complete all-in cost or all-in savings claim.

## Invoice reconciliation

Invoice minus modeled inference = 3.90 − 3.80 = **+0.10 USD**, unresolved. The invoice is higher. Do not substitute the 9.00 USD subtotal into this inference reconciliation because it also contains tools and review. No unsupported balancing adjustment is added.

The billing/finance owner should reconcile the 0.10 USD against invoice line categories, billing rounding, scope/time boundaries and any discounts or other billed categories. Taxes and credits are excluded from the supplied invoice value; discount treatment and the precise invoice line breakdown are not supplied. The tariff model remains 3.80 USD pending explanation, and the invoice remains the supplied 3.90 USD observed amount.

## Next measurement and optional experiment

Next, have the analysis owner obtain a redacted invoice breakdown, rate effective interval and infrastructure allocation for exactly this cohort, together with the business success contract and window/timezone. No account credentials or customer message bodies are needed.

An optional future retry-reduction experiment would compare the same task mix and success definition against this baseline, while retaining all failed attempts and human-review cost. Its owner must first set numerical quality and latency floors and a rollback threshold; none were supplied. Record confirmed outcomes, attempts and complete included costs for both cohorts and uncertainty around the comparison. This is a proposed measurement, not an executed optimization or forecast of savings.
