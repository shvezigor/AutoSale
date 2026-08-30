CREATE TABLE "instagram_connections" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "external_account_id" TEXT NOT NULL,
  "display_name" TEXT,
  "status" "AccessStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "instagram_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instagram_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "instagram_connections_tenant_id_key" ON "instagram_connections"("tenant_id");
CREATE UNIQUE INDEX "instagram_connections_external_account_id_key" ON "instagram_connections"("external_account_id");
CREATE INDEX "instagram_connections_status_idx" ON "instagram_connections"("status");
