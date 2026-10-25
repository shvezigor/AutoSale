CREATE TYPE "ConversationWorkflowStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');
ALTER TABLE "conversations"
  ADD COLUMN "workflow_status" "ConversationWorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "status_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status_changed_at" TIMESTAMP(3),
  ADD COLUMN "status_changed_by_user_id" UUID;
CREATE INDEX "conversations_tenant_status_last_message_id_idx"
  ON "conversations" ("tenant_id", "workflow_status", "last_message_at" DESC, "id" DESC);
