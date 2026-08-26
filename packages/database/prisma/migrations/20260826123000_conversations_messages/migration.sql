CREATE TABLE "conversations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "external_conversation_id" TEXT NOT NULL,
  "participant_id" TEXT NOT NULL,
  "display_name" TEXT,
  "last_message_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "raw_event_id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "external_message_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "text" TEXT,
  "source_timestamp" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attachments" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "original_url" TEXT NOT NULL,
  "storage_key" TEXT,
  "checksum" TEXT,
  "copy_status" TEXT NOT NULL DEFAULT 'PENDING',
  "failure_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_tenant_id_channel_external_conversation_id_key"
  ON "conversations"("tenant_id", "channel", "external_conversation_id");
CREATE INDEX "conversations_tenant_id_last_message_at_idx"
  ON "conversations"("tenant_id", "last_message_at");
CREATE UNIQUE INDEX "messages_tenant_id_channel_external_message_id_key"
  ON "messages"("tenant_id", "channel", "external_message_id");
CREATE INDEX "messages_conversation_id_source_timestamp_idx"
  ON "messages"("conversation_id", "source_timestamp");
CREATE INDEX "attachments_copy_status_created_at_idx"
  ON "attachments"("copy_status", "created_at");
CREATE INDEX "attachments_checksum_idx" ON "attachments"("checksum");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_raw_event_id_fkey"
  FOREIGN KEY ("raw_event_id") REFERENCES "webhook_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
