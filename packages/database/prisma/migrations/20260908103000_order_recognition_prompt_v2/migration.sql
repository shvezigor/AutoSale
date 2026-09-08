ALTER TABLE "tenant_settings"
  ALTER COLUMN "prompt_version" SET DEFAULT 'instagram-order-v2';

UPDATE "tenant_settings"
SET "prompt_version" = 'instagram-order-v2',
    "updated_at" = NOW()
WHERE "prompt_version" = 'instagram-order-v1';
