CREATE TABLE "google_sheets_destinations" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "spreadsheet_id" TEXT NOT NULL,
  "sheet_name" TEXT NOT NULL,
  "required_headers" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "last_validated_at" TIMESTAMP(3),
  "error_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_sheets_destinations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "google_sheets_destinations_tenant_id_key" ON "google_sheets_destinations"("tenant_id");
ALTER TABLE "google_sheets_destinations" ADD CONSTRAINT "google_sheets_destinations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
