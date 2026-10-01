import type { PrismaClient } from '@autosale/database';

import { dueTelegramDeliveryAuthorities } from './telegram-authority.js';

interface TelegramDeliveryQueue {
  add(
    name: 'telegram.deliver',
    data: { deliveryId: string },
    options: { jobId: string; attempts: 1; removeOnComplete: true; removeOnFail: true },
  ): Promise<unknown>;
}

export class TelegramDeliveryReconciler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: TelegramDeliveryQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<{ attempted: number; queued: number }> {
    const now = this.now();
    const deliveries = await dueTelegramDeliveryAuthorities(this.prisma, now, 50);

    let queued = 0;
    for (const delivery of deliveries) {
      try {
        await this.queue.add(
          'telegram.deliver',
          { deliveryId: delivery.deliveryId },
          {
            jobId: `telegram:${delivery.deliveryId}`,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
        queued += 1;
      } catch {
        // PostgreSQL remains the source of truth; the next pass retries the wake-up.
      }
    }
    return { attempted: deliveries.length, queued };
  }
}
