import type { PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { NotFoundException } from '@nestjs/common';

export class MediaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly tenantId: string,
  ) {}

  async load(id: string): Promise<{ body: Uint8Array; contentType: string }> {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        copyStatus: 'COPIED',
        storageKey: { not: null },
        message: { tenantId: this.tenantId },
      },
      select: { storageKey: true },
    });
    if (!attachment?.storageKey) {
      throw new NotFoundException('Media not found');
    }
    return this.storage.get(attachment.storageKey);
  }
}
