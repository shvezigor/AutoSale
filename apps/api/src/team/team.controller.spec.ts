import { describe, expect, it, vi } from 'vitest';

import { TeamController } from './team.controller.js';

describe('TeamController', () => {
  it('passes tenant and owner identity to invitation creation', async () => {
    const invite = vi.fn().mockResolvedValue({ id: 'invite-1' });
    const controller = new TeamController({ invite } as never);
    const principal = { tenantId: 'tenant-1', userId: 'owner-1' } as never;

    await controller.invite(principal, { email: 'manager@example.com' });

    expect(invite).toHaveBeenCalledWith('tenant-1', 'owner-1', 'manager@example.com');
  });

  it('accepts an invitation without a pre-existing session', async () => {
    const accept = vi.fn().mockResolvedValue({ accepted: true });
    const controller = new TeamController({ accept } as never);

    await expect(controller.accept({ token: 'x'.repeat(20), name: 'Manager', password: 'long secure password' })).resolves.toEqual({ accepted: true });
  });
});
