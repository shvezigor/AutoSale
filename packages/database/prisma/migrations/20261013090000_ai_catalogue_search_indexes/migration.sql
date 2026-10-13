CREATE INDEX "products_ai_search_sku_idx"
  ON "products" ("tenant_id", lower("sku"))
  WHERE "active" = true;

CREATE INDEX "products_ai_search_fts_idx"
  ON "products" USING gin (
    to_tsvector('simple',
      coalesce("sku", '') || ' ' || coalesce("name", '') || ' ' ||
      coalesce("aliases"::text, '') || ' ' || coalesce("brand", '') || ' ' ||
      coalesce("category", '') || ' ' || coalesce("color", '') || ' ' ||
      coalesce("size", ''))
  ) WHERE "active" = true;
