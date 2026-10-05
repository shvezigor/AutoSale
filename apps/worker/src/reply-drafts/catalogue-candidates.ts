import type { ReplyDraftSource } from '@autosale/contracts/reply-drafts';

export interface CatalogueCandidateInput {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  aliases: unknown;
  brand: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  attributes: unknown;
  price: { toString(): string } | string | null;
  currency: string | null;
  stockQuantity: number | null;
  active: boolean;
  updatedAt: Date;
}

const variantKeys = new Set(['material', 'finish', 'dimension', 'width', 'height', 'variant', 'матеріал', 'покриття', 'розмір']);

export function selectCatalogueCandidates(
  products: readonly CatalogueCandidateInput[],
  tenantId: string,
  latestInbound: string,
  recentContext: readonly string[],
  limit = 8,
): ReplyDraftSource[] {
  const query = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  const words = tokens(query);
  const ranked = products
    .filter((product) => product.tenantId === tenantId && product.active)
    .map((product) => {
      const sku = normalize(product.sku);
      const name = normalize(product.name);
      const aliases = Array.isArray(product.aliases)
        ? product.aliases.filter((value): value is string => typeof value === 'string').map(normalize)
        : [];
      const exactSku = sku.length >= 3 && containsWholeTerm(query, sku);
      const exactName = name.length >= 5 && containsWholeTerm(query, name);
      const aliasMatch = aliases.some((alias) => alias.length >= 4 && containsWholeTerm(query, alias));
      const searchable = [product.name, ...aliases, product.brand, product.category, product.color, product.size]
        .filter((value): value is string => typeof value === 'string').join(' ');
      const overlap = [...tokens(normalize(searchable))].filter((token) => words.has(token)).length;
      return { product, exactSku, score: exactSku ? 1_000 : exactName ? 600 : aliasMatch ? 500 : overlap * 20 };
    })
    .filter((item) => item.score > 0);
  const hasExactSku = ranked.some((item) => item.exactSku);
  return ranked.filter((item) => !hasExactSku || item.exactSku)
    .sort((left, right) => right.score - left.score
      || left.product.sku.localeCompare(right.product.sku, 'en')
      || left.product.id.localeCompare(right.product.id))
    .slice(0, Math.min(Math.max(limit, 0), 8))
    .map(({ product }) => snapshot(product));
}

function snapshot(product: CatalogueCandidateInput): ReplyDraftSource {
  const variants: Record<string, string> = {};
  if (product.color) variants.color = product.color.slice(0, 160);
  if (product.size) variants.size = product.size.slice(0, 160);
  if (product.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)) {
    for (const [key, value] of Object.entries(product.attributes)) {
      if (variantKeys.has(key.toLowerCase()) && typeof value === 'string' && value.trim()) {
        variants[key.slice(0, 80)] = value.slice(0, 160);
      }
    }
  }
  const hasPrice = product.price !== null && Boolean(product.currency);
  return {
    productId: product.id,
    sku: product.sku.slice(0, 120),
    name: product.name.slice(0, 300),
    variants,
    price: hasPrice ? product.price!.toString() : null,
    currency: hasPrice ? product.currency : null,
    stockQuantity: product.stockQuantity,
    updatedAt: product.updatedAt.toISOString(),
  };
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('uk').replace(/\s+/gu, ' ').trim();
}

function tokens(value: string): Set<string> {
  return new Set(value.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3));
}

function containsWholeTerm(query: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(query);
}
