-- Sources created before next_sync_at was introduced need one durable due time
-- so the scheduler can discover them. Manual and non-active sources stay idle.
UPDATE "catalogue_sources"
SET "next_sync_at" = CURRENT_TIMESTAMP
WHERE "type" = 'GOOGLE_SHEETS'
  AND "status" = 'ACTIVE'
  AND "sync_schedule" IN ('HOURLY', 'DAILY')
  AND "next_sync_at" IS NULL;
