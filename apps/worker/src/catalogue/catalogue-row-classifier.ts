import {
  tableStructureProposalSchema,
  type AmbiguousRowClassification,
  type RawCatalogueCell,
  type RawCatalogueMatrix,
  type TableStructureProposal,
} from '@autosale/contracts';

export interface ClassifiedCatalogueRow {
  sourceRowNumber: number;
  cells: RawCatalogueCell[];
}

export interface CatalogueRowClassification {
  headers: string[];
  products: ClassifiedCatalogueRow[];
  ambiguous: ClassifiedCatalogueRow[];
  skippedRowNumbers: number[];
}

export function normalizeCatalogueRows(input: {
  matrix: RawCatalogueMatrix;
  proposal: TableStructureProposal;
}): CatalogueRowClassification {
  const proposal = tableStructureProposalSchema.parse(input.proposal);
  validateProposalAgainstMatrix(input.matrix, proposal);
  const columns = proposal.columns.filter((column) => column.target !== 'ignore');
  const headers = columns.map((column) => combinedHeader(input.matrix, proposal, column.index, column.label));
  const products: ClassifiedCatalogueRow[] = [];
  const ambiguous: ClassifiedCatalogueRow[] = [];
  const skippedRowNumbers: number[] = [];

  for (const row of input.matrix.rows) {
    if (row.rowNumber === proposal.headerStartRow) continue;
    if (row.rowNumber < proposal.dataStartRow) {
      if (row.rowNumber > proposal.headerStartRow) skippedRowNumbers.push(row.rowNumber);
      continue;
    }
    const cells = columns.map((column) => row.cells[column.index] ?? null);
    if (cells.every((cell) => !hasValue(cell)) || matchesHeaders(cells, headers)) {
      skippedRowNumbers.push(row.rowNumber);
      continue;
    }

    const valuesByTarget = new Map(columns.map((column, index) => [column.target, cells[index] ?? null]));
    const hasName = hasValue(valuesByTarget.get('name') ?? null);
    const hasProductEvidence = ['sku', 'price', 'stockQuantity'].some((target) => hasValue(valuesByTarget.get(target as never) ?? null));
    if (hasName && hasProductEvidence) {
      products.push({ sourceRowNumber: row.rowNumber, cells });
    } else if (hasName && columns.length > 1 && cells.filter(hasValue).length === 1) {
      skippedRowNumbers.push(row.rowNumber);
    } else {
      ambiguous.push({ sourceRowNumber: row.rowNumber, cells });
    }
  }

  return { headers, products, ambiguous, skippedRowNumbers };
}

export function applyAmbiguousDecisions(
  classification: CatalogueRowClassification,
  decisions: AmbiguousRowClassification[],
): CatalogueRowClassification {
  const decisionByRow = new Map(decisions.map((decision) => [decision.rowNumber, decision]));
  const products = [...classification.products];
  const skippedRowNumbers = [...classification.skippedRowNumbers];
  for (const row of classification.ambiguous) {
    const decision = decisionByRow.get(row.sourceRowNumber);
    if (!decision) throw new Error(`Missing decision for source row ${row.sourceRowNumber}`);
    if (decision.kind === 'PRODUCT') products.push(row);
    else skippedRowNumbers.push(row.sourceRowNumber);
  }
  return {
    headers: classification.headers,
    products: products.sort((left, right) => left.sourceRowNumber - right.sourceRowNumber),
    ambiguous: [],
    skippedRowNumbers: skippedRowNumbers.sort((left, right) => left - right),
  };
}

function validateProposalAgainstMatrix(matrix: RawCatalogueMatrix, proposal: TableStructureProposal): void {
  const rowNumbers = new Set(matrix.rows.map((row) => row.rowNumber));
  if (!rowNumbers.has(proposal.headerStartRow) || !rowNumbers.has(proposal.headerEndRow) || !rowNumbers.has(proposal.dataStartRow)) {
    throw new Error('Structure rows do not exist in the source matrix');
  }
  const maxColumns = matrix.rows.reduce((maximum, row) => Math.max(maximum, row.cells.length), 0);
  if (proposal.columns.some((column) => column.index >= maxColumns)) throw new Error('Structure column does not exist in the source matrix');
}

function combinedHeader(
  matrix: RawCatalogueMatrix,
  proposal: TableStructureProposal,
  columnIndex: number,
  fallback: string,
): string {
  const labels: string[] = [];
  for (let rowNumber = proposal.headerStartRow; rowNumber <= proposal.headerEndRow; rowNumber += 1) {
    const value = matrix.rows.find((row) => row.rowNumber === rowNumber)?.cells[columnIndex];
    const label = value === null || value === undefined ? '' : String(value).trim();
    if (label && !labels.some((current) => normalize(current) === normalize(label))) labels.push(label);
  }
  return labels.join(' / ') || fallback;
}

function matchesHeaders(cells: RawCatalogueCell[], headers: string[]): boolean {
  const nonEmpty = cells.map((cell, index) => ({ cell, header: headers[index] })).filter(({ cell }) => hasValue(cell));
  return nonEmpty.length > 0 && nonEmpty.every(({ cell, header }) => normalize(String(cell)) === normalize(header ?? ''));
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function hasValue(value: RawCatalogueCell): boolean {
  return value !== null && (typeof value !== 'string' || value.trim().length > 0);
}
