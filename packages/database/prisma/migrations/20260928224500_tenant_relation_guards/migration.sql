-- Tenant-owned references must agree on tenant_id even when an application bug
-- supplies a globally valid UUID from another tenant.

CREATE UNIQUE INDEX "webhook_events_tenant_id_id_key" ON "webhook_events"("tenant_id", "id");
CREATE UNIQUE INDEX "conversations_tenant_id_id_key" ON "conversations"("tenant_id", "id");
CREATE UNIQUE INDEX "messages_tenant_id_id_key" ON "messages"("tenant_id", "id");
CREATE UNIQUE INDEX "google_sheets_destinations_tenant_id_id_key"
  ON "google_sheets_destinations"("tenant_id", "id");
CREATE UNIQUE INDEX "tenant_legal_entities_tenant_id_id_key"
  ON "tenant_legal_entities"("tenant_id", "id");
CREATE UNIQUE INDEX "tenant_bank_accounts_tenant_id_id_key"
  ON "tenant_bank_accounts"("tenant_id", "id");
CREATE UNIQUE INDEX "order_commercial_terms_tenant_id_order_id_key"
  ON "order_commercial_terms"("tenant_id", "order_id");

ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_fkey";
ALTER TABLE "messages" DROP CONSTRAINT "messages_raw_event_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_fkey"
  FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_raw_event_id_fkey"
  FOREIGN KEY ("tenant_id", "raw_event_id") REFERENCES "webhook_events"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders" DROP CONSTRAINT "orders_conversation_id_fkey";
ALTER TABLE "orders" DROP CONSTRAINT "orders_trigger_message_id_fkey";
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_conversation_id_fkey"
  FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_trigger_message_id_fkey"
  FOREIGN KEY ("tenant_id", "trigger_message_id") REFERENCES "messages"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenant_bank_accounts" DROP CONSTRAINT "tenant_bank_accounts_legal_entity_id_fkey";
ALTER TABLE "tenant_bank_accounts" ADD CONSTRAINT "tenant_bank_accounts_tenant_id_legal_entity_id_fkey"
  FOREIGN KEY ("tenant_id", "legal_entity_id") REFERENCES "tenant_legal_entities"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_commercial_terms" DROP CONSTRAINT "order_commercial_terms_order_id_fkey";
ALTER TABLE "order_commercial_terms" ADD CONSTRAINT "order_commercial_terms_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_exports" DROP CONSTRAINT "order_exports_order_id_fkey";
ALTER TABLE "order_exports" DROP CONSTRAINT "order_exports_destination_id_fkey";
ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_exports" ADD CONSTRAINT "order_exports_tenant_id_destination_id_fkey"
  FOREIGN KEY ("tenant_id", "destination_id") REFERENCES "google_sheets_destinations"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_order_id_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable historical references keep their original ON DELETE SET NULL
-- semantics. A trigger validates tenant ownership without making tenant_id part
-- of a SET NULL composite foreign key.
CREATE FUNCTION "assert_tenant_owned_reference"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reference_id uuid;
  reference_tenant_id uuid;
BEGIN
  reference_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', TG_ARGV[1])
    INTO reference_tenant_id USING reference_id;

  IF reference_tenant_id IS NULL OR reference_tenant_id <> NEW.tenant_id THEN
    RAISE foreign_key_violation USING
      MESSAGE = format('%s.%s must reference the same tenant', TG_TABLE_NAME, TG_ARGV[0]);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "order_commercial_terms_legal_entity_tenant_guard"
  BEFORE INSERT OR UPDATE OF "tenant_id", "legal_entity_id" ON "order_commercial_terms"
  FOR EACH ROW EXECUTE FUNCTION "assert_tenant_owned_reference"('legal_entity_id', 'tenant_legal_entities');
CREATE TRIGGER "order_commercial_terms_bank_account_tenant_guard"
  BEFORE INSERT OR UPDATE OF "tenant_id", "bank_account_id" ON "order_commercial_terms"
  FOR EACH ROW EXECUTE FUNCTION "assert_tenant_owned_reference"('bank_account_id', 'tenant_bank_accounts');
CREATE TRIGGER "order_payments_bank_account_tenant_guard"
  BEFORE INSERT OR UPDATE OF "tenant_id", "bank_account_id" ON "order_payments"
  FOR EACH ROW EXECUTE FUNCTION "assert_tenant_owned_reference"('bank_account_id', 'tenant_bank_accounts');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "order_commercial_terms" terms
    JOIN "tenant_legal_entities" entity ON entity."id" = terms."legal_entity_id"
    WHERE terms."tenant_id" <> entity."tenant_id"
  ) OR EXISTS (
    SELECT 1 FROM "order_commercial_terms" terms
    JOIN "tenant_bank_accounts" account ON account."id" = terms."bank_account_id"
    WHERE terms."tenant_id" <> account."tenant_id"
  ) OR EXISTS (
    SELECT 1 FROM "order_payments" payment
    JOIN "tenant_bank_accounts" account ON account."id" = payment."bank_account_id"
    WHERE payment."tenant_id" <> account."tenant_id"
  ) THEN
    RAISE EXCEPTION 'cross-tenant historical payment references must be repaired before migration'
      USING ERRCODE = '23503';
  END IF;
END;
$$;
