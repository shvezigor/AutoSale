import { Prisma } from '@autosale/database';

import { extractCatalogueSearchIntent, type CatalogueCandidateInput } from './catalogue-candidates.js';

const searchVector = Prisma.sql`to_tsvector('simple',
  coalesce("sku", '') || ' ' || coalesce("name", '') || ' ' ||
  coalesce("aliases"::text, '') || ' ' || coalesce("brand", '') || ' ' ||
  coalesce("category", '') || ' ' || coalesce("color", '') || ' ' ||
  coalesce("size", ''))`;

const productSelect = {
  id: true, tenantId: true, sku: true, name: true, aliases: true,
  brand: true, category: true, color: true, size: true, attributes: true,
  price: true, currency: true, stockQuantity: true, active: true, updatedAt: true,
} satisfies Prisma.ProductSelect;

const exactSkuLimit = 8;
const modelLimit = 64;
const genericLimit = 128;
const hydrationLimit = exactSkuLimit + modelLimit + genericLimit;

export class CatalogueRetrievalError extends Error {
  constructor() {
    super('Catalogue retrieval failed');
    this.name = 'CatalogueRetrievalError';
  }
}

export interface CatalogueRetrievalResult {
  products: CatalogueCandidateInput[];
  modelOverflow: boolean;
}

export async function retrieveCatalogueCandidates(
  tx: Prisma.TransactionClient,
  tenantId: string,
  latestInbound: string,
  recentContext: readonly string[],
): Promise<CatalogueRetrievalResult> {
  try {
    const intent = extractCatalogueSearchIntent(latestInbound, recentContext);
    if (intent.tokens.length === 0 && intent.exactTerms.length === 0 && intent.explicitModels.length === 0) {
      return { products: [], modelOverflow: false };
    }

    const exactSkuRows = intent.exactTerms.length === 0 ? [] : await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "products"
      WHERE "tenant_id" = ${tenantId}::uuid AND "active" = true
        AND lower("sku") IN (${Prisma.join(intent.exactTerms)})
      ORDER BY "sku" COLLATE "C", "id" LIMIT ${exactSkuLimit}
    `);

    let modelRows: { id: string }[] = [];
    if (exactSkuRows.length === 0) {
      for (const model of intent.explicitModels) {
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "products"
          WHERE "tenant_id" = ${tenantId}::uuid AND "active" = true
            AND ${searchVector} @@ plainto_tsquery('simple', ${model})
            AND position(${model} in lower(split_part("name", '(', 1))) > 0
          ORDER BY "sku" COLLATE "C", "id" LIMIT ${modelLimit + 1}
        `);
        if (rows.length > 0 && (modelRows.length === 0 || rows.length <= modelRows.length)) {
          modelRows = rows;
        }
      }
    }
    if (modelRows.length > modelLimit) return { products: [], modelOverflow: true };

    const nameMatch = Prisma.sql`length("name") >= 5 AND position(lower("name") in ${intent.query}) > 0`;
    const aliasMatch = Prisma.sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof("aliases") = 'array' THEN "aliases" ELSE '[]'::jsonb END
      ) AS alias(value)
      WHERE length(alias.value) >= 4 AND position(lower(alias.value) in ${intent.query}) > 0
    )`;
    let genericRows: { id: string }[] = [];
    if (exactSkuRows.length === 0 && modelRows.length === 0 && intent.tokens.length > 0) {
      const queries = intent.tokens.length > 1
        ? [intent.tokens.join(' & '), intent.tokens.join(' | ')]
        : [intent.tokens[0]!];
      for (const tsQuery of queries) {
        const rank = tsQuery.includes('|')
          ? Prisma.sql`ts_rank_cd(${searchVector}, to_tsquery('simple', ${tsQuery})) DESC,`
          : Prisma.empty;
        genericRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "products"
          WHERE "tenant_id" = ${tenantId}::uuid AND "active" = true
            AND ${searchVector} @@ to_tsquery('simple', ${tsQuery})
          ORDER BY
            CASE WHEN ${nameMatch} THEN 1 ELSE 0 END DESC,
            CASE WHEN ${aliasMatch} THEN 1 ELSE 0 END DESC,
            ${rank}
            CASE WHEN position(${intent.tokens[0]!} in lower("aliases"::text)) > 0 THEN 1 ELSE 0 END DESC,
            CASE WHEN position(${intent.tokens[0]!} in lower("name")) > 0 THEN 1 ELSE 0 END DESC,
            "sku" COLLATE "C", "id"
          LIMIT ${genericLimit}
        `);
        if (genericRows.length > 0) break;
      }
    }

    const orderedIds = [...new Set([
      ...exactSkuRows.map((row) => row.id),
      ...modelRows.map((row) => row.id),
      ...genericRows.map((row) => row.id),
    ])].slice(0, hydrationLimit);
    if (orderedIds.length === 0) return { products: [], modelOverflow: false };
    const hydrated = await tx.product.findMany({
      where: { tenantId, active: true, id: { in: orderedIds } }, select: productSelect,
    });
    const byId = new Map(hydrated.map((product) => [product.id, product]));
    return {
      products: orderedIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []),
      modelOverflow: false,
    };
  } catch {
    throw new CatalogueRetrievalError();
  }
}
