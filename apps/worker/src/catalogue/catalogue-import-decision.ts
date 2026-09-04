import type { CatalogueMappingProposal } from '@autosale/contracts';

export type CatalogueImportDecisionReason =
  | 'NAME_MAPPING_MISSING'
  | 'DUPLICATE_TARGET'
  | 'LOW_CONFIDENCE'
  | 'PRODUCT_NAME_EMPTY'
  | 'SKU_CONFLICT';

export type CatalogueImportDecision = {
  action: 'AUTO_IMPORT' | 'REVIEW_REQUIRED';
  reasons: CatalogueImportDecisionReason[];
};

export function decideCatalogueImport(input: {
  columns: CatalogueMappingProposal['columns'];
  sampleRows: Array<Record<string, unknown>>;
}): CatalogueImportDecision {
  const reasons: CatalogueImportDecisionReason[] = [];
  const meaningful = input.columns.filter((column) => column.target !== 'ignore');
  const name = meaningful.find((column) => column.target === 'name');
  if (!name) reasons.push('NAME_MAPPING_MISSING');

  const targets = meaningful.map((column) => column.target);
  if (new Set(targets).size !== targets.length) reasons.push('DUPLICATE_TARGET');
  if (meaningful.some((column) => column.confidence < 0.9)) reasons.push('LOW_CONFIDENCE');

  if (name && (input.sampleRows.length === 0 || input.sampleRows.every((row) => !cell(row, name.source)))) {
    reasons.push('PRODUCT_NAME_EMPTY');
  }

  const sku = meaningful.find((column) => column.target === 'sku');
  if (sku && name) {
    const namesBySku = new Map<string, Set<string>>();
    for (const row of input.sampleRows) {
      const skuValue = cell(row, sku.source).toLocaleUpperCase('en-US');
      const nameValue = cell(row, name.source).toLocaleLowerCase('uk-UA');
      if (!skuValue || !nameValue) continue;
      const names = namesBySku.get(skuValue) ?? new Set<string>();
      names.add(nameValue);
      namesBySku.set(skuValue, names);
    }
    if ([...namesBySku.values()].some((names) => names.size > 1)) reasons.push('SKU_CONFLICT');
  }

  return { action: reasons.length === 0 ? 'AUTO_IMPORT' : 'REVIEW_REQUIRED', reasons };
}

function cell(row: Record<string, unknown>, source: string): string {
  const normalizedSource = source.trim().toLocaleLowerCase('en-US');
  const value = row[source] ?? row[normalizedSource];
  return value === null || value === undefined ? '' : String(value).trim();
}
