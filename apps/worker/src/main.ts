import { parseWorkerEnv } from '@autosale/config/worker-env';
import { createPrismaClient } from '@autosale/database';
import { createGoogleSheetsAdapter, S3ObjectStorage } from '@autosale/integrations';
import { Worker } from 'bullmq';
import { metrics, StructuredLogger } from '@autosale/observability';

import { createWorkerHealthServer } from './health-server.js';
import { InstagramProcessor } from './instagram/instagram.processor.js';
import { MediaCopyService } from './instagram/media-copy.service.js';
import { createOpenAiOrderRecognizer } from './orders/openai-order-recognizer.js';
import { OrderRecognitionService } from './orders/order-recognition.service.js';
import { TriggeredOrderProcessor } from './orders/triggered-order.processor.js';
import { GoogleSheetsSyncProcessor } from './google-sheets/google-sheets-sync.processor.js';
import { CatalogueMappingProcessor } from './catalogue/catalogue-mapping.processor.js';
import { createOpenAiColumnMapper } from './catalogue/openai-column-mapper.js';

async function bootstrap(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const logger = new StructuredLogger('worker');
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
  const catalogueMapper = createOpenAiColumnMapper(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  const catalogueMappingProcessor = new CatalogueMappingProcessor(prisma, storage, catalogueMapper);
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
    (event, fields) => {
      const result = fields.result === 'failure' ? 'failure' : 'success';
      metrics.increment('autosale_operations_total', { operation: 'ai_order_recognition', result });
      if (result === 'failure') logger.warn(event, fields); else logger.info(event, fields);
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
      const correlationId = typeof job.data.correlationId === 'string' ? job.data.correlationId : job.data.eventId;
      const started = performance.now();
      try {
        await processor.process(job.data.eventId);
        metrics.increment('autosale_operations_total', { operation: 'instagram_normalize', result: 'success' });
        logger.info('instagram_normalize_completed', { correlationId, eventId: job.data.eventId, jobId: job.id });
      } catch (error) {
        metrics.increment('autosale_operations_total', { operation: 'instagram_normalize', result: 'failure' });
        logger.error('instagram_normalize_failed', { correlationId, eventId: job.data.eventId, jobId: job.id, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
        throw error;
      } finally {
        metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1000, { operation: 'instagram_normalize' });
      }
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
  const catalogueWorker = new Worker(
    'catalogue',
    async (job) => {
      if (job.name !== 'catalogue.mapping' || typeof job.data?.tenantId !== 'string' || typeof job.data?.runId !== 'string') return;
      const started = performance.now();
      try {
        await catalogueMappingProcessor.process({ tenantId: job.data.tenantId, runId: job.data.runId });
        metrics.increment('autosale_operations_total', { operation: 'catalogue_mapping', result: 'success' });
        logger.info('catalogue_mapping_completed', { correlationId: job.data.runId, runId: job.data.runId });
      } catch (error) {
        metrics.increment('autosale_operations_total', { operation: 'catalogue_mapping', result: 'failure' });
        logger.warn('catalogue_mapping_failed', { correlationId: job.data.runId, runId: job.data.runId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
        throw error;
      } finally {
        metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1000, { operation: 'catalogue_mapping' });
      }
    },
    {
      connection: {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        username: redis.username || undefined,
        password: redis.password || undefined,
        tls: redis.protocol === 'rediss:' ? {} : undefined,
      },
      concurrency: 2,
    },
  );
  const sheetsProcessor = env.GOOGLE_SERVICE_ACCOUNT_FILE
    ? new GoogleSheetsSyncProcessor(prisma, createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE))
    : undefined;
  let polling = false;
  const pollExports = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      const pending = await prisma.orderExport.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 10, include: { order: { select: { triggerMessage: { select: { rawEventId: true } } } } } });
      metrics.set('autosale_queue_backlog', pending.length, { queue: 'google_sheets' });
      if (!sheetsProcessor) return;
      for (const record of pending) {
        const claimed = await prisma.orderExport.updateMany({ where: { id: record.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
        if (claimed.count === 1) {
          const correlationId = record.order.triggerMessage.rawEventId;
          const started = performance.now();
          try {
            await sheetsProcessor.process(record.id);
            metrics.increment('autosale_operations_total', { operation: 'sheets_export', result: 'success' });
            logger.info('sheets_export_completed', { correlationId, orderId: record.orderId, exportId: record.id });
          } catch (error) {
            metrics.increment('autosale_operations_total', { operation: 'sheets_export', result: 'failure' });
            logger.warn('sheets_export_failed', { correlationId, orderId: record.orderId, exportId: record.id, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
          } finally {
            metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1000, { operation: 'sheets_export' });
          }
        }
      }
    } finally {
      polling = false;
    }
  };
  const sheetsTimer = setInterval(() => void pollExports(), 5_000);
  void pollExports();
  logger.info('service_started', { correlationId: 'system:startup', healthPort: env.HEALTH_PORT });

  server.listen(env.HEALTH_PORT, '0.0.0.0');

  const shutdown = async (): Promise<void> => {
    clearInterval(sheetsTimer);
    await worker.close();
    await catalogueWorker.close();
    await prisma.$disconnect();
    server.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
