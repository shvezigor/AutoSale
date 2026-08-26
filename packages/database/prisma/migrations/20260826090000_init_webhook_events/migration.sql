CREATE TABLE "tenants" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_key_key" ON "tenants"("key");
CREATE UNIQUE INDEX "webhook_events_tenant_id_provider_external_event_id_key"
  ON "webhook_events"("tenant_id", "provider", "external_event_id");
CREATE INDEX "webhook_events_status_received_at_idx"
  ON "webhook_events"("status", "received_at");

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
