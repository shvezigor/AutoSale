ALTER TABLE "tenant_legal_entities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_legal_entities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_legal_entities_tenant_isolation"
ON "tenant_legal_entities"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

ALTER TABLE "tenant_bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_bank_accounts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_bank_accounts_tenant_isolation"
ON "tenant_bank_accounts"
USING (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
)
WITH CHECK (
  "tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
