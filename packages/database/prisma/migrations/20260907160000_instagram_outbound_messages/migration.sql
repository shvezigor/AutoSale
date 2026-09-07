CREATE TYPE "OutboundDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN');

ALTER TABLE "messages"
  ALTER COLUMN "raw_event_id" DROP NOT NULL,
  ADD COLUMN "client_idempotency_key" UUID,
  ADD COLUMN "sent_by_user_id" UUID,
  ADD COLUMN "provider_message_id" TEXT,
  ADD COLUMN "delivery_status" "OutboundDeliveryStatus",
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "delivery_lease_id" UUID,
  ADD COLUMN "delivery_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "next_delivery_attempt_at" TIMESTAMP(3),
  ADD COLUMN "last_delivery_attempt_at" TIMESTAMP(3),
  ADD COLUMN "delivery_error_code" TEXT;

CREATE UNIQUE INDEX "messages_tenant_client_idempotency_key_key"
  ON "messages"("tenant_id", "client_idempotency_key")
  WHERE "client_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX "messages_tenant_provider_message_id_key"
  ON "messages"("tenant_id", "provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;

CREATE INDEX "messages_delivery_status_next_attempt_idx"
  ON "messages"("delivery_status", "next_delivery_attempt_at");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_sent_by_user_id_fkey"
    FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "messages_local_source_check"
    CHECK ("raw_event_id" IS NOT NULL OR "client_idempotency_key" IS NOT NULL),
  ADD CONSTRAINT "messages_delivery_direction_check"
    CHECK ("delivery_status" IS NULL OR "direction" = 'OUTBOUND');
