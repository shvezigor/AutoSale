ALTER TABLE "demo_leads"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_operator_action_at" TIMESTAMP(3);

CREATE INDEX "demo_leads_created_at_id_idx" ON "demo_leads"("created_at", "id");
