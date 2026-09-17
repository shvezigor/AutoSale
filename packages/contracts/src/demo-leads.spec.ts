import { describe, expect, it } from 'vitest';

import { demoLeadInputSchema } from './demo-leads.js';

const valid = { name: 'Олена', company: 'Shop', email: 'owner@example.com', phone: '', orderVolume: '50_TO_300', note: '', locale: 'uk', privacyConsent: true } as const;

describe('demoLeadInputSchema', () => {
  it('accepts a localized request with one contact method', () => { expect(demoLeadInputSchema.parse(valid).email).toBe(valid.email); });
  it('requires an email or phone', () => { expect(demoLeadInputSchema.safeParse({ ...valid, email: '', phone: '' }).success).toBe(false); });
  it('requires explicit privacy consent', () => { expect(demoLeadInputSchema.safeParse({ ...valid, privacyConsent: false }).success).toBe(false); });
});
