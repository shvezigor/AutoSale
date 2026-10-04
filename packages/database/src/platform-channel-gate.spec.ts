import { describe, expect, it, vi } from 'vitest';

import {
  PlatformChannelDeploymentUnavailableError,
  PlatformChannelGate,
} from './platform-channel-gate.js';

const deployment = {
  FACEBOOK_MESSENGER: true,
  TIKTOK_BUSINESS_MESSAGING: false,
} as const;

describe('PlatformChannelGate', () => {
  it('fails closed when a deployed channel has no runtime row', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const gate = new PlatformChannelGate({ platformFeatureFlag: { findUnique } } as never, deployment);

    await expect(gate.getControl('FACEBOOK_MESSENGER')).resolves.toEqual({
      key: 'FACEBOOK_MESSENGER',
      deploymentAvailable: true,
      runtimeEnabled: false,
      effectiveEnabled: false,
      state: 'ADMIN_DISABLED',
      updatedAt: null,
    });
    await expect(gate.isEnabled('FACEBOOK_MESSENGER')).resolves.toBe(false);
  });

  it('keeps the deployment ceiling above a persisted runtime flag', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      key: 'TIKTOK_BUSINESS_MESSAGING',
      enabled: true,
      updatedAt: new Date('2026-10-04T10:00:00.000Z'),
    });
    const gate = new PlatformChannelGate({ platformFeatureFlag: { findUnique } } as never, deployment);

    await expect(gate.getControl('TIKTOK_BUSINESS_MESSAGING')).resolves.toEqual({
      key: 'TIKTOK_BUSINESS_MESSAGING',
      deploymentAvailable: false,
      runtimeEnabled: true,
      effectiveEnabled: false,
      state: 'DEPLOYMENT_UNAVAILABLE',
      updatedAt: '2026-10-04T10:00:00.000Z',
    });
    await expect(gate.assertEnabled('TIKTOK_BUSINESS_MESSAGING'))
      .rejects.toBeInstanceOf(PlatformChannelDeploymentUnavailableError);
  });

  it('lists the two controls in stable order and accepts only effective channels', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ key: 'FACEBOOK_MESSENGER', enabled: true, updatedAt: new Date('2026-10-04T11:00:00.000Z') })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ key: 'FACEBOOK_MESSENGER', enabled: true, updatedAt: new Date('2026-10-04T11:00:00.000Z') });
    const gate = new PlatformChannelGate({ platformFeatureFlag: { findUnique } } as never, deployment);

    await expect(gate.listControls()).resolves.toEqual([
      expect.objectContaining({ key: 'FACEBOOK_MESSENGER', state: 'ACTIVE' }),
      expect.objectContaining({ key: 'TIKTOK_BUSINESS_MESSAGING', state: 'DEPLOYMENT_UNAVAILABLE' }),
    ]);
    await expect(gate.assertEnabled('FACEBOOK_MESSENGER')).resolves.toBeUndefined();
  });
});
