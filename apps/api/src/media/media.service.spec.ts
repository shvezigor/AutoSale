import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { MediaService } from './media.service.js';

describe('MediaService', () => {
  it('scopes attachment lookup through the message tenant and hides foreign ids', async () => {
    let query: unknown;
    const prisma = { attachment: { findFirst: async (input: unknown) => { query = input; return null; } } };
    const service = new MediaService(prisma as never, {} as never);

    await expect(service.load('tenant-b', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(query).toEqual(expect.objectContaining({
      where: expect.objectContaining({ message: { tenantId: 'tenant-b' } }),
    }));
  });
});
