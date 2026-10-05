import { DynamicModule, Module } from '@nestjs/common';
import { Queue } from 'bullmq';

export const SOCIAL_INBOUND_QUEUE = Symbol('SOCIAL_INBOUND_QUEUE');
export const INSTAGRAM_NORMALIZE_QUEUE = Symbol('INSTAGRAM_NORMALIZE_QUEUE');
export const INSTAGRAM_QUEUE = Symbol('INSTAGRAM_QUEUE');
export const AI_REPLY_QUEUE = Symbol('AI_REPLY_QUEUE');

@Module({})
export class QueueModule {
  static register(redisUrl: string): DynamicModule {
    const url = new URL(redisUrl);

    return {
      module: QueueModule,
      providers: [
        {
          provide: SOCIAL_INBOUND_QUEUE,
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
          provide: INSTAGRAM_NORMALIZE_QUEUE,
          useExisting: SOCIAL_INBOUND_QUEUE,
        },
        {
          provide: INSTAGRAM_QUEUE,
          useExisting: SOCIAL_INBOUND_QUEUE,
        },
        {
          provide: AI_REPLY_QUEUE,
          useFactory: () => new Queue('ai-replies', {
            connection: {
              host: url.hostname,
              port: Number(url.port || 6379),
              username: url.username || undefined,
              password: url.password || undefined,
              tls: url.protocol === 'rediss:' ? {} : undefined,
            },
            defaultJobOptions: {
              attempts: 1,
              removeOnComplete: 1_000,
              removeOnFail: 5_000,
            },
          }),
        },
      ],
      exports: [SOCIAL_INBOUND_QUEUE, INSTAGRAM_NORMALIZE_QUEUE, INSTAGRAM_QUEUE, AI_REPLY_QUEUE],
    };
  }
}
