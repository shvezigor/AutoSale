CREATE SEQUENCE "order_public_number_sequence" START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE OR REPLACE FUNCTION "autosale_order_prefix"("company_name" TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  "parts" TEXT[];
  "capitals" TEXT;
  "letters" TEXT;
BEGIN
  "parts" := array_remove(regexp_split_to_array(trim(COALESCE("company_name", '')), '[^[:alnum:]]+'), '');
  IF COALESCE(array_length("parts", 1), 0) >= 2 THEN
    RETURN upper(substr("parts"[1], 1, 1) || substr("parts"[2], 1, 1));
  END IF;

  "capitals" := regexp_replace(COALESCE("company_name", ''), '[^A-ZА-ЯІЇЄҐ]', '', 'g');
  IF char_length("capitals") >= 2 THEN
    RETURN substr("capitals", 1, 2);
  END IF;

  "letters" := regexp_replace(upper(COALESCE("company_name", '')), '[^0-9A-ZА-ЯІЇЄҐ]', '', 'g');
  IF char_length("letters") >= 2 THEN
    RETURN substr("letters", 1, 2);
  END IF;

  RETURN 'AS';
END;
$$;

ALTER TABLE "orders" ADD COLUMN "public_number" TEXT;

WITH "numbered" AS (
  SELECT
    "orders"."id",
    "autosale_order_prefix"("tenants"."name") AS "prefix",
    row_number() OVER (ORDER BY "orders"."created_at", "orders"."id") AS "sequence_number"
  FROM "orders"
  JOIN "tenants" ON "tenants"."id" = "orders"."tenant_id"
)
UPDATE "orders"
SET "public_number" = "numbered"."prefix" || '-' || lpad("numbered"."sequence_number"::TEXT, 6, '0')
FROM "numbered"
WHERE "orders"."id" = "numbered"."id";

SELECT setval(
  'order_public_number_sequence',
  GREATEST((SELECT count(*) FROM "orders"), 1),
  (SELECT count(*) FROM "orders") > 0
);

CREATE OR REPLACE FUNCTION "autosale_assign_order_public_number"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "company_name" TEXT;
  "sequence_number" BIGINT;
BEGIN
  IF NEW."public_number" IS NOT NULL AND NEW."public_number" <> '' THEN
    RETURN NEW;
  END IF;

  SELECT "name" INTO "company_name" FROM "tenants" WHERE "id" = NEW."tenant_id";
  "sequence_number" := nextval('order_public_number_sequence');
  IF "sequence_number" > 999999 THEN
    RAISE EXCEPTION 'Readable order number capacity exhausted';
  END IF;

  NEW."public_number" := "autosale_order_prefix"("company_name") || '-' || lpad("sequence_number"::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "orders_assign_public_number"
BEFORE INSERT ON "orders"
FOR EACH ROW
EXECUTE FUNCTION "autosale_assign_order_public_number"();

ALTER TABLE "orders" ALTER COLUMN "public_number" SET NOT NULL;
CREATE UNIQUE INDEX "orders_public_number_key" ON "orders"("public_number");
