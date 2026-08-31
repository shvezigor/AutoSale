CREATE TYPE "CatalogueSourceType" AS ENUM ('XLSX_UPLOAD', 'CSV_UPLOAD', 'GOOGLE_SHEETS');
CREATE TYPE "CatalogueSourceStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "CatalogueImportStatus" AS ENUM ('UPLOADED', 'MAPPING', 'MAPPING_REVIEW', 'PREVIEW_READY', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TABLE "products"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "price" DECIMAL(12,2),
  ADD COLUMN "currency" VARCHAR(3),
  ADD COLUMN "stock_quantity" INTEGER,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "color" TEXT,
  ADD COLUMN "size" TEXT,
  ADD COLUMN "image_urls" JSONB,
  ADD COLUMN "attributes" JSONB,
  ADD COLUMN "source_id" UUID,
  ADD COLUMN "source_row_key" TEXT,
  ADD COLUMN "source_updated_at" TIMESTAMP(3);

CREATE TABLE "catalogue_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "type" "CatalogueSourceType" NOT NULL,
  "display_name" TEXT NOT NULL,
  "status" "CatalogueSourceStatus" NOT NULL DEFAULT 'PENDING',
  "created_by_user_id" UUID,
  "spreadsheet_id" TEXT,
  "sheet_name" TEXT,
  "credential_ref" TEXT,
  "sync_schedule" TEXT,
  "header_fingerprint" TEXT,
  "last_synced_at" TIMESTAMP(3),
  "last_error_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catalogue_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogue_sources_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "catalogue_sources_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "catalogue_mappings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "source_fingerprint" TEXT NOT NULL,
  "columns" JSONB NOT NULL,
  "transform_settings" JSONB,
  "ai_model" TEXT,
  "prompt_version" TEXT,
  "schema_version" TEXT,
  "ai_latency_ms" INTEGER,
  "ai_input_tokens" INTEGER,
  "ai_output_tokens" INTEGER,
  "owner_modified" BOOLEAN NOT NULL DEFAULT false,
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catalogue_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogue_mappings_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "catalogue_mappings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "catalogue_mappings_tenant_id_source_id_fkey"
    FOREIGN KEY ("tenant_id", "source_id") REFERENCES "catalogue_sources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "catalogue_import_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "mapping_id" UUID,
  "requested_by_user_id" UUID,
  "status" "CatalogueImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "idempotency_key" TEXT NOT NULL,
  "source_revision" TEXT,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "valid_rows" INTEGER NOT NULL DEFAULT 0,
  "created_rows" INTEGER NOT NULL DEFAULT 0,
  "updated_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "row_errors" JSONB,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "catalogue_import_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "catalogue_import_runs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "catalogue_import_runs_tenant_id_source_id_fkey"
    FOREIGN KEY ("tenant_id", "source_id") REFERENCES "catalogue_sources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "catalogue_import_runs_tenant_id_mapping_id_fkey"
    FOREIGN KEY ("tenant_id", "mapping_id") REFERENCES "catalogue_mappings"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "products"
  ADD CONSTRAINT "products_tenant_id_source_id_fkey"
  FOREIGN KEY ("tenant_id", "source_id") REFERENCES "catalogue_sources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "catalogue_sources_tenant_id_status_idx" ON "catalogue_sources"("tenant_id", "status");
CREATE UNIQUE INDEX "catalogue_mappings_source_id_version_key" ON "catalogue_mappings"("source_id", "version");
CREATE INDEX "catalogue_mappings_tenant_id_source_id_idx" ON "catalogue_mappings"("tenant_id", "source_id");
CREATE UNIQUE INDEX "catalogue_import_runs_tenant_id_idempotency_key_key" ON "catalogue_import_runs"("tenant_id", "idempotency_key");
CREATE INDEX "catalogue_import_runs_source_id_created_at_idx" ON "catalogue_import_runs"("source_id", "created_at");
