ALTER TABLE "tenant_settings"
ADD COLUMN "intent_detection_mode" TEXT NOT NULL DEFAULT 'PHRASE_ONLY';

CREATE TABLE "order_intent_evaluations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "anchor_message_id" UUID NOT NULL,
  "order_id" UUID,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "ai_response_id" TEXT,
  "ai_model" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "latency_ms" INTEGER,
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_intent_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_intent_evaluations_anchor_message_id_key" ON "order_intent_evaluations"("anchor_message_id");
CREATE UNIQUE INDEX "order_intent_evaluations_order_id_key" ON "order_intent_evaluations"("order_id");
CREATE INDEX "order_intent_evaluations_tenant_id_status_created_at_idx" ON "order_intent_evaluations"("tenant_id", "status", "created_at");
CREATE INDEX "order_intent_evaluations_conversation_id_created_at_idx" ON "order_intent_evaluations"("conversation_id", "created_at");

ALTER TABLE "order_intent_evaluations" ADD CONSTRAINT "order_intent_evaluations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_intent_evaluations" ADD CONSTRAINT "order_intent_evaluations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_intent_evaluations" ADD CONSTRAINT "order_intent_evaluations_anchor_message_id_fkey" FOREIGN KEY ("anchor_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_intent_evaluations" ADD CONSTRAINT "order_intent_evaluations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
