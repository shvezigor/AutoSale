# AI task economics — cost-2

**Exact total cost per success is unavailable. With zero confirmed successes, the current cost-per-success measure is undefined.** One unpriced attempt, an unconverted EUR tool charge and two unresolved outcomes also prevent a complete, final unit-cost result. The missing call cannot be counted as free, and next month's savings percentage cannot be calculated from these aggregates.

## Boundary and evidence

The supplied fictional cohort has 10 canonical tasks and zero confirmed successes, including two unresolved outcomes. Business success criteria, window/timezone, workspace, test exclusions and model/version are unspecified. The two unresolved tasks must remain unresolved; the other eight tasks are not confirmed successes, but no more specific outcome labels were supplied. No count of total attempts or count of priced attempts is supplied. A task and an attempt are distinct units.

| Source | Supplied input | Coverage or uncertainty |
|---|---|---|
| Fictional task aggregates; date unspecified | 10 tasks; 0 confirmed successes; 2 unresolved outcomes | Current confirmed-success rate is measurable; final success rate is not established. |
| Supplied known attempt-cost aggregate | 3 USD | A known subtotal, not a complete inference total; detailed attempt linkage and cost classification are missing. |
| Supplied gap | One attempt unpriced | Unknown charge, not zero-priced. Total attempt count and numeric pricing-coverage percentage are unknown. |
| Supplied tool charge | 2 EUR | Keep separate from USD; no authorized dated FX source supplied. |
| Historical token-category description | Input excludes cache reads; a separate cache counter exists | Do not subtract cached reads from historical input. Numeric token counts and compatible dated tariffs are not supplied here. |
| Invoice/provider rates | Not supplied | No invoice reconciliation or independently priced token estimate is possible. |

## What is computable

- Current confirmed success rate = 0 / 10 = **0%**. This describes currently confirmed outcomes, not a final failure rate.
- Unresolved outcome fraction = 2 / 10 = **20%**.
- Known cost subtotal, reported by currency = **3 USD in attempt charges and 2 EUR in tool charges**. These are separate amounts, not a sum in a common currency.
- Current cost per confirmed success = included cohort cost / 0 = **undefined; no confirmed successful outcomes**. Do not report zero, an exact finite value, or a savings percentage.

Assuming costs are nonnegative and no adjustments apply, the known amounts are partial accumulated cost floors within their respective currencies. This is not a directional bound on final cost per success: the numerator is incomplete and the final success denominator is unresolved. The unknown attempt charge must be labeled unpriced; the EUR charge is known in EUR but unconverted. Neither is free.

## Cache treatment and future reproducible formula

For the historical schema, input already excludes cache reads. If its categories and actual billing contract are confirmed, use:

`inference cost = (reported uncached input × uncached input rate + separate cached input × cached rate + output × output rate) / rate unit`

Do not calculate `reported input − cached input` for this schema. Numeric usage, rate units, currency, model/version and effective dates are required before evaluating the formula. Verify any reasoning-token or other billing categories against that contract before adding them; avoid double counting costs already included in the known 3 USD.

Once all charges and outcomes are resolved within a common declared cohort and cost boundary:

`included cost = all priced attempt costs, including failures and retries + included tools/retrieval/infrastructure/human review`

`cost per success = included cost / unique confirmed successful tasks`, only when the denominator is positive. If it remains zero after outcome resolution, report undefined again.

## Coverage and reconciliation

Known task count is 10; total attempt count, priced-attempt count and percentage pricing coverage cannot be recovered from the supplied data. At least one attempt is unpriced. Additional cost categories are not established as complete. Outcome coverage explicitly includes two unresolved cases. No matching invoice was supplied, so reconciliation difference is **unknown**, not zero.

The analysis owner should request the smallest redacted supplement:

1. The success definition, cohort/window/timezone and resolved labels for the two unresolved tasks; canonical task/attempt IDs and timestamps to prevent duplicate counting and cross-cohort attribution.
2. Total attempt inventory and usage/cost breakdown showing exactly what the 3 USD includes, plus the unpriced attempt's model/version, usage categories and dated applicable tariff or actual invoice charge. No API keys or account access are needed.
3. The 2 EUR tool receipt's date and scope. If a combined currency result is needed, an agreed reporting currency and authorized dated FX rate/source; otherwise retain separate totals.
4. The precise historical input/cache schema and numeric counters, dated rate units and billing treatment, declared inclusion of infrastructure and human review, and matching invoice scope with credits/taxes/discounts separated.

## Savings request

Next month's savings percentage is **not computable**. There is no candidate change, comparable future workload, valid positive-success baseline, complete cost boundary or measured quality/latency outcome. No rates or FX values should be fabricated.

A future experiment needs an owner, comparable task mix, fixed success contract, resolved outcomes, complete costs in agreed currencies, numerical quality/latency floors and a rollback condition. Measure baseline and candidate cost per success with uncertainty before calculating `(baseline − candidate) / baseline × 100%` for a valid positive baseline. Label forecasts as estimates and account for overlapping savings levers. No optimization, billing change, external call or data collection has been executed by this analysis.
