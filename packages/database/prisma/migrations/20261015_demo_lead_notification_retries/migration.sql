ALTER TABLE "demo_leads"
  ADD COLUMN "notification_next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "notification_lease_id" UUID,
  ADD COLUMN "notification_lease_expires_at" TIMESTAMP(3);

UPDATE "demo_leads"
SET "notification_next_attempt_at" = CURRENT_TIMESTAMP
WHERE "notification_status" IN ('PENDING', 'FAILED')
  AND "notification_attempts" < 4;

CREATE INDEX "demo_leads_notification_status_notification_next_attempt_at_idx"
  ON "demo_leads"("notification_status", "notification_next_attempt_at");
