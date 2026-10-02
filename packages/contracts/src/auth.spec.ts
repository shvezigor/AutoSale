import { describe, expect, it } from 'vitest';

import {
  acceptInvitationRequestSchema,
  adminOperationsSummarySchema,
  adminPlatformOverviewSchema,
  adminTenantSummarySchema,
  inviteMemberRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
} from './auth.js';

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

  it('allows only privacy-safe platform and queue aggregates', () => {
    const updatedAt = new Date().toISOString();
    expect(adminPlatformOverviewSchema.safeParse({
      status: 'DEGRADED', updatedAt, attentionQueueCount: 1,
      metrics: { tenantCount: 3, activeTenantCount: 2, blockedTenantCount: 1, userCount: 5, orderCount: 9, newTenantCount30Days: 1 },
    }).success).toBe(true);
    expect(adminOperationsSummarySchema.safeParse({
      status: 'HEALTHY', database: 'HEALTHY', updatedAt,
      queues: [{ queue: 'instagram', status: 'HEALTHY', waiting: 1, active: 0, delayed: 0, failed: 0, completed: 4, workerCount: 1, oldestPendingAt: updatedAt, available: true }],
    }).success).toBe(true);
    expect(adminOperationsSummarySchema.safeParse({
      status: 'HEALTHY', database: 'HEALTHY', updatedAt,
      queues: [{ queue: 'instagram', status: 'HEALTHY', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 4, workerCount: 1, oldestPendingAt: null, available: true, jobPayload: { phone: '+380' } }],
    }).success).toBe(false);
  });
});
