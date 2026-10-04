ALTER TABLE "messages"
  ADD COLUMN "delivery_credential_generation_id" UUID;

CREATE INDEX "messages_tenant_id_delivery_credential_generation_id_idx"
  ON "messages"("tenant_id", "delivery_credential_generation_id");
