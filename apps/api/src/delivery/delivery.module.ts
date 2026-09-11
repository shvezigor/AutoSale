import type { ApiEnv } from '@autosale/config/api-env';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { CredentialCipher, NovaPoshtaClient } from '@autosale/integrations';
import { DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';

import { DeliveryController, DeliveryLocationController, ShipmentController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryLocationService } from './delivery-location.service.js';

@Module({})
export class DeliveryModule {
  static register(env: ApiEnv): DynamicModule {
    const prisma = createPrismaClient(env.DATABASE_URL);
    const cipher = new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'));
    const shipmentQueue = new Queue('delivery', { connection: queueConnection(env.REDIS_URL) });
    const service = new DeliveryService(
      prisma,
      cipher,
      (apiKey) => new NovaPoshtaClient({ apiKey }),
      { enabled: env.NOVA_POSHTA_DELIVERY_ENABLED },
      shipmentQueue,
    );
    const locationService = new DeliveryLocationService(service);
    return {
      module: DeliveryModule,
      controllers: [DeliveryController, DeliveryLocationController, ShipmentController],
      providers: [
        { provide: DeliveryService, useValue: service },
        { provide: DeliveryLocationService, useValue: locationService },
        { provide: DeliveryPrismaLifecycle, useValue: new DeliveryPrismaLifecycle(prisma, shipmentQueue) },
      ],
      exports: [DeliveryService],
    };
  }
}

class DeliveryPrismaLifecycle implements OnApplicationShutdown {
  constructor(private readonly prisma: PrismaClient, private readonly queue: Queue) {}
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.prisma.$disconnect();
  }
}

function queueConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}
