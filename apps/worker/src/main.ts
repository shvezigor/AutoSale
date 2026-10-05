import { Buffer } from 'node:buffer';

import { parseWorkerEnv } from '@autosale/config/worker-env';
import { retentionDryRunJobSchema, shipmentCreateJobSchema, telegramDeliveryJobSchema, tenantLifecycleJobSchema, ukrposhtaTrackingBatchJobSchema } from '@autosale/contracts';
import { createPrismaClient, PlatformChannelGate, ProcurementStore, withTenantTransaction } from '@autosale/database';
import {
  createGoogleSheetsAdapter,
  CredentialCipher,
  GoogleOAuthTokenProvider,
  GoogleSheetsAdapter,
  MetaInstagramClient,
  S3ObjectStorage,
  TikTokBusinessMessagingClient,
  TelegramBotClient,
  NovaPoshtaClient,
  UkrposhtaStatusTrackingClient,
} from '@autosale/integrations';
import { Queue, Worker } from 'bullmq';
import { metrics, StructuredLogger } from '@autosale/observability';

import { createWorkerHealthServer } from './health-server.js';
import { FacebookProcessor } from './facebook/facebook.processor.js';
import { InstagramProcessor } from './instagram/instagram.processor.js';
import { InstagramAvatarCleanupReconciler } from './instagram/instagram-avatar-cleanup-reconciler.js';
import { InstagramEventReconciler } from './instagram/instagram-event-reconciler.js';
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
import { resolveTelegramDeliveryAuthority } from './telegram/telegram-authority.js';
import { ShipmentCreateService } from './delivery/shipment-create.service.js';
import { UkrposhtaShipmentService } from './delivery/ukrposhta-shipment.service.js';
import { UkrposhtaClient } from '@autosale/integrations';
import { ShipmentReconciler } from './delivery/shipment-reconciler.js';
import { ShipmentStatusService } from './delivery/shipment-status.service.js';
import { UkrposhtaTrackingService } from './delivery/ukrposhta-tracking.service.js';
import { UserAvatarCleanupReconciler } from './profile/user-avatar-cleanup.reconciler.js';
import { TenantLifecycleProcessor } from './tenant-lifecycle/tenant-lifecycle.processor.js';
import { TenantLifecycleReconciler } from './tenant-lifecycle/tenant-lifecycle.reconciler.js';
import { RetentionDryRunProcessor } from './tenant-lifecycle/retention-dry-run.processor.js';
import { TikTokMediaCopyService } from './tiktok/tiktok-media-copy.service.js';
import { TikTokMessageDeliveryService } from './tiktok/tiktok-message-delivery.service.js';
import { TikTokMessageReconciler } from './tiktok/tiktok-message-reconciler.js';
import { TikTokProcessor } from './tiktok/tiktok.processor.js';
import { TikTokTokenService } from './tiktok/tiktok-token.service.js';
import { createOpenAiReplyDraftGenerator } from './reply-drafts/openai-reply-draft-generator.js';
import { ReplyDraftProcessor } from './reply-drafts/reply-draft.processor.js';
import { ReplyDraftReconciler } from './reply-drafts/reply-draft.reconciler.js';

