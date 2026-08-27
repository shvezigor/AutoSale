CREATE TABLE "order_exports" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "destination_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "row_number" INTEGER,
  "last_attempt_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "error_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_exports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_exports_order_id_destination_id_key" ON "order_exports"("order_id", "destination_id");
CREATE INDEX "order_exports_status_updated_at_idx" ON "order_exports"("status", "updated_at");
ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
