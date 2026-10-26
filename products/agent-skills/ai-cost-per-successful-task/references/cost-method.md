# Cost method

For provider usage where input includes cache reads:

uncached_input = input_tokens - cached_input_tokens

attempt_cost = (uncached_input * input_rate + cached_input_tokens * cached_rate + output_tokens * output_rate) / rate_unit

Only use this formula when the provider's categories are mutually accounted for as described. If input excludes cached reads, use the separate reported categories without subtraction. Confirm whether reasoning tokens are already part of billed output before adding them. Rate_unit is supplied, for example 1,000,000; currency and effective dates belong to every rate.

cohort_cost = sum(all included priced attempts) + explicitly included other costs

cost_per_success = cohort_cost / unique confirmed successful tasks

success_rate = unique successful tasks / unique attempted tasks

Coverage must show missing attempts/outcomes and unpriced usage. An unpriced call cannot be treated as free. When all costs are nonnegative, known costs / confirmed successes can be a cost lower bound only when the success denominator is complete for the specified cohort. If the denominator is incomplete too, do not assert a directional bound without justification.

Compare tariff estimates with invoice actuals in the same provider/project/currency/period. Keep credits/tax/discount treatment explicit and distinguish cash payable from gross resource cost. Use decimal monetary arithmetic, exact integer sums and documented rounding. No provider prices are bundled; verify current official pricing or use supplied dated rates.

For an optimization experiment: same task cohort/mix, success labels, sample sizes, baseline/candidate all-in cost, latency and quality threshold, measured difference, uncertainty and rollback condition. Test data validates arithmetic; it cannot establish commercial savings or live instrumentation.
