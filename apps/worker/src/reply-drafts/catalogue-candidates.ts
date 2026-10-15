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
const searchStopwords = new Set([
  'чи', 'доступна', 'доступний', 'покажіть', 'покажи', 'які', 'можете', 'будь', 'ласка',
  'please', 'show', 'what', 'which', 'have', 'you', 'can', 'the', 'are', 'available',
]);

export interface CatalogueSearchIntent {
  query: string;
  tokens: string[];
  exactTerms: string[];
  explicitModels: string[];
  asksForOptions: boolean;
}

export function extractCatalogueSearchIntent(
  latestInbound: string,
  recentContext: readonly string[],
): CatalogueSearchIntent {
  const query = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  return {
    query,
    tokens: [...tokens(query)].filter((term) => term.length <= 64 && !searchStopwords.has(term)).slice(0, 12),
    exactTerms: [...new Set(query.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [])]
      .filter((term) => term.length >= 3 && term.length <= 64 && !searchStopwords.has(term)).slice(0, 12),
    explicitModels: requestedModelTokens(latestInbound, recentContext)
      .filter((term) => term.length <= 64).slice(0, 4),
    asksForOptions: asksForOptions(latestInbound, recentContext),
  };
}

export function selectCatalogueCandidates(
  products: readonly CatalogueCandidateInput[],
  tenantId: string,
  latestInbound: string,
  recentContext: readonly string[],
  limit = 8,
): ReplyDraftSource[] {
  const query = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  const words = tokens(query);
  const requestedModels = requestedModelTokens(latestInbound, recentContext);
  const ranked = products
    .filter((product) => product.tenantId === tenantId && product.active)
    .map((product) => {
      const sku = normalize(product.sku);
      const name = normalize(product.name);
      const primaryName = name.split('(', 1)[0] ?? name;
      const aliases = Array.isArray(product.aliases)
        ? product.aliases.filter((value): value is string => typeof value === 'string').map(normalize)
        : [];
      const exactSku = sku.length >= 3 && containsWholeTerm(query, sku);
      const exactName = name.length >= 5 && containsWholeTerm(query, name);
      const aliasMatch = aliases.some((alias) => alias.length >= 4 && containsWholeTerm(query, alias));
      const requestedModelMatch = requestedModels.some((model) => containsWholeTerm(primaryName, model));
      const searchable = [product.name, ...aliases, product.brand, product.category, product.color, product.size]
        .filter((value): value is string => typeof value === 'string').join(' ');
      const overlap = [...tokens(normalize(searchable))].filter((token) => words.has(token)).length;
      return { product, exactSku, requestedModelMatch,
        score: exactSku ? 1_000 : requestedModelMatch ? 800 : exactName ? 600 : aliasMatch ? 500 : overlap * 20 };
    })
    .filter((item) => item.score > 0);
  const hasExactSku = ranked.some((item) => item.exactSku);
  const hasRequestedModelMatch = ranked.some((item) => item.requestedModelMatch);
  return ranked.filter((item) => hasExactSku ? item.exactSku : !hasRequestedModelMatch || item.requestedModelMatch)
    .sort((left, right) => right.score - left.score
      || left.product.sku.localeCompare(right.product.sku, 'en')
      || left.product.id.localeCompare(right.product.id))
    .slice(0, Math.min(Math.max(limit, 0), 8))
    .map(({ product }) => snapshot(product));
}

export function selectRequestedModelSources(
  sources: readonly ReplyDraftSource[],
  latestInbound: string,
  recentContext: readonly string[],
  limit = 4,
): ReplyDraftSource[] {
  if (!asksForOptions(latestInbound, recentContext)) return [];
  const query = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  const requestedModels = requestedModelTokens(latestInbound, recentContext);
  const modelTerms = requestedModels.length > 0 ? requestedModels : inferredModelTokens(sources, query);
  if (modelTerms.length === 0) return [];
  const requestedDimensions = dimensions(query);
  return sources.filter((source) => {
    const name = normalize(source.name);
    const primaryName = name.split('(', 1)[0] ?? name;
    const matchesModel = modelTerms.some((model) => containsWholeTerm(primaryName, model));
    const sourceDimensions = dimensions(`${name} ${Object.values(source.variants).join(' ')}`);
    return matchesModel && (requestedDimensions.length === 0
      || requestedDimensions.some((dimension) => sourceDimensions.includes(dimension)));
  }).slice(0, Math.min(Math.max(limit, 0), 4));
}

export function hasExactProductReference(
  source: ReplyDraftSource,
  latestInbound: string,
  recentContext: readonly string[],
): boolean {
  const query = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  return containsWholeTerm(query, normalize(source.sku))
    || containsWholeTerm(query, normalize(source.name));
}

function inferredModelTokens(sources: readonly ReplyDraftSource[], query: string): string[] {
  const names = sources.map((source) => normalize(source.name).split('(', 1)[0] ?? '');
  const matches = [...tokens(query)]
    .filter((token) => !/\d/u.test(token))
    .map((token) => ({ token, count: names.filter((name) => containsWholeTerm(name, token)).length }))
    .filter(({ count }) => count > 0);
  if (matches.length === 0) return [];
  const mostSpecificCount = Math.min(...matches.map(({ count }) => count));
  return matches.filter(({ count }) => count === mostSpecificCount).map(({ token }) => token);
}

function dimensions(value: string): string[] {
  return [...new Set([...normalize(value).matchAll(/\b\d{2,4}\s*[xх×]\s*\d{2,4}\b/giu)]
    .map((match) => (match[0] ?? '').replace(/\s+/gu, '').replace(/[х×]/gu, 'x')))];
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

function requestedModelTokens(latestInbound: string, recentContext: readonly string[]): string[] {
  const latest = modelTokensIn(latestInbound);
  return latest.length > 0 ? latest : [...new Set(recentContext.slice(-3).flatMap(modelTokensIn))];
}

function modelTokensIn(value: string): string[] {
  const normalized = normalize(value);
  const direct = normalized.matchAll(/(?:модел(?:ь|і|ю|я)?|model)\s*[:—-]?\s*([\p{L}\p{N}][\p{L}\p{N}._-]*)/giu);
  const afterProductType = normalized.matchAll(/(?:модел(?:ь|і|ю|я)?)\s*[:—-]?\s*[\p{L}\p{N}][\p{L}\p{N}._-]*\s+([\p{L}\p{N}][\p{L}\p{N}._-]*)/giu);
  return [...new Set([...direct, ...afterProductType]
    .map((match) => normalize(match[1] ?? ''))
    .filter((token) => token.length >= 2))];
}

function asksForOptions(latestInbound: string, recentContext: readonly string[]): boolean {
  const text = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  return asksForConfirmedAvailability(latestInbound, recentContext)
    || /варіант|асортимент|запропон|покаж|(?:^|\s)види?(?:\s|$)|options?|choices?|assortment|offer|show/iu.test(text);
}

export function asksForConfirmedAvailability(latestInbound: string, recentContext: readonly string[]): boolean {
  const text = normalize(`${latestInbound} ${recentContext.slice(-3).join(' ')}`);
  return /наявн|залишк|є\s+(?:зараз\s+)?(?:у\s+вас|в\s+продажу)|in stock|availability|available|stock left/iu.test(text);
}
