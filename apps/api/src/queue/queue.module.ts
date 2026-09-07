import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

export const INSTAGRAM_NORMALIZE_QUEUE = Symbol('INSTAGRAM_NORMALIZE_QUEUE');
export const INSTAGRAM_QUEUE = Symbol('INSTAGRAM_QUEUE');

@Module({})
export class QueueModule {
  static register(redisUrl: string): DynamicModule {
    const url = new URL(redisUrl);

    return {
      module: QueueModule,
      providers: [
        {
          provide: INSTAGRAM_NORMALIZE_QUEUE,
          useFactory: () =>
            new Queue('instagram', {
              connection: {
                host: url.hostname,
                port: Number(url.port || 6379),
                username: url.username || undefined,
                password: url.password || undefined,
                tls: url.protocol === 'rediss:' ? {} : undefined,
              },
              defaultJobOptions: {
                attempts: 5,
                backoff: { type: 'exponential', delay: 1_000 },
                removeOnComplete: 1_000,
                removeOnFail: 5_000,
              },
            }),
        },
        {
          provide: INSTAGRAM_QUEUE,
          useExisting: INSTAGRAM_NORMALIZE_QUEUE,
        },
      ],
      exports: [INSTAGRAM_NORMALIZE_QUEUE, INSTAGRAM_QUEUE],
    };
  }
}
