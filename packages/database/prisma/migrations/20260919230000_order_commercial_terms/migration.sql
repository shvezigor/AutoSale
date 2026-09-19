CREATE TYPE "LegalEntityType" AS ENUM ('COMPANY', 'SOLE_PROPRIETOR', 'OTHER');
CREATE TYPE "CommercialPricingStatus" AS ENUM ('READY', 'NEEDS_REVIEW');

CREATE TABLE "tenant_legal_entities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "display_name" TEXT NOT NULL,
  "legal_name" TEXT NOT NULL,
  "type" "LegalEntityType" NOT NULL,
  "registration_id" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_legal_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_bank_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "legal_entity_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "iban" TEXT NOT NULL,
  "normalized_iban" TEXT NOT NULL,
  "bank_name" TEXT,
  "currency" VARCHAR(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_commercial_terms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "legal_entity_id" UUID,
  "bank_account_id" UUID,
  "currency" VARCHAR(3),
  "items_subtotal" DECIMAL(14,2),
  "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "delivery_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(14,2),
  "pricing_status" "CommercialPricingStatus" NOT NULL,
  "issue_codes" JSONB NOT NULL,
  "legal_entity_snapshot" JSONB,
  "bank_account_snapshot" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_commercial_terms_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_items"
  ADD COLUMN "unit_price_snapshot" DECIMAL(14,2),
  ADD COLUMN "currency_snapshot" VARCHAR(3),
  ADD COLUMN "line_total_snapshot" DECIMAL(14,2),
  ADD COLUMN "price_source_sku" TEXT;

CREATE UNIQUE INDEX "tenant_legal_entities_tenant_id_display_name_key"
  ON "tenant_legal_entities"("tenant_id", "display_name");
CREATE INDEX "tenant_legal_entities_tenant_id_active_idx"
  ON "tenant_legal_entities"("tenant_id", "active");
CREATE UNIQUE INDEX "tenant_legal_entities_one_default"
  ON "tenant_legal_entities"("tenant_id") WHERE "active" = TRUE AND "is_default" = TRUE;

CREATE UNIQUE INDEX "tenant_bank_accounts_tenant_id_normalized_iban_currency_key"
  ON "tenant_bank_accounts"("tenant_id", "normalized_iban", "currency");
CREATE INDEX "tenant_bank_accounts_tenant_id_legal_entity_id_currency_active_idx"
  ON "tenant_bank_accounts"("tenant_id", "legal_entity_id", "currency", "active");
CREATE UNIQUE INDEX "tenant_bank_accounts_one_default_per_currency"
  ON "tenant_bank_accounts"("legal_entity_id", "currency") WHERE "active" = TRUE AND "is_default" = TRUE;

CREATE UNIQUE INDEX "order_commercial_terms_order_id_key" ON "order_commercial_terms"("order_id");
CREATE INDEX "order_commercial_terms_tenant_id_pricing_status_idx"
  ON "order_commercial_terms"("tenant_id", "pricing_status");

ALTER TABLE "tenant_legal_entities" ADD CONSTRAINT "tenant_legal_entities_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_bank_accounts" ADD CONSTRAINT "tenant_bank_accounts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_bank_accounts" ADD CONSTRAINT "tenant_bank_accounts_legal_entity_id_fkey"
  FOREIGN KEY ("legal_entity_id") REFERENCES "tenant_legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_commercial_terms" ADD CONSTRAINT "order_commercial_terms_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_commercial_terms" ADD CONSTRAINT "order_commercial_terms_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_commercial_terms" ADD CONSTRAINT "order_commercial_terms_legal_entity_id_fkey"
  FOREIGN KEY ("legal_entity_id") REFERENCES "tenant_legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_commercial_terms" ADD CONSTRAINT "order_commercial_terms_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "tenant_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
