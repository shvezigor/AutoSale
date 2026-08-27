import { parseWorkerEnv } from '@autosale/config/worker-env';
import { createPrismaClient } from '@autosale/database';
import { createGoogleSheetsAdapter, S3ObjectStorage } from '@autosale/integrations';
import { Worker } from 'bullmq';

import { createWorkerHealthServer } from './health-server.js';
import { InstagramProcessor } from './instagram/instagram.processor.js';
import { MediaCopyService } from './instagram/media-copy.service.js';
import { createOpenAiOrderRecognizer } from './orders/openai-order-recognizer.js';
import { OrderRecognitionService } from './orders/order-recognition.service.js';
import { TriggeredOrderProcessor } from './orders/triggered-order.processor.js';
import { GoogleSheetsSyncProcessor } from './google-sheets/google-sheets-sync.processor.js';

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
    async (orderId, tenantId) => {
      const destination = await prisma.googleSheetsDestination.findUnique({ where: { tenantId } });
      if (!destination || destination.status !== 'ACTIVE') return;
      await prisma.orderExport.upsert({
        where: { orderId_destinationId: { orderId, destinationId: destination.id } },
        create: { tenantId, orderId, destinationId: destination.id },
        update: { status: 'PENDING', errorSummary: null },
      });
    },
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
  const sheetsProcessor = env.GOOGLE_SERVICE_ACCOUNT_FILE
    ? new GoogleSheetsSyncProcessor(prisma, createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE))
    : undefined;
  let polling = false;
  const pollExports = async (): Promise<void> => {
    if (!sheetsProcessor || polling) return;
    polling = true;
    try {
      const pending = await prisma.orderExport.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 10 });
      for (const record of pending) {
        const claimed = await prisma.orderExport.updateMany({ where: { id: record.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
        if (claimed.count === 1) await sheetsProcessor.process(record.id).catch(() => undefined);
      }
    } finally {
      polling = false;
    }
  };
  const sheetsTimer = setInterval(() => void pollExports(), 5_000);
  void pollExports();

  server.listen(env.HEALTH_PORT, '0.0.0.0');

  const shutdown = async (): Promise<void> => {
    clearInterval(sheetsTimer);
    await worker.close();
    await prisma.$disconnect();
    server.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
