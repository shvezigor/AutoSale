import { parseWorkerEnv } from '@autosale/config/worker-env';
import { createPrismaClient } from '@autosale/database';
import { S3ObjectStorage } from '@autosale/integrations';
import { Worker } from 'bullmq';

import { createWorkerHealthServer } from './health-server.js';
import { InstagramProcessor } from './instagram/instagram.processor.js';
import { MediaCopyService } from './instagram/media-copy.service.js';
import { createOpenAiOrderRecognizer } from './orders/openai-order-recognizer.js';
import { OrderRecognitionService } from './orders/order-recognition.service.js';
import { TriggeredOrderProcessor } from './orders/triggered-order.processor.js';

async function bootstrap(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const server = createWorkerHealthServer();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const storage = new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: true,
  });
  await storage.ensureBucket();
  const orderRecognizer = createOpenAiOrderRecognizer(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  const orderProcessor = new TriggeredOrderProcessor(
    prisma,
    new OrderRecognitionService(orderRecognizer),
  );
  const processor = new InstagramProcessor(
    prisma,
    new MediaCopyService(storage),
    orderProcessor,
  );
  const redis = new URL(env.REDIS_URL);
  const worker = new Worker(
    'instagram',
    async (job) => {
      if (job.name !== 'instagram.normalize' || typeof job.data?.eventId !== 'string') return;
      await processor.process(job.data.eventId);
    },
    {
      connection: {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        username: redis.username || undefined,
        password: redis.password || undefined,
        tls: redis.protocol === 'rediss:' ? {} : undefined,
      },
      concurrency: 5,
    },
  );

  server.listen(env.HEALTH_PORT, '0.0.0.0');

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await prisma.$disconnect();
    server.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
