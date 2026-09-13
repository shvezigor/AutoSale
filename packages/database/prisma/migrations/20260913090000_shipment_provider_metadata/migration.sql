-- Provider checkpoints remain on the existing tenant-owned, fenced shipment intent.
ALTER TABLE "shipments" ADD COLUMN "provider_metadata" JSONB;
