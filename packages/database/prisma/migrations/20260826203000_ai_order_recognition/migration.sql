CREATE TABLE "tenant_settings" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "approval_mode" TEXT NOT NULL DEFAULT 'ALWAYS',
  "auto_approval_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  "prompt_version" TEXT NOT NULL DEFAULT 'instagram-order-v1',
  "trigger_phrases" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "trigger_message_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AI_PROCESSING',
  "extraction" JSONB,
  "validation_issues" JSONB,
  "overall_confidence" DOUBLE PRECISION,
  "ai_response_id" TEXT,
  "ai_model" TEXT,
  "prompt_version" TEXT NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "approved_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "catalog_id" TEXT,
  "original_text" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "color" TEXT,
  "size" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");
CREATE UNIQUE INDEX "orders_trigger_message_id_key" ON "orders"("trigger_message_id");
CREATE INDEX "orders_tenant_id_status_created_at_idx" ON "orders"("tenant_id", "status", "created_at");
CREATE INDEX "orders_conversation_id_created_at_idx" ON "orders"("conversation_id", "created_at");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
