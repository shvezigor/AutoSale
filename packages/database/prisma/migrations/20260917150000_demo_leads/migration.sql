CREATE TYPE "DemoLeadLifecycleStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED');
CREATE TYPE "DemoLeadNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "demo_leads" (
  "id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "order_volume" TEXT NOT NULL,
  "note" TEXT,
  "locale" TEXT NOT NULL,
  "consent_version" TEXT NOT NULL DEFAULT '2026-09-17',
  "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lifecycle_status" "DemoLeadLifecycleStatus" NOT NULL DEFAULT 'NEW',
  "notification_status" "DemoLeadNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "notification_attempts" INTEGER NOT NULL DEFAULT 0,
  "notified_at" TIMESTAMP(3),
  "last_notification_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demo_leads_idempotency_key_key" ON "demo_leads"("idempotency_key");
CREATE INDEX "demo_leads_lifecycle_status_created_at_idx" ON "demo_leads"("lifecycle_status", "created_at");
CREATE INDEX "demo_leads_notification_status_created_at_idx" ON "demo_leads"("notification_status", "created_at");
