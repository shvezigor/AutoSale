import { describe, expect, it } from 'vitest';
import { annualPrice, pricingPlans } from './pricing';
describe('pricing registry', () => {
  it('keeps the approved monthly prices', () => { expect(pricingPlans.map((plan) => plan.monthlyUah)).toEqual([599, 1999, 2999]); });
  it('applies the approved 20 percent annual discount', () => { expect(annualPrice(599)).toBe(5750); });
});
