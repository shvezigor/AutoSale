ALTER TABLE "tenants"
ADD COLUMN "status" "AccessStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "tenants_status_idx" ON "tenants"("status");
