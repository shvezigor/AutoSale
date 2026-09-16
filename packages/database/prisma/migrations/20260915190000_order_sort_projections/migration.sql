ALTER TABLE "orders"
  ADD COLUMN "sort_product" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sort_customer" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sort_procurement" TEXT NOT NULL DEFAULT 'UNASSESSED';

UPDATE "orders" AS o
SET
  "sort_product" = LOWER(COALESCE((
    SELECT STRING_AGG(COALESCE(p."name", oi."original_text"), ', ' ORDER BY oi."created_at", oi."id")
    FROM "order_items" AS oi
    LEFT JOIN "products" AS p
      ON p."tenant_id" = oi."tenant_id" AND p."sku" = oi."catalog_id"
    WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id"
  ), '')),
  "sort_customer" = LOWER(COALESCE(
    o."extraction" #>> '{customer,name}',
    (SELECT COALESCE(icp."display_name", c."display_name", icp."username", '')
      FROM "conversations" AS c
      LEFT JOIN "instagram_customer_profiles" AS icp
        ON icp."tenant_id" = c."tenant_id" AND icp."id" = c."profile_id"
      WHERE c."id" = o."conversation_id"),
    ''
  )),
  "sort_procurement" = CASE
    WHEN o."procurement_handed_off_at" IS NOT NULL THEN 'HANDED_OFF'
    WHEN o."status" NOT IN ('APPROVED', 'AUTO_APPROVED')
      OR NOT EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id")
      OR EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id" AND oi."procurement_status" = 'UNASSESSED') THEN 'UNASSESSED'
    WHEN EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id" AND oi."procurement_status" = 'UNAVAILABLE') THEN 'BLOCKED'
    WHEN EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id" AND oi."procurement_status" = 'SENDING') THEN 'SENDING'
    WHEN NOT EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id" AND oi."procurement_status" NOT IN ('IN_STOCK', 'RECEIVED')) THEN 'READY'
    WHEN NOT EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id" AND oi."procurement_status" <> 'TO_ORDER') THEN 'NEEDS_ORDER'
    WHEN NOT EXISTS (SELECT 1 FROM "order_items" oi WHERE oi."tenant_id" = o."tenant_id" AND oi."order_id" = o."id" AND oi."procurement_status" NOT IN ('ORDERED', 'SUPPLIER_CONFIRMED')) THEN 'AWAITING_SUPPLIER'
    ELSE 'PARTIALLY_READY'
  END;

CREATE INDEX "orders_tenant_id_sort_product_id_idx" ON "orders"("tenant_id", "sort_product", "id");
CREATE INDEX "orders_tenant_id_sort_customer_id_idx" ON "orders"("tenant_id", "sort_customer", "id");
CREATE INDEX "orders_tenant_id_sort_procurement_id_idx" ON "orders"("tenant_id", "sort_procurement", "id");
