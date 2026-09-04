CREATE TYPE "NotificationType" AS ENUM ('SUCCESS', 'ERROR', 'WARNING', 'INFO');

CREATE TABLE "user_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "action_url" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_notifications_tenant_id_user_id_created_at_idx"
ON "user_notifications"("tenant_id", "user_id", "created_at" DESC);

CREATE INDEX "user_notifications_tenant_id_user_id_read_at_idx"
ON "user_notifications"("tenant_id", "user_id", "read_at");

ALTER TABLE "user_notifications"
ADD CONSTRAINT "user_notifications_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_notifications"
ADD CONSTRAINT "user_notifications_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
