import type { PrismaClient } from '@autosale/database';
import type { ObjectStorage } from '@autosale/integrations';
import { NotFoundException } from '@nestjs/common';

export class MediaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage,
  ) {}

  async load(tenantId: string, id: string): Promise<{ body: Uint8Array; contentType: string }> {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        copyStatus: 'COPIED',
        storageKey: { not: null },
        message: { tenantId },
      },
      select: { storageKey: true },
    });
    if (!attachment?.storageKey) {
      throw new NotFoundException('Media not found');
    }
    return this.storage.get(attachment.storageKey);
  }

  async loadProfileAvatar(tenantId: string, profileId: string): Promise<{ body: Uint8Array; contentType: string }> {
    const profile = await this.prisma.instagramCustomerProfile.findFirst({
      where: {
        id: profileId,
        tenantId,
        avatarStorageKey: { not: null },
      },
      select: { avatarStorageKey: true },
    });
    if (!profile?.avatarStorageKey) throw new NotFoundException('Profile avatar not found');
    return this.storage.get(profile.avatarStorageKey);
  }

  async loadUserAvatar(userId: string): Promise<{ body: Uint8Array; contentType: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStorageKey: true },
    });
    if (!user?.avatarStorageKey) throw new NotFoundException('User avatar not found');
    const avatar = await this.storage.get(user.avatarStorageKey);
    if (avatar.contentType !== 'image/webp') throw new NotFoundException('User avatar not found');
    return avatar;
  }
}
