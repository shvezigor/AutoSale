import { Buffer } from 'node:buffer';

import { parseWorkerEnv } from '@autosale/config/worker-env';
import { shipmentCreateJobSchema, telegramDeliveryJobSchema } from '@autosale/contracts';
import { createPrismaClient, ProcurementStore } from '@autosale/database';
import {
  createGoogleSheetsAdapter,
  CredentialCipher,
  GoogleOAuthTokenProvider,
  GoogleSheetsAdapter,
  MetaInstagramClient,
  S3ObjectStorage,
  TelegramBotClient,
  NovaPoshtaClient,
} from '@autosale/integrations';
import { Queue, Worker } from 'bullmq';
import { metrics, StructuredLogger } from '@autosale/observability';

import { createWorkerHealthServer } from './health-server.js';
import { InstagramProcessor } from './instagram/instagram.processor.js';
import { InstagramAvatarCleanupReconciler } from './instagram/instagram-avatar-cleanup-reconciler.js';
import { InstagramAvatarCopyService } from './instagram/instagram-avatar-copy.service.js';
import { InstagramProfileEnrichmentService } from './instagram/instagram-profile-enrichment.service.js';
import { InstagramProfileReconciler } from './instagram/instagram-profile-reconciler.js';
import { InstagramMessageDeliveryService } from './instagram/instagram-message-delivery.service.js';
import { InstagramMessageReconciler } from './instagram/instagram-message-reconciler.js';
import { MediaCopyService } from './instagram/media-copy.service.js';
import { createOpenAiOrderRecognizer } from './orders/openai-order-recognizer.js';
import { OrderRecognitionService } from './orders/order-recognition.service.js';
import { TriggeredOrderProcessor } from './orders/triggered-order.processor.js';
import { ProcurementBackfillReconciler } from './orders/procurement-backfill.reconciler.js';
import { GoogleSheetsSyncProcessor } from './google-sheets/google-sheets-sync.processor.js';
import { CatalogueMappingProcessor } from './catalogue/catalogue-mapping.processor.js';
import { createOpenAiColumnMapper } from './catalogue/openai-column-mapper.js';
import { createOpenAiTableStructureAnalyzer } from './catalogue/openai-table-structure-analyzer.js';
import { createOpenAiAmbiguousRowClassifier } from './catalogue/openai-ambiguous-row-classifier.js';
import { CatalogueMappingReconciler } from './catalogue/catalogue-mapping-reconciler.js';
import { GoogleCatalogueSyncProcessor } from './catalogue/google-catalogue-sync.processor.js';
import { CatalogueSyncScheduler } from './catalogue/catalogue-sync-scheduler.js';
import { CatalogueAutoImporter } from './catalogue/catalogue-auto-importer.js';
import { WorkerNotificationService } from './notifications/worker-notification.service.js';
import { TelegramAlertService } from './notifications/telegram-alert.service.js';
import { NotificationRetentionReconciler } from './notifications/notification-retention.reconciler.js';
import { TelegramDeliveryReconciler } from './telegram/telegram-delivery-reconciler.js';
import { TelegramDeliveryService } from './telegram/telegram-delivery.service.js';
import { ShipmentCreateService } from './delivery/shipment-create.service.js';
import { ShipmentReconciler } from './delivery/shipment-reconciler.js';

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
  const credentialCipher = new CredentialCipher(Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'base64'));
  const metaInstagram = new MetaInstagramClient({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    graphVersion: env.META_GRAPH_API_VERSION,
  });
  const orderRecognizer = createOpenAiOrderRecognizer(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  const catalogueMapper = createOpenAiColumnMapper(env.OPENAI_API_KEY, env.OPENAI_MODEL);
  const catalogueHybrid = {
    structureAnalyzer: createOpenAiTableStructureAnalyzer(env.OPENAI_API_KEY, env.OPENAI_MODEL),
    ambiguousRows: createOpenAiAmbiguousRowClassifier(env.OPENAI_API_KEY, env.OPENAI_MODEL),
  };
  const catalogueMappingProcessor = new CatalogueMappingProcessor(
    prisma,
    storage,
    catalogueMapper,
    new CatalogueAutoImporter(prisma, storage),
    env.CATALOGUE_AI_STRUCTURE_ANALYSIS ? catalogueHybrid : undefined,
  );
  const googleSheets = env.GOOGLE_SERVICE_ACCOUNT_FILE ? createGoogleSheetsAdapter(env.GOOGLE_SERVICE_ACCOUNT_FILE) : undefined;
  const googleOAuthTokens = env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET
    ? new GoogleOAuthTokenProvider({
      findConnection: async (connectionId, tenantId) => prisma.googleConnection.findFirst({
        where: { id: connectionId, tenantId },
        select: { id: true, tenantId: true, status: true, encryptedRefreshToken: true, credentialGenerationId: true },
      }),
      markReauthorizationRequired: async (tenantId, credentialGenerationId) => {
        await prisma.googleConnection.updateMany({
          where: { tenantId, credentialGenerationId },
          data: { status: 'REAUTHORIZATION_REQUIRED', lastErrorCode: 'GOOGLE_TOKEN_REFRESH_FAILED' },
        });
      },
    }, credentialCipher, {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    })
    : undefined;
  const oauthSheets = googleOAuthTokens
    ? async (tenantId: string, connectionId: string) => new GoogleSheetsAdapter({
      getAccessToken: () => googleOAuthTokens.getAccessToken(connectionId, tenantId),
    })
    : undefined;
  const workerNotifications = new WorkerNotificationService(prisma as never);
  const telegramAlerts = new TelegramAlertService(env.APP_PUBLIC_URL);
  const procurementStore = new ProcurementStore(prisma);
  const procurementBackfill = new ProcurementBackfillReconciler(prisma, procurementStore);
  const catalogueSyncProcessor = googleSheets || oauthSheets
    ? new GoogleCatalogueSyncProcessor(prisma, googleSheets, storage, undefined, oauthSheets, workerNotifications, env.CATALOGUE_AI_STRUCTURE_ANALYSIS ? catalogueHybrid : undefined)
    : undefined;
  const orderProcessor = new TriggeredOrderProcessor(
    prisma,
    new OrderRecognitionService(orderRecognizer),
    procurementStore,
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
      const operation = event.startsWith('procurement_') ? event.replace(/_(completed|failed)$/, '') : 'ai_order_recognition';
      metrics.increment('autosale_operations_total', { operation, result });
      if (result === 'failure') logger.warn(event, fields); else logger.info(event, fields);
    },
    telegramAlerts,
  );
  const processor = new InstagramProcessor(
    prisma,
    new MediaCopyService(storage),
    orderProcessor,
  );
  const profileEnrichment = new InstagramProfileEnrichmentService(
    prisma,
    metaInstagram,
    new InstagramAvatarCopyService(storage),
    credentialCipher,
  );
  const messageDelivery = new InstagramMessageDeliveryService(
    prisma,
    metaInstagram,
    credentialCipher,
    orderProcessor,
  );
  const redis = new URL(env.REDIS_URL);
  const redisConnection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    username: redis.username || undefined,
    password: redis.password || undefined,
    tls: redis.protocol === 'rediss:' ? {} : undefined,
  };
  const shipmentCreate = new ShipmentCreateService(
    prisma,
    (apiKey) => new NovaPoshtaClient({ apiKey }),
    (encrypted) => credentialCipher.decrypt(encrypted),
  );
  const deliveryQueue = new Queue('delivery', { connection: redisConnection });
  const deliveryWorker = new Worker(
    'delivery',
    async (job) => {
      if (job.name !== 'shipment.create') return;
      const parsed = shipmentCreateJobSchema.safeParse(job.data);
      if (!parsed.success) return;
      const started = performance.now();
      try {
        const result = await shipmentCreate.process(parsed.data);
        metrics.increment('autosale_operations_total', {
          operation: 'shipment_create',
          result: result === 'CREATED' || result === 'IGNORED' || result === 'RETRY' || result === 'UNKNOWN' ? 'success' : 'failure',
        });
        logger.info('shipment_create_completed', { correlationId: parsed.data.shipmentId, shipmentId: parsed.data.shipmentId, result });
      } catch (error) {
        metrics.increment('autosale_operations_total', { operation: 'shipment_create', result: 'failure' });
        logger.warn('shipment_create_failed', { correlationId: parsed.data.shipmentId, shipmentId: parsed.data.shipmentId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
        throw error;
      } finally {
        metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000, { operation: 'shipment_create' });
      }
    },
    { connection: redisConnection, concurrency: 2 },
  );
  const shipmentReconciler = new ShipmentReconciler(prisma, deliveryQueue);
  const telegramBot = env.TELEGRAM_BOT_TOKEN
    ? new TelegramBotClient({ token: env.TELEGRAM_BOT_TOKEN })
    : undefined;
  const telegramDelivery = telegramBot
    ? new TelegramDeliveryService(prisma, telegramBot, undefined, telegramAlerts)
    : undefined;
  const telegramWorker = telegramDelivery
    ? new Worker(
      'telegram',
      async (job) => {
        if (job.name !== 'telegram.deliver') return;
        const parsed = telegramDeliveryJobSchema.safeParse(job.data);
        if (!parsed.success) return;
        const started = performance.now();
        const deliveryRecord = await prisma.telegramDelivery.findUnique({
          where: { id: parsed.data.deliveryId },
          select: { purpose: true },
        });
        const telegramOperation = deliveryRecord?.purpose === 'SUPPLIER_ORDER'
          ? 'telegram_supplier_delivery'
          : deliveryRecord?.purpose === 'PERSONAL_ALERT'
            ? 'telegram_personal_alert'
            : 'telegram_delivery';
        try {
          const result = await telegramDelivery.process(parsed.data);
          metrics.increment('autosale_operations_total', {
            operation: telegramOperation,
            result: result === 'SUCCEEDED' || result === 'IGNORED' || result === 'RETRY' ? 'success' : 'failure',
          });
          logger.info('telegram_delivery_completed', {
            correlationId: parsed.data.deliveryId,
            deliveryId: parsed.data.deliveryId,
            result,
          });
        } catch (error) {
          metrics.increment('autosale_operations_total', { operation: telegramOperation, result: 'failure' });
          logger.warn('telegram_delivery_failed', {
            correlationId: parsed.data.deliveryId,
            deliveryId: parsed.data.deliveryId,
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          });
          throw error;
        } finally {
          metrics.observe(
            'autosale_operation_duration_seconds',
            (performance.now() - started) / 1_000,
            { operation: telegramOperation },
          );
        }
      },
      { connection: redisConnection, concurrency: 4 },
    )
    : undefined;
  const telegramQueue = telegramDelivery
    ? new Queue('telegram', { connection: redisConnection })
    : undefined;
  const telegramDeliveryReconciler = telegramQueue
    ? new TelegramDeliveryReconciler(prisma, telegramQueue)
    : undefined;
  const worker = new Worker(
    'instagram',
    async (job) => {
      if (
        job.name === 'instagram.order.create' &&
        typeof job.data?.tenantId === 'string' &&
        typeof job.data?.triggerMessageId === 'string'
      ) {
        const trigger = await prisma.message.findFirst({
          where: { id: job.data.triggerMessageId, tenantId: job.data.tenantId },
          select: { id: true },
        });
        if (!trigger) throw new Error('Manual order trigger message not found');
        await orderProcessor.process(trigger.id);
        return;
      }
      if (
        job.name === 'instagram.message.send' &&
        typeof job.data?.tenantId === 'string' &&
        typeof job.data?.messageId === 'string'
      ) {
        const started = performance.now();
        try {
          const result = await messageDelivery.process({
            tenantId: job.data.tenantId,
            messageId: job.data.messageId,
          });
          metrics.increment('autosale_operations_total', {
            operation: 'instagram_message_send',
            result: result === 'SENT' || result === 'IGNORED' ? 'success' : 'failure',
          });
          logger.info('instagram_message_send_completed', {
            correlationId: job.data.messageId,
            messageId: job.data.messageId,
            result,
          });
        } catch (error) {
          metrics.increment('autosale_operations_total', {
            operation: 'instagram_message_send', result: 'failure',
          });
          logger.warn('instagram_message_send_failed', {
            correlationId: job.data.messageId,
            messageId: job.data.messageId,
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          });
          throw error;
        } finally {
          metrics.observe(
            'autosale_operation_duration_seconds',
            (performance.now() - started) / 1000,
            { operation: 'instagram_message_send' },
          );
        }
        return;
      }
      if (
        job.name === 'instagram.profile.enrich' &&
        typeof job.data?.profileId === 'string' &&
        typeof job.data?.tenantId === 'string' &&
        typeof job.data?.participantId === 'string' &&
        Number.isInteger(job.data?.refreshVersion)
      ) {
        await profileEnrichment.process({
          profileId: job.data.profileId,
          tenantId: job.data.tenantId,
          participantId: job.data.participantId,
          refreshVersion: job.data.refreshVersion,
        });
        return;
      }
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
  const instagramProfileQueue = new Queue('instagram', {
    connection: {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      username: redis.username || undefined,
      password: redis.password || undefined,
      tls: redis.protocol === 'rediss:' ? {} : undefined,
    },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: true,
    },
  });
  const instagramProfileReconciler = new InstagramProfileReconciler(prisma, instagramProfileQueue);
  const instagramMessageReconciler = new InstagramMessageReconciler(prisma, instagramProfileQueue);
  const instagramAvatarCleanupReconciler = new InstagramAvatarCleanupReconciler(prisma, storage);
  const catalogueWorker = new Worker(
    'catalogue',
    async (job) => {
      if (job.name === 'catalogue.sync' && typeof job.data?.tenantId === 'string' && typeof job.data?.sourceId === 'string') {
        if (!catalogueSyncProcessor) throw new Error('Google catalogue synchronization is unavailable');
        const started = performance.now();
        try {
          const configuredAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
          const result = await catalogueSyncProcessor.process({
            tenantId: job.data.tenantId,
            sourceId: job.data.sourceId,
            finalAttempt: job.attemptsMade + 1 >= configuredAttempts,
          });
          if (result.status === 'FAILED') {
            metrics.increment('autosale_operations_total', { operation: 'catalogue_sync', result: 'failure' });
            logger.warn('catalogue_sync_failed', { correlationId: job.data.sourceId, sourceId: job.data.sourceId, errorCode: result.reason });
          } else {
            metrics.increment('autosale_operations_total', { operation: 'catalogue_sync', result: 'success' });
            logger.info('catalogue_sync_completed', { correlationId: job.data.sourceId, sourceId: job.data.sourceId });
          }
        } catch (error) {
          metrics.increment('autosale_operations_total', { operation: 'catalogue_sync', result: 'failure' });
          logger.warn('catalogue_sync_failed', { correlationId: job.data.sourceId, sourceId: job.data.sourceId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
          throw error;
        } finally {
          metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1000, { operation: 'catalogue_sync' });
        }
        return;
      }
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
  const catalogueQueue = new Queue('catalogue', {
    connection: {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      username: redis.username || undefined,
      password: redis.password || undefined,
      tls: redis.protocol === 'rediss:' ? {} : undefined,
    },
  });
  const catalogueReconciler = new CatalogueMappingReconciler(prisma, catalogueQueue);
  const catalogueScheduler = new CatalogueSyncScheduler(prisma, catalogueQueue);
  const sheetsProcessor = googleSheets || oauthSheets ? new GoogleSheetsSyncProcessor(prisma, googleSheets, oauthSheets, workerNotifications) : undefined;
  const notificationRetention = new NotificationRetentionReconciler(prisma as never);
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
  let reconcilingCatalogueMappings = false;
  const reconcileCatalogueMappings = async (): Promise<void> => {
    if (reconcilingCatalogueMappings) return;
    reconcilingCatalogueMappings = true;
    try {
      const result = await catalogueReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'catalogue' });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'catalogue_mapping_reconcile', result: 'failure' });
      logger.warn('catalogue_mapping_reconcile_failed', { correlationId: 'system:catalogue-mapping', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      reconcilingCatalogueMappings = false;
    }
  };
  const catalogueReconcileTimer = setInterval(() => void reconcileCatalogueMappings(), 5_000);
  let reconcilingInstagramProfiles = false;
  const reconcileInstagramProfiles = async (): Promise<void> => {
    if (reconcilingInstagramProfiles) return;
    reconcilingInstagramProfiles = true;
    try {
      const result = await instagramProfileReconciler.reconcile();
      const cleanup = await instagramAvatarCleanupReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'instagram_profile' });
      metrics.set('autosale_queue_backlog', cleanup.attempted, { queue: 'instagram_avatar_cleanup' });
      if (result.failed > 0 || cleanup.failed > 0) {
        metrics.increment('autosale_operations_total', { operation: 'instagram_profile_reconcile', result: 'failure' });
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'instagram_profile_reconcile', result: 'failure' });
      logger.warn('instagram_profile_reconcile_failed', { correlationId: 'system:instagram-profile', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      reconcilingInstagramProfiles = false;
    }
  };
  const instagramProfileReconcileTimer = setInterval(() => void reconcileInstagramProfiles(), 5_000);
  let reconcilingInstagramMessages = false;
  const reconcileInstagramMessages = async (): Promise<void> => {
    if (reconcilingInstagramMessages) return;
    reconcilingInstagramMessages = true;
    try {
      const result = await instagramMessageReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'instagram_message' });
      metrics.increment('autosale_operations_total', {
        operation: 'instagram_message_reconcile',
        result: result.queued === result.attempted ? 'success' : 'failure',
      });
    } catch (error) {
      metrics.increment('autosale_operations_total', {
        operation: 'instagram_message_reconcile', result: 'failure',
      });
      logger.warn('instagram_message_reconcile_failed', {
        correlationId: 'system:instagram-message',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      reconcilingInstagramMessages = false;
    }
  };
  const instagramMessageReconcileTimer = setInterval(() => void reconcileInstagramMessages(), 5_000);
  let schedulingCatalogueSources = false;
  const scheduleCatalogueSources = async (): Promise<void> => {
    if (schedulingCatalogueSources) return;
    schedulingCatalogueSources = true;
    try {
      await catalogueScheduler.scheduleDue();
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'catalogue_sync_schedule', result: 'failure' });
      logger.warn('catalogue_sync_schedule_failed', { correlationId: 'system:catalogue-sync', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      schedulingCatalogueSources = false;
    }
  };
  const catalogueScheduleTimer = setInterval(() => void scheduleCatalogueSources(), 60_000);
  let reconcilingNotificationRetention = false;
  const reconcileNotificationRetention = async (): Promise<void> => {
    if (reconcilingNotificationRetention) return;
    reconcilingNotificationRetention = true;
    try {
      const deleted = await notificationRetention.reconcile();
      if (deleted > 0) logger.info('notification_retention_completed', { correlationId: 'system:notification-retention', deleted });
    } catch (error) {
      logger.warn('notification_retention_failed', { correlationId: 'system:notification-retention', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      reconcilingNotificationRetention = false;
    }
  };
  const notificationRetentionTimer = setInterval(() => void reconcileNotificationRetention(), 24 * 60 * 60_000);
  let reconcilingTelegramDeliveries = false;
  const reconcileTelegramDeliveries = async (): Promise<void> => {
    if (!telegramDeliveryReconciler || reconcilingTelegramDeliveries) return;
    reconcilingTelegramDeliveries = true;
    try {
      const result = await telegramDeliveryReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'telegram_delivery' });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'telegram_delivery_reconcile', result: 'failure' });
      logger.warn('telegram_delivery_reconcile_failed', {
        correlationId: 'system:telegram-delivery',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      reconcilingTelegramDeliveries = false;
    }
  };
  const telegramDeliveryTimer = telegramDeliveryReconciler
    ? setInterval(() => void reconcileTelegramDeliveries(), 5_000)
    : undefined;
  let reconcilingProcurementBackfill = false;
  const reconcileProcurementBackfill = async (): Promise<void> => {
    if (reconcilingProcurementBackfill) return;
    reconcilingProcurementBackfill = true;
    try {
      const result = await procurementBackfill.reconcile();
      if (result.assessed > 0) metrics.increment('autosale_operations_total', { operation: 'procurement_assessment', result: 'success' }, result.assessed);
      if (result.skipped > 0) metrics.increment('autosale_operations_total', { operation: 'procurement_assessment', result: 'skipped' }, result.skipped);
      if (result.failed > 0) metrics.increment('autosale_operations_total', { operation: 'procurement_assessment', result: 'failure' }, result.failed);
      if (result.attempted > 0) logger.info('procurement_backfill_completed', { correlationId: 'system:procurement-backfill', ...result });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'procurement_assessment', result: 'failure' });
      logger.warn('procurement_backfill_failed', { correlationId: 'system:procurement-backfill', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      reconcilingProcurementBackfill = false;
    }
  };
  const procurementBackfillTimer = setInterval(() => void reconcileProcurementBackfill(), 5_000);
  let reconcilingShipments = false;
  const reconcileShipments = async (): Promise<void> => {
    if (reconcilingShipments) return;
    reconcilingShipments = true;
    try {
      const result = await shipmentReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'delivery' });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'shipment_reconcile', result: 'failure' });
      logger.warn('shipment_reconcile_failed', { correlationId: 'system:shipment', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      reconcilingShipments = false;
    }
  };
  const shipmentReconcileTimer = setInterval(() => void reconcileShipments(), 5_000);
  void pollExports();
  void reconcileCatalogueMappings();
  void reconcileInstagramProfiles();
  void reconcileInstagramMessages();
  void scheduleCatalogueSources();
  void reconcileNotificationRetention();
  void reconcileTelegramDeliveries();
  void reconcileProcurementBackfill();
  void reconcileShipments();
  logger.info('service_started', { correlationId: 'system:startup', healthPort: env.HEALTH_PORT });

  server.listen(env.HEALTH_PORT, '0.0.0.0');

  const shutdown = async (): Promise<void> => {
    clearInterval(sheetsTimer);
    clearInterval(catalogueReconcileTimer);
    clearInterval(instagramProfileReconcileTimer);
    clearInterval(instagramMessageReconcileTimer);
    clearInterval(catalogueScheduleTimer);
    clearInterval(notificationRetentionTimer);
    if (telegramDeliveryTimer) clearInterval(telegramDeliveryTimer);
    clearInterval(procurementBackfillTimer);
    clearInterval(shipmentReconcileTimer);
    await deliveryWorker.close();
    await deliveryQueue.close();
    await telegramWorker?.close();
    await telegramQueue?.close();
    await worker.close();
    await instagramProfileQueue.close();
    await catalogueWorker.close();
    await catalogueQueue.close();
    await prisma.$disconnect();
    server.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

void bootstrap();
