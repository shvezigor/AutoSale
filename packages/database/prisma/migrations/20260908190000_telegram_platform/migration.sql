CREATE TYPE "TelegramLinkPurpose" AS ENUM ('PERSONAL', 'SUPPLIER_GROUP');
CREATE TYPE "TelegramChatRoute" AS ENUM ('BOT', 'BUSINESS');
CREATE TYPE "TelegramDeliveryPurpose" AS ENUM ('TEST', 'SUPPLIER_ORDER', 'PERSONAL_ALERT');
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRYABLE', 'FAILED');

CREATE TABLE "telegram_link_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "token_hash" TEXT NOT NULL,
  "tenant_id" UUID NOT NULL, "user_id" UUID NOT NULL, "purpose" "TelegramLinkPurpose" NOT NULL,
  "return_path" TEXT NOT NULL DEFAULT '/settings?tab=telegram', "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_link_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_user_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "user_id" UUID NOT NULL,
  "telegram_user_id" TEXT NOT NULL, "private_chat_id" TEXT NOT NULL, "display_name" TEXT, "username" TEXT,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revoked_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_user_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_business_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL,
  "external_connection_id" TEXT NOT NULL, "telegram_user_id" TEXT NOT NULL, "rights" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "last_updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_business_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_chats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "external_chat_id" TEXT NOT NULL,
  "type" TEXT NOT NULL, "title" TEXT, "route" "TelegramChatRoute" NOT NULL, "business_connection_id" TEXT,
  "last_observed_at" TIMESTAMP(3) NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_webhook_updates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "update_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED', "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_webhook_updates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "tenant_id" UUID NOT NULL, "destination_id" UUID NOT NULL,
  "purpose" "TelegramDeliveryPurpose" NOT NULL, "status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL, "message_text" TEXT NOT NULL, "provider_message_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0, "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_attempt_at" TIMESTAMP(3), "lease_id" UUID, "lease_expires_at" TIMESTAMP(3), "last_error_code" TEXT,
  "completed_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_link_attempts_token_hash_key" ON "telegram_link_attempts"("token_hash");
CREATE INDEX "telegram_link_attempts_tenant_id_user_id_purpose_used_at_idx" ON "telegram_link_attempts"("tenant_id", "user_id", "purpose", "used_at");
CREATE INDEX "telegram_link_attempts_expires_at_used_at_idx" ON "telegram_link_attempts"("expires_at", "used_at");
CREATE UNIQUE INDEX "telegram_user_bindings_tenant_id_user_id_key" ON "telegram_user_bindings"("tenant_id", "user_id");
CREATE UNIQUE INDEX "telegram_user_bindings_tenant_id_telegram_user_id_key" ON "telegram_user_bindings"("tenant_id", "telegram_user_id");
CREATE INDEX "telegram_user_bindings_tenant_id_revoked_at_idx" ON "telegram_user_bindings"("tenant_id", "revoked_at");
CREATE UNIQUE INDEX "telegram_business_connections_tenant_id_external_connection_id_key" ON "telegram_business_connections"("tenant_id", "external_connection_id");
CREATE INDEX "telegram_business_connections_tenant_id_telegram_user_id_enabled_idx" ON "telegram_business_connections"("tenant_id", "telegram_user_id", "enabled");
CREATE UNIQUE INDEX "telegram_chats_tenant_id_id_key" ON "telegram_chats"("tenant_id", "id");
CREATE UNIQUE INDEX "telegram_chats_tenant_id_external_chat_id_route_key" ON "telegram_chats"("tenant_id", "external_chat_id", "route");
CREATE INDEX "telegram_chats_tenant_id_last_observed_at_idx" ON "telegram_chats"("tenant_id", "last_observed_at");
CREATE UNIQUE INDEX "telegram_webhook_updates_update_id_key" ON "telegram_webhook_updates"("update_id");
CREATE INDEX "telegram_webhook_updates_status_created_at_idx" ON "telegram_webhook_updates"("status", "created_at");
CREATE UNIQUE INDEX "telegram_deliveries_tenant_id_idempotency_key_key" ON "telegram_deliveries"("tenant_id", "idempotency_key");
CREATE INDEX "telegram_deliveries_status_next_attempt_at_idx" ON "telegram_deliveries"("status", "next_attempt_at");
CREATE INDEX "telegram_deliveries_lease_expires_at_idx" ON "telegram_deliveries"("lease_expires_at");

ALTER TABLE "telegram_link_attempts" ADD CONSTRAINT "telegram_link_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_link_attempts" ADD CONSTRAINT "telegram_link_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_user_bindings" ADD CONSTRAINT "telegram_user_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_user_bindings" ADD CONSTRAINT "telegram_user_bindings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_business_connections" ADD CONSTRAINT "telegram_business_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_tenant_id_destination_id_fkey" FOREIGN KEY ("tenant_id", "destination_id") REFERENCES "telegram_chats"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