async function bootstrap(): Promise<void> {
  const env = parseWorkerEnv(process.env);
  const logger = new StructuredLogger('worker');
  const server = createWorkerHealthServer();
  const prisma = createPrismaClient(env.DATABASE_URL);
  const platformChannelDeployment = {
    FACEBOOK_MESSENGER: env.FACEBOOK_MESSENGER_ENABLED,
    TIKTOK_BUSINESS_MESSAGING: env.TIKTOK_BUSINESS_MESSAGING_ENABLED
      && Boolean(env.TIKTOK_CLIENT_ID && env.TIKTOK_CLIENT_SECRET),
  } as const;
  const platformChannels = new PlatformChannelGate(prisma, platformChannelDeployment);
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
      findConnection: async (connectionId, tenantId) => withTenantTransaction(prisma, tenantId, (transaction) =>
        transaction.googleConnection.findFirst({
          where: { id: connectionId, tenantId },
          select: { id: true, tenantId: true, status: true, encryptedRefreshToken: true, credentialGenerationId: true },
        })),
      markReauthorizationRequired: async (tenantId, credentialGenerationId) => {
        await withTenantTransaction(prisma, tenantId, (transaction) => transaction.googleConnection.updateMany({
            where: { tenantId, credentialGenerationId },
            data: { status: 'REAUTHORIZATION_REQUIRED', lastErrorCode: 'GOOGLE_TOKEN_REFRESH_FAILED' },
          }));
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
      await withTenantTransaction(prisma, tenantId, async (transaction) => {
        const destination = await transaction.googleSheetsDestination.findUnique({ where: { tenantId } });
        if (!destination || destination.status !== 'ACTIVE') return;
        await transaction.orderExport.upsert({
          where: { orderId_destinationId: { orderId, destinationId: destination.id } },
          create: { tenantId, orderId, destinationId: destination.id },
          update: { status: 'PENDING', errorSummary: null },
        });
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
  const mediaCopy = new MediaCopyService(storage);
  const processor = new InstagramProcessor(prisma, mediaCopy, orderProcessor);
  const facebookProcessor = new FacebookProcessor(prisma, mediaCopy, orderProcessor);
  const tikTokClient = platformChannelDeployment.TIKTOK_BUSINESS_MESSAGING
    ? new TikTokBusinessMessagingClient({
        clientId: env.TIKTOK_CLIENT_ID!,
        clientSecret: env.TIKTOK_CLIENT_SECRET!,
        authorizationUrl: 'https://business-api.tiktok.com/',
      })
    : undefined;
  const tikTokTokenService = tikTokClient
    ? new TikTokTokenService(prisma, tikTokClient, credentialCipher)
    : undefined;
  const tikTokProcessor = tikTokClient && tikTokTokenService
    ? new TikTokProcessor(
        prisma,
        new TikTokMediaCopyService(storage, tikTokClient, tikTokTokenService, (tenantId) =>
          withTenantTransaction(prisma, tenantId, (transaction) => transaction.tikTokConnection.findFirst({
            where: { tenantId, status: { in: ['ACTIVE', 'INBOUND_ONLY'] } },
            select: { externalAccountId: true, credentialGenerationId: true },
          })).then((connection) => connection?.credentialGenerationId ? {
            externalAccountId: connection.externalAccountId,
            credentialGenerationId: connection.credentialGenerationId,
          } : null)),
        orderProcessor,
      )
    : undefined;
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
  const replyDraftQueue = new Queue('ai-replies', { connection: redisConnection });
  const replyDraftProcessor = new ReplyDraftProcessor(prisma,
    createOpenAiReplyDraftGenerator(env.OPENAI_API_KEY, env.OPENAI_MODEL));
  const replyDraftReconciler = new ReplyDraftReconciler(prisma, replyDraftQueue);
  const replyDraftWorker = new Worker('ai-replies', async (job) => {
    if (job.name !== 'ai-replies.generate') return;
    const started = performance.now();
    try {
      const result = await replyDraftProcessor.process(job.data);
      metrics.increment('autosale_operations_total', {
        operation: 'ai_reply_draft_generate',
        result: result === 'READY' || result === 'SKIPPED' ? 'success' : 'failure',
      });
      metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000,
        { operation: 'ai_reply_draft_generate' });
      logger.info('ai_reply_draft_completed', { correlationId: String(job.data?.draftId ?? 'unknown'), result });
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'ai_reply_draft_generate', result: 'failure' });
      logger.warn('ai_reply_draft_failed', {
        correlationId: String(job.data?.draftId ?? 'unknown'),
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
      throw error;
    }
  }, { connection: redisConnection, concurrency: 2 });
  const tenantLifecycleQueue = new Queue('tenant-lifecycle', { connection: redisConnection });
  const tenantLifecycleProcessor = new TenantLifecycleProcessor(prisma, storage);
  const retentionDryRunProcessor = new RetentionDryRunProcessor(prisma);
  const tenantLifecycleWorker = new Worker(
    'tenant-lifecycle',
    async (job) => {
      if (job.name === 'tenant-lifecycle.retention-dry-run') {
        const parsed = retentionDryRunJobSchema.safeParse(job.data);
        if (!parsed.success) {
          metrics.increment('autosale_operations_total', { operation: 'tenant_retention_dry_run', result: 'failure' });
          throw new Error('RETENTION_DRY_RUN_JOB_INVALID');
        }
        const started = performance.now();
        try {
          const result = await retentionDryRunProcessor.process(parsed.data);
          metrics.increment('autosale_operations_total', {
            operation: 'tenant_retention_dry_run',
            result: result.status === 'FAILED' ? 'failure' : 'success',
          });
          logger.info('tenant_retention_dry_run_completed', {
            correlationId: 'system:tenant-retention-dry-run', result: result.status,
          });
        } catch (error) {
          metrics.increment('autosale_operations_total', { operation: 'tenant_retention_dry_run', result: 'failure' });
          logger.warn('tenant_retention_dry_run_failed', {
            correlationId: 'system:tenant-retention-dry-run',
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          });
          throw error;
        } finally {
          metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000, {
            operation: 'tenant_retention_dry_run',
          });
        }
        return;
      }
      if (job.name !== 'tenant-lifecycle.export') return;
      const parsed = tenantLifecycleJobSchema.safeParse(job.data);
      if (!parsed.success) {
        metrics.increment('autosale_operations_total', { operation: 'tenant_lifecycle_export', result: 'failure' });
        throw new Error('TENANT_LIFECYCLE_JOB_INVALID');
      }
      const started = performance.now();
      try {
        const result = await tenantLifecycleProcessor.process(parsed.data);
        metrics.increment('autosale_operations_total', {
          operation: 'tenant_lifecycle_export',
          result: result === 'FAILED' ? 'failure' : 'success',
        });
        logger.info('tenant_lifecycle_export_completed', {
          correlationId: 'system:tenant-lifecycle-export',
          result,
        });
      } catch (error) {
        metrics.increment('autosale_operations_total', { operation: 'tenant_lifecycle_export', result: 'failure' });
        logger.warn('tenant_lifecycle_export_failed', {
          correlationId: 'system:tenant-lifecycle-export',
          errorCode: error instanceof Error ? error.name : 'UNKNOWN',
        });
        throw error;
      } finally {
        metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000, {
          operation: 'tenant_lifecycle_export',
        });
      }
    },
    { connection: redisConnection, concurrency: 1 },
  );
  const tenantLifecycleReconciler = new TenantLifecycleReconciler(
    prisma, tenantLifecycleQueue, storage,
  );
  const ukrposhtaShipment = new UkrposhtaShipmentService(prisma,
    (credentials) => new UkrposhtaClient({ ...credentials, sandboxShipmentsEnabled: env.UKRPOSHTA_SANDBOX_SHIPMENTS_ENABLED }),
    (encrypted) => credentialCipher.decrypt(encrypted), { enabled: env.UKRPOSHTA_SANDBOX_SHIPMENTS_ENABLED });
  const shipmentCreate = new ShipmentCreateService(
    prisma,
    (apiKey) => new NovaPoshtaClient({ apiKey }),
    (encrypted) => credentialCipher.decrypt(encrypted),
    undefined,
    ukrposhtaShipment,
  );
  const shipmentStatus = new ShipmentStatusService(
    prisma,
    (apiKey) => new NovaPoshtaClient({ apiKey }),
    (encrypted) => credentialCipher.decrypt(encrypted),
    undefined,
    ukrposhtaShipment,
  );
  const ukrposhtaTracking = new UkrposhtaTrackingService(
    prisma,
    (credentials) => ({
      lifecycle: new UkrposhtaClient({ ...credentials, sandboxShipmentsEnabled: env.UKRPOSHTA_SANDBOX_SHIPMENTS_ENABLED }),
      tracking: new UkrposhtaStatusTrackingClient({ trackingBearer: credentials.trackingBearer }),
    }),
    (encrypted) => credentialCipher.decrypt(encrypted),
  );
  const deliveryQueue = new Queue('delivery', { connection: redisConnection });
  const deliveryWorker = new Worker(
    'delivery',
    async (job) => {
      if (job.name === 'shipment.status.sync.ukrposhta') {
        const parsedBatch = ukrposhtaTrackingBatchJobSchema.safeParse(job.data);
        if (!parsedBatch.success) return;
        const started = performance.now();
        try {
          const result = await ukrposhtaTracking.processBatch(parsedBatch.data);
          metrics.increment('autosale_operations_total', { operation: 'shipment_status_sync', result: 'success' });
          logger.info('shipment_job_completed', { correlationId: parsedBatch.data.shipmentIds[0]!, shipmentIds: parsedBatch.data.shipmentIds, jobName: job.name, result });
        } catch (error) {
          metrics.increment('autosale_operations_total', { operation: 'shipment_status_sync', result: 'failure' });
          logger.warn('shipment_status_sync_failed', { correlationId: parsedBatch.data.shipmentIds[0]!, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
          throw error;
        } finally {
          metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000, { operation: 'shipment_status_sync' });
        }
        return;
      }
      if (job.name !== 'shipment.create' && job.name !== 'shipment.status.sync' && job.name !== 'shipment.cancel') return;
      const parsed = shipmentCreateJobSchema.safeParse(job.data);
      if (!parsed.success) return;
      const started = performance.now();
      try {
        const result = job.name === 'shipment.create'
          ? await shipmentCreate.process(parsed.data)
          : job.name === 'shipment.cancel' ? await shipmentStatus.cancel(parsed.data) : await shipmentStatus.process(parsed.data);
        metrics.increment('autosale_operations_total', {
          operation: job.name === 'shipment.create' ? 'shipment_create' : 'shipment_status_sync',
          result: result === 'CREATED' || result === 'UPDATED' || result === 'CANCELLED' || result === 'IGNORED' || result === 'RETRY' || result === 'UNKNOWN' ? 'success' : 'failure',
        });
        logger.info('shipment_job_completed', { correlationId: parsed.data.shipmentId, shipmentId: parsed.data.shipmentId, jobName: job.name, result });
      } catch (error) {
        const operation = job.name === 'shipment.create' ? 'shipment_create' : 'shipment_status_sync';
        metrics.increment('autosale_operations_total', { operation, result: 'failure' });
        logger.warn('shipment_create_failed', { correlationId: parsed.data.shipmentId, shipmentId: parsed.data.shipmentId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
        throw error;
      } finally {
        metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1_000, { operation: job.name === 'shipment.create' ? 'shipment_create' : 'shipment_status_sync' });
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
        const deliveryAuthority = await resolveTelegramDeliveryAuthority(prisma, parsed.data.deliveryId);
        const telegramOperation = deliveryAuthority?.purpose === 'SUPPLIER_ORDER'
          ? 'telegram_supplier_delivery'
          : deliveryAuthority?.purpose === 'PERSONAL_ALERT'
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
  const tikTokMessageDelivery = tikTokClient && tikTokTokenService
    ? new TikTokMessageDeliveryService(prisma, tikTokClient, tikTokTokenService, platformChannels)
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
        const trigger = await withTenantTransaction(prisma, job.data.tenantId, (transaction) => transaction.message.findFirst({
          where: { id: job.data.triggerMessageId, tenantId: job.data.tenantId },
          select: { id: true },
        }));
        if (!trigger) throw new Error('Manual order trigger message not found');
        await orderProcessor.process(job.data.tenantId, trigger.id);
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
        job.name === 'tiktok.message.send' &&
        typeof job.data?.tenantId === 'string' &&
        typeof job.data?.messageId === 'string'
      ) {
        if (!env.TIKTOK_BUSINESS_MESSAGING_ENABLED || !tikTokMessageDelivery) return;
        const started = performance.now();
        try {
          const result = await tikTokMessageDelivery.process({
            tenantId: job.data.tenantId,
            messageId: job.data.messageId,
          });
          metrics.increment('autosale_operations_total', {
            operation: 'tiktok_message_send',
            result: result === 'SENT' || result === 'IGNORED' || result === 'IGNORED_FROZEN' || result === 'RETRY'
              ? 'success'
              : 'failure',
          });
          logger.info('tiktok_message_send_completed', {
            correlationId: job.data.messageId,
            messageId: job.data.messageId,
            result,
          });
        } catch (error) {
          metrics.increment('autosale_operations_total', {
            operation: 'tiktok_message_send', result: 'failure',
          });
          logger.warn('tiktok_message_send_failed', {
            correlationId: job.data.messageId,
            messageId: job.data.messageId,
            errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          });
          throw error;
        } finally {
          metrics.observe(
            'autosale_operation_duration_seconds',
            (performance.now() - started) / 1000,
            { operation: 'tiktok_message_send' },
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
      if (job.name !== 'instagram.normalize' && job.name !== 'facebook.normalize' && job.name !== 'tiktok.normalize') return;
      if (typeof job.data?.tenantId !== 'string' || typeof job.data?.eventId !== 'string') return;
      if (
        job.name === 'facebook.normalize'
        && !await platformChannels.isEnabled('FACEBOOK_MESSENGER')
      ) return;
      if (
        job.name === 'tiktok.normalize'
        && (!tikTokProcessor || !await platformChannels.isEnabled('TIKTOK_BUSINESS_MESSAGING'))
      ) return;
      const correlationId = typeof job.data.correlationId === 'string' ? job.data.correlationId : job.data.eventId;
      const operation = job.name === 'facebook.normalize'
        ? 'facebook_normalize'
        : job.name === 'tiktok.normalize' ? 'tiktok_normalize' : 'instagram_normalize';
      const started = performance.now();
      try {
        const selectedProcessor = job.name === 'facebook.normalize'
          ? facebookProcessor
          : job.name === 'tiktok.normalize' ? tikTokProcessor! : processor;
        const result = await selectedProcessor.process(job.data.tenantId, job.data.eventId);
        metrics.increment('autosale_operations_total', {
          operation, result: result === 'IGNORED_FROZEN' ? 'skipped' : 'success',
        });
        if (result === 'IGNORED_FROZEN') {
          metrics.increment('autosale_tenant_lifecycle_freeze_rejections_total', {
            surface: 'ORDER_RECOGNITION', safe_reason: 'lifecycle_frozen',
          });
        }
        logger.info(`${operation}_completed`, { correlationId, eventId: job.data.eventId, jobId: job.id });
      } catch (error) {
        metrics.increment('autosale_operations_total', { operation, result: 'failure' });
        logger.error(`${operation}_failed`, { correlationId, eventId: job.data.eventId, jobId: job.id, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
        throw error;
      } finally {
        metrics.observe('autosale_operation_duration_seconds', (performance.now() - started) / 1000, { operation });
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
  const tikTokMessageReconciler = tikTokMessageDelivery
    ? new TikTokMessageReconciler(prisma, instagramProfileQueue, platformChannels)
    : undefined;
  const instagramAvatarCleanupReconciler = new InstagramAvatarCleanupReconciler(prisma, storage);
  const instagramQueue = new Queue('instagram', {
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
  const instagramReconciler = new InstagramEventReconciler(
    prisma,
    instagramQueue,
    (key) => platformChannels.isEnabled(key),
  );
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
  const userAvatarCleanup = new UserAvatarCleanupReconciler(prisma, storage);
  let polling = false;
  const pollExports = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      const pending = await prisma.$queryRaw<Array<{ tenant_id: string; export_id: string }>>`
        SELECT tenant_id, export_id FROM public.worker_due_order_exports(${10})
      `;
      metrics.set('autosale_queue_backlog', pending.length, { queue: 'google_sheets' });
      if (!sheetsProcessor) return;
      for (const record of pending) {
        const claimed = await withTenantTransaction(prisma, record.tenant_id, async (transaction) => {
          const result = await transaction.orderExport.updateMany({
            where: { id: record.export_id, tenantId: record.tenant_id, status: 'PENDING' },
            data: { status: 'PROCESSING' },
          });
          if (result.count !== 1) return null;
          return transaction.orderExport.findFirstOrThrow({
            where: { id: record.export_id, tenantId: record.tenant_id },
            select: { orderId: true, order: { select: { triggerMessage: { select: { rawEventId: true } } } } },
          });
        });
        if (claimed) {
          const orderId = claimed.orderId;
          const exportId = record.export_id;
          const tenantId = record.tenant_id;
          const orderContext = claimed.order;
          const correlationId = orderContext.triggerMessage.rawEventId;
          const started = performance.now();
          try {
            await sheetsProcessor.process(tenantId, exportId);
            metrics.increment('autosale_operations_total', { operation: 'sheets_export', result: 'success' });
            logger.info('sheets_export_completed', { correlationId, orderId, exportId });
          } catch (error) {
            metrics.increment('autosale_operations_total', { operation: 'sheets_export', result: 'failure' });
            logger.warn('sheets_export_failed', { correlationId, orderId, exportId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
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
  let reconcilingInstagramEvents = false;
  const reconcileInstagramEvents = async (): Promise<void> => {
    if (reconcilingInstagramEvents) return;
    reconcilingInstagramEvents = true;
    try {
      const result = await instagramReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'instagram' });
      if (result.skipped > 0) {
        metrics.increment('autosale_operations_total', {
          operation: 'social_event_reconcile', result: 'skipped',
        }, result.skipped);
      }
      if (result.failed > 0) {
        metrics.increment('autosale_operations_total', { operation: 'instagram_event_reconcile', result: 'failure' });
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'instagram_event_reconcile', result: 'failure' });
      logger.warn('instagram_event_reconcile_failed', { correlationId: 'system:instagram-event', errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
    } finally {
      reconcilingInstagramEvents = false;
    }
  };
  const instagramReconcileTimer = setInterval(() => void reconcileInstagramEvents(), 5_000);
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
  let reconcilingTikTokMessages = false;
  const reconcileTikTokMessages = async (): Promise<void> => {
    if (!tikTokMessageReconciler || reconcilingTikTokMessages) return;
    reconcilingTikTokMessages = true;
    try {
      const result = await tikTokMessageReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'tiktok_message' });
      metrics.increment('autosale_operations_total', {
        operation: 'tiktok_message_reconcile',
        result: result.queued === result.attempted ? 'success' : 'failure',
      });
      if (result.markedUnknown > 0) {
        logger.warn('tiktok_message_stale_delivery_unknown', {
          correlationId: 'system:tiktok-message', count: result.markedUnknown,
        });
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', {
        operation: 'tiktok_message_reconcile', result: 'failure',
      });
      logger.warn('tiktok_message_reconcile_failed', {
        correlationId: 'system:tiktok-message',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      reconcilingTikTokMessages = false;
    }
  };
  const tikTokMessageReconcileTimer = tikTokMessageReconciler
    ? setInterval(() => void reconcileTikTokMessages(), 5_000)
    : undefined;
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
  let reconcilingUserAvatars = false;
  const reconcileUserAvatars = async (): Promise<void> => {
    if (reconcilingUserAvatars) return;
    reconcilingUserAvatars = true;
    try {
      const result = await userAvatarCleanup.runOnce();
      metrics.set('autosale_queue_backlog', result.retried, { queue: 'user_avatar_cleanup' });
      if (result.deleted > 0 || result.deadLettered > 0) {
        logger.info('user_avatar_cleanup_completed', {
          correlationId: 'system:user-avatar-cleanup',
          ...result,
        });
      }
      if (result.deadLettered > 0) {
        metrics.increment('autosale_operations_total', {
          operation: 'user_avatar_cleanup',
          result: 'failure',
        }, result.deadLettered);
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', {
        operation: 'user_avatar_cleanup',
        result: 'failure',
      });
      logger.warn('user_avatar_cleanup_failed', {
        correlationId: 'system:user-avatar-cleanup',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      reconcilingUserAvatars = false;
    }
  };
  const userAvatarCleanupTimer = setInterval(() => void reconcileUserAvatars(), 60_000);
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
  let reconcilingTenantLifecycle = false;
  const reconcileTenantLifecycle = async (): Promise<void> => {
    if (reconcilingTenantLifecycle) return;
    reconcilingTenantLifecycle = true;
    try {
      const queued = await tenantLifecycleReconciler.reconcile();
      const retention = await tenantLifecycleReconciler.reconcileRetention();
      metrics.set('autosale_queue_backlog', queued.attempted + retention.attempted, { queue: 'tenant_lifecycle' });
      if (queued.failed + retention.failed > 0) {
        metrics.increment('autosale_operations_total', {
          operation: 'tenant_lifecycle_reconcile', result: 'failure',
        }, queued.failed + retention.failed);
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'tenant_lifecycle_reconcile', result: 'failure' });
      logger.warn('tenant_lifecycle_reconcile_failed', {
        correlationId: 'system:tenant-lifecycle-reconcile',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      reconcilingTenantLifecycle = false;
    }
  };
  const tenantLifecycleReconcileTimer = setInterval(() => void reconcileTenantLifecycle(), 5_000);
  let cleaningTenantLifecycleArtifacts = false;
  const cleanupTenantLifecycleArtifacts = async (): Promise<void> => {
    if (cleaningTenantLifecycleArtifacts) return;
    cleaningTenantLifecycleArtifacts = true;
    try {
      const cleanup = await tenantLifecycleReconciler.cleanupExpired();
      if (cleanup.failed > 0) {
        metrics.increment('autosale_operations_total', {
          operation: 'tenant_lifecycle_artifact_cleanup', result: 'failure',
        }, cleanup.failed);
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'tenant_lifecycle_artifact_cleanup', result: 'failure' });
      logger.warn('tenant_lifecycle_artifact_cleanup_failed', {
        correlationId: 'system:tenant-lifecycle-artifact-cleanup',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      cleaningTenantLifecycleArtifacts = false;
    }
  };
  const tenantLifecycleCleanupTimer = setInterval(() => void cleanupTenantLifecycleArtifacts(), 60_000);
  let reconcilingReplyDrafts = false;
  const reconcileReplyDrafts = async (): Promise<void> => {
    if (reconcilingReplyDrafts) return;
    reconcilingReplyDrafts = true;
    try {
      const result = await replyDraftReconciler.reconcile();
      metrics.set('autosale_queue_backlog', result.attempted, { queue: 'ai_replies' });
      if (result.expiredFailed > 0) {
        metrics.increment('autosale_operations_total', {
          operation: 'ai_reply_draft_expired', result: 'failure',
        }, result.expiredFailed);
      }
    } catch (error) {
      metrics.increment('autosale_operations_total', { operation: 'ai_reply_draft_reconcile', result: 'failure' });
      logger.warn('ai_reply_draft_reconcile_failed', {
        correlationId: 'system:ai-reply-drafts', errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      });
    } finally {
      reconcilingReplyDrafts = false;
    }
  };
  const replyDraftReconcileTimer = setInterval(() => void reconcileReplyDrafts(), 5_000);
  void pollExports();
  void reconcileCatalogueMappings();
  void reconcileInstagramEvents();
  void reconcileInstagramProfiles();
  void reconcileInstagramMessages();
  void reconcileTikTokMessages();
  void scheduleCatalogueSources();
  void reconcileNotificationRetention();
  void reconcileUserAvatars();
  void reconcileTelegramDeliveries();
  void reconcileProcurementBackfill();
  void reconcileShipments();
  void reconcileTenantLifecycle();
  void cleanupTenantLifecycleArtifacts();
  void reconcileReplyDrafts();
  logger.info('service_started', { correlationId: 'system:startup', healthPort: env.HEALTH_PORT });

  server.listen(env.HEALTH_PORT, '0.0.0.0');

  const shutdown = async (): Promise<void> => {
    clearInterval(sheetsTimer);
    clearInterval(catalogueReconcileTimer);
    clearInterval(instagramReconcileTimer);
    clearInterval(instagramProfileReconcileTimer);
    clearInterval(instagramMessageReconcileTimer);
    if (tikTokMessageReconcileTimer) clearInterval(tikTokMessageReconcileTimer);
    clearInterval(catalogueScheduleTimer);
    clearInterval(notificationRetentionTimer);
    clearInterval(userAvatarCleanupTimer);
    if (telegramDeliveryTimer) clearInterval(telegramDeliveryTimer);
    clearInterval(procurementBackfillTimer);
    clearInterval(shipmentReconcileTimer);
    clearInterval(tenantLifecycleReconcileTimer);
    clearInterval(tenantLifecycleCleanupTimer);
    clearInterval(replyDraftReconcileTimer);
    await replyDraftWorker.close();
    await replyDraftQueue.close();
    await tenantLifecycleWorker.close();
    await tenantLifecycleQueue.close();
    await deliveryWorker.close();
    await deliveryQueue.close();
    await telegramWorker?.close();
    await telegramQueue?.close();
    await worker.close();
    await instagramQueue.close();
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
