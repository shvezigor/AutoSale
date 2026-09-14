ALTER TABLE "shipment_status_events"
  ADD COLUMN "provider_event_key" TEXT,
  ADD COLUMN "raw_snapshot" JSONB,
  ADD COLUMN "mapping_version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "shipment_status_events_tenant_id_shipment_id_provider_event_key_key"
  ON "shipment_status_events"("tenant_id", "shipment_id", "provider_event_key");
