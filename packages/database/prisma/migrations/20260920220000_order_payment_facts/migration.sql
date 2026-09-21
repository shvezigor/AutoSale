CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CASH_ON_DELIVERY', 'OTHER');

CREATE TABLE "order_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "bank_account_id" UUID,
  "carrier" TEXT,
  "note" TEXT,
  "created_by" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "cancelled_at" TIMESTAMP(3),
  "cancelled_by" UUID,
  "cancellation_reason" TEXT,
  "cancellation_idempotency_key" UUID,
  "cancellation_request_hash" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_payments_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "order_payments_currency_length" CHECK (char_length("currency") = 3),
  CONSTRAINT "order_payments_cancellation_complete" CHECK (
    ("cancelled_at" IS NULL AND "cancelled_by" IS NULL AND "cancellation_reason" IS NULL AND "cancellation_idempotency_key" IS NULL AND "cancellation_request_hash" IS NULL)
    OR
    ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancellation_reason" IS NOT NULL AND "cancellation_idempotency_key" IS NOT NULL AND "cancellation_request_hash" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "order_payments_tenant_id_idempotency_key_key"
  ON "order_payments"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "order_payments_tenant_id_cancellation_idempotency_key_key"
  ON "order_payments"("tenant_id", "cancellation_idempotency_key");
CREATE INDEX "order_payments_tenant_id_order_id_received_at_idx"
  ON "order_payments"("tenant_id", "order_id", "received_at" DESC);
CREATE INDEX "order_payments_tenant_id_order_id_cancelled_at_idx"
  ON "order_payments"("tenant_id", "order_id", "cancelled_at");

ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_bank_account_id_fkey"
  FOREIGN KEY ("bank_account_id") REFERENCES "tenant_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
