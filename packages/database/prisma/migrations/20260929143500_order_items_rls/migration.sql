ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_items_tenant_isolation"
ON "order_items"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
