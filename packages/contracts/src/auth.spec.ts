import { describe, expect, it } from 'vitest';

import { acceptInvitationRequestSchema, adminTenantSummarySchema, inviteMemberRequestSchema, loginRequestSchema, registerRequestSchema } from './auth.js';

describe('authentication contracts', () => {
  it('accepts a valid owner registration', () => {
    expect(registerRequestSchema.safeParse({
      email: 'owner@example.com',
      password: 'correct horse battery',
      name: 'Owner',
      tenantName: 'Store',
    }).success).toBe(true);
  });

  it('normalizes email and rejects short passwords', () => {
    expect(loginRequestSchema.parse({
      email: ' Owner@Example.COM ',
      password: 'correct horse battery',
    }).email).toBe('owner@example.com');
    expect(loginRequestSchema.safeParse({
      email: 'owner@example.com',
      password: 'too-short',
    }).success).toBe(false);
  });

  it('validates team and privacy-safe admin payloads', () => {
    expect(inviteMemberRequestSchema.parse({ email: ' Manager@Example.com ' }).email).toBe('manager@example.com');
    expect(acceptInvitationRequestSchema.safeParse({ token: 'x'.repeat(20), name: 'Manager', password: 'long secure password' }).success).toBe(true);
    expect(adminTenantSummarySchema.safeParse({ tenantId: crypto.randomUUID(), tenantName: 'Store', status: 'ACTIVE', ownerEmail: 'owner@example.com', userCount: 2, orderCount: 4, createdAt: new Date().toISOString() }).success).toBe(true);
    expect(adminTenantSummarySchema.safeParse({ tenantId: crypto.randomUUID(), tenantName: 'Store', status: 'ACTIVE', ownerEmail: 'owner@example.com', userCount: 2, orderCount: 4, createdAt: new Date().toISOString(), phone: '+380' }).success).toBe(false);
  });
});
