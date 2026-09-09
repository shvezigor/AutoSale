CREATE TABLE "telegram_supplier_settings" (
  "tenant_id" UUID NOT NULL,
  "destination_id" UUID NOT NULL,
  "auto_dispatch" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_supplier_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE UNIQUE INDEX "telegram_supplier_settings_tenant_id_destination_id_key"
  ON "telegram_supplier_settings"("tenant_id", "destination_id");

ALTER TABLE "telegram_supplier_settings"
  ADD CONSTRAINT "telegram_supplier_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telegram_supplier_settings"
  ADD CONSTRAINT "telegram_supplier_settings_tenant_id_destination_id_fkey"
  FOREIGN KEY ("tenant_id", "destination_id") REFERENCES "telegram_chats"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
