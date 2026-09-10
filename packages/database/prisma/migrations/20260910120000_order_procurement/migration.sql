CREATE TYPE "ProcurementStatus" AS ENUM (
  'UNASSESSED', 'IN_STOCK', 'TO_ORDER', 'SENDING',
  'ORDERED', 'SUPPLIER_CONFIRMED', 'RECEIVED', 'UNAVAILABLE'
);
CREATE TYPE "ProcurementDecisionSource" AS ENUM ('AUTO', 'MANUAL');
CREATE TYPE "ProcurementReason" AS ENUM (
  'STOCK_AVAILABLE', 'STOCK_INSUFFICIENT', 'STOCK_UNKNOWN',
  'PRODUCT_UNMATCHED', 'RESERVATION_CONFLICT',
  'MANUAL_IN_STOCK', 'MANUAL_TO_ORDER', 'DELIVERY_FAILED'
);
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');
CREATE TYPE "TelegramAlertEventType" AS ENUM (
  'ORDER_NEEDS_REVIEW', 'ORDER_AUTO_APPROVED', 'SUPPLIER_DELIVERY_FAILED'
);

ALTER TABLE "orders"
  ADD COLUMN "procurement_handed_off_at" TIMESTAMP(3),
  ADD COLUMN "procurement_handed_off_by" UUID,
  ADD COLUMN "supplier_dispatch_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "order_items"
  ADD COLUMN "tenant_id" UUID,
  ADD COLUMN "procurement_status" "ProcurementStatus" NOT NULL DEFAULT 'UNASSESSED',
  ADD COLUMN "procurement_source" "ProcurementDecisionSource",
  ADD COLUMN "procurement_reason" "ProcurementReason",
  ADD COLUMN "stock_at_decision" INTEGER,
  ADD COLUMN "available_at_decision" INTEGER,
  ADD COLUMN "procurement_updated_at" TIMESTAMP(3);

UPDATE "order_items" AS item
SET "tenant_id" = orders."tenant_id"
FROM "orders"
WHERE item."order_id" = orders."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "order_items" WHERE "tenant_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill tenant_id for every order item';
  END IF;
END $$;

ALTER TABLE "order_items" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "user_notifications" ADD COLUMN "event_key" TEXT;
ALTER TABLE "telegram_deliveries"
  ADD COLUMN "order_id" UUID,
  ADD COLUMN "source_notification_id" UUID;

CREATE TABLE "inventory_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "consumed_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_reservations_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "telegram_delivery_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "delivery_id" UUID NOT NULL,
  "order_item_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_delivery_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_notification_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "event_type" "TelegramAlertEventType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "telegram_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_tenant_id_id_key" ON "orders"("tenant_id", "id");
CREATE UNIQUE INDEX "order_items_tenant_id_id_key" ON "order_items"("tenant_id", "id");
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");
CREATE UNIQUE INDEX "user_notifications_tenant_id_id_key" ON "user_notifications"("tenant_id", "id");
CREATE UNIQUE INDEX "user_notifications_tenant_id_user_id_event_key_key"
  ON "user_notifications"("tenant_id", "user_id", "event_key");
CREATE UNIQUE INDEX "telegram_deliveries_tenant_id_id_key" ON "telegram_deliveries"("tenant_id", "id");
CREATE UNIQUE INDEX "inventory_reservations_tenant_id_order_item_id_key"
  ON "inventory_reservations"("tenant_id", "order_item_id");
CREATE INDEX "inventory_reservations_tenant_id_product_id_status_idx"
  ON "inventory_reservations"("tenant_id", "product_id", "status");
CREATE UNIQUE INDEX "telegram_delivery_items_delivery_id_order_item_id_key"
  ON "telegram_delivery_items"("delivery_id", "order_item_id");
CREATE INDEX "telegram_delivery_items_tenant_id_order_item_id_idx"
  ON "telegram_delivery_items"("tenant_id", "order_item_id");
CREATE UNIQUE INDEX "telegram_notification_preferences_tenant_id_user_id_event_type_key"
  ON "telegram_notification_preferences"("tenant_id", "user_id", "event_type");

ALTER TABLE "order_items" DROP CONSTRAINT "order_items_order_id_fkey";

ALTER TABLE "orders" ADD CONSTRAINT "orders_procurement_handed_off_by_fkey"
  FOREIGN KEY ("procurement_handed_off_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_tenant_id_product_id_fkey"
  FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_tenant_id_order_item_id_fkey"
  FOREIGN KEY ("tenant_id", "order_item_id") REFERENCES "order_items"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_tenant_id_order_id_fkey"
  FOREIGN KEY ("tenant_id", "order_id") REFERENCES "orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_tenant_id_source_notification_id_fkey"
  FOREIGN KEY ("tenant_id", "source_notification_id") REFERENCES "user_notifications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "telegram_delivery_items" ADD CONSTRAINT "telegram_delivery_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_delivery_items" ADD CONSTRAINT "telegram_delivery_items_tenant_id_delivery_id_fkey"
  FOREIGN KEY ("tenant_id", "delivery_id") REFERENCES "telegram_deliveries"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_delivery_items" ADD CONSTRAINT "telegram_delivery_items_tenant_id_order_item_id_fkey"
  FOREIGN KEY ("tenant_id", "order_item_id") REFERENCES "order_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "telegram_notification_preferences" ADD CONSTRAINT "telegram_notification_preferences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_notification_preferences" ADD CONSTRAINT "telegram_notification_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
