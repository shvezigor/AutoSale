ALTER TABLE "order_commercial_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_commercial_terms" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_commercial_terms_tenant_isolation"
ON "order_commercial_terms"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

ALTER TABLE "order_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_payments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_payments_tenant_isolation"
ON "order_payments"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
