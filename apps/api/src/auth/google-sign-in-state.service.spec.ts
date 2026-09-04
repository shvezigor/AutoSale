import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { GoogleSignInStateService } from './google-sign-in-state.service.js';

const now = new Date('2026-09-04T08:00:00.000Z');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('GoogleSignInStateService', () => {
  it.each(['/orders?status=new', '//evil.example', '\\evil', '/login', '/onboarding/google', '/bad\u0000path'])(
    'stores only a state hash and a safe return path for %j',
    async (returnPath) => {
      const create = vi.fn().mockResolvedValue({});
      const service = new GoogleSignInStateService({ googleSignInAttempt: { create } } as never, () => now);

      const result = await service.createAttempt(returnPath);

      expect(result.state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
        stateTokenHash: hash(result.state),
        stateExpiresAt: new Date('2026-09-04T08:10:00.000Z'),
        returnPath: returnPath === '/orders?status=new' ? returnPath : '/conversations',
      }) });
      expect(JSON.stringify(create.mock.calls)).not.toContain(result.state);
    },
  );

  it('consumes an unexpired state once and rejects a replay', async () => {
    const updateManyAndReturn = vi.fn()
      .mockResolvedValueOnce([{ id: 'attempt-1', returnPath: '/orders' }])
      .mockResolvedValueOnce([]);
    const service = new GoogleSignInStateService({ googleSignInAttempt: { updateManyAndReturn } } as never, () => now);

    await expect(service.consumeState('raw-state')).resolves.toEqual({ attemptId: 'attempt-1', returnPath: '/orders' });
    await expect(service.consumeState('raw-state')).rejects.toThrow('Invalid or expired Google Sign-In state');
    expect(updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { stateTokenHash: hash('raw-state'), stateUsedAt: null, stateExpiresAt: { gt: now } },
    }));
  });

  it('arms a 15-minute onboarding grant without persisting the raw value', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new GoogleSignInStateService({ googleSignInAttempt: { updateMany } } as never, () => now);

    const result = await service.armOnboarding('attempt-1', {
      subject: 'google-subject', email: 'owner@example.com', name: 'Owner',
    });

    expect(result.expiresAt).toEqual(new Date('2026-09-04T08:15:00.000Z'));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', stateUsedAt: { not: null }, onboardingTokenHash: null },
      data: {
        onboardingTokenHash: hash(result.grant),
        onboardingExpiresAt: result.expiresAt,
        googleSubject: 'google-subject', verifiedEmail: 'owner@example.com', displayName: 'Owner',
      },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain(result.grant);
  });

  it('returns limited onboarding context without exposing the Google subject', async () => {
    const findFirst = vi.fn().mockResolvedValue({ verifiedEmail: 'owner@example.com', displayName: 'Owner' });
    const service = new GoogleSignInStateService({ googleSignInAttempt: { findFirst } } as never, () => now);

    await expect(service.readOnboarding('raw-grant')).resolves.toEqual({ email: 'owner@example.com', name: 'Owner' });
  });

  it('atomically consumes onboarding claims and clears them', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'attempt-1', returnPath: '/conversations', googleSubject: 'google-subject',
      verifiedEmail: 'owner@example.com', displayName: 'Owner',
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = { googleSignInAttempt: { findFirst, updateMany } };
    const prisma = { $transaction: vi.fn((operation) => operation(transaction)) };
    const service = new GoogleSignInStateService(prisma as never, () => now);

    await expect(service.consumeOnboarding('raw-grant')).resolves.toEqual({
      attemptId: 'attempt-1', returnPath: '/conversations', subject: 'google-subject',
      email: 'owner@example.com', name: 'Owner',
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        onboardingUsedAt: now, onboardingTokenHash: null, googleSubject: null,
        verifiedEmail: null, displayName: null,
      },
    }));
  });
});
