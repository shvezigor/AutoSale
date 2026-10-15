import { describe, expect, it } from 'vitest';
import { asksForConfirmedAvailability, extractCatalogueSearchIntent, hasExactProductReference, selectCatalogueCandidates, selectRequestedModelSources } from './catalogue-candidates.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const product = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  tenantId, sku: `DOOR-${id}`, name: `Fictional door ${id}`, aliases: [],
  brand: null, category: 'doors', color: 'white', size: '90x200', attributes: null,
  price: '1500.00', currency: 'UAH', stockQuantity: null, active: true,
  updatedAt: new Date('2026-10-05T10:00:00.000Z'), ...overrides,
});

describe('selectCatalogueCandidates', () => {
  it('requires an exact SKU or full product name to treat a reference as unambiguous', () => {
    const [source] = selectCatalogueCandidates([product(1)], tenantId, 'DOOR-1', [], 8);
    expect(source).toBeDefined();
    expect(hasExactProductReference(source!, 'Які двері?', [])).toBe(false);
    expect(hasExactProductReference(source!, 'Мені потрібен DOOR-10', [])).toBe(false);
    expect(hasExactProductReference(source!, 'Мені потрібен DOOR-1', [])).toBe(true);
    expect(hasExactProductReference(source!, 'Яка ціна?', ['Fictional door 1'])).toBe(true);
  });
  it('prioritizes exact SKU and excludes foreign or inactive products', () => {
    const result = selectCatalogueCandidates([
      product(1), product(2, { tenantId: '22222222-2222-4222-8222-222222222222' }),
      product(3, { active: false }), product(4, { aliases: ['Fictional door'] }),
    ], tenantId, 'How much is DOOR-1?', [], 8);
    expect(result.map((item) => item.sku)).toEqual(['DOOR-1']);
  });

  it('does not confuse a short SKU with a longer SKU sharing its prefix', () => {
    const result = selectCatalogueCandidates([product(1), product(10)], tenantId, 'Do you have DOOR-10?', [], 8);
    expect(result.map((item) => item.sku)).toEqual(['DOOR-10']);
  });

  it('returns at most eight stable, safe snapshots with explicit stock', () => {
    const result = selectCatalogueCandidates(Array.from({ length: 12 }, (_, index) => product(index + 1)),
      tenantId, 'Fictional door', [], 8);
    expect(result).toHaveLength(8);
    expect(result[0]?.sku).toBe('DOOR-1');
    expect(result[0]?.stockQuantity).toBeNull();
    expect(result[0]).not.toHaveProperty('description');
    expect(result[0]).not.toHaveProperty('aliases');
  });

  it('distinguishes zero stock and missing currency from availability and price', () => {
    const [zero, noCurrency] = selectCatalogueCandidates([
      product(1, { stockQuantity: 0 }), product(2, { currency: null }),
    ], tenantId, 'Fictional door', [], 8);
    expect(zero?.stockQuantity).toBe(0);
    expect(zero?.price).toBe('1500.00');
    expect(noCurrency?.price).toBeNull();
    expect(noCurrency?.currency).toBeNull();
  });

  it('uses bounded recent context for a follow-up question', () => {
    const result = selectCatalogueCandidates([product(1), product(2)], tenantId,
      'Is it available?', ['I mean DOOR-2'], 8);
    expect(result[0]?.sku).toBe('DOOR-2');
  });

  it('keeps catalogue items whose primary name matches an explicitly requested model', () => {
    const result = selectCatalogueCandidates([
      product(1, { name: '860х2050 Регіон (плівка мат)' }),
      product(2, { name: '960х2050 Регіон VINARIT' }),
      product(3, { name: 'Додатковий замок (Регіон, Колізей)' }),
    ], tenantId, 'Вхідні двері, модель Регіон', ['Які варіанти можете запропонувати?'], 8);

    expect(result.map((item) => item.sku)).toEqual(['DOOR-1', 'DOOR-2']);
  });

  it('recognizes a named model after the natural plural phrase "models of doors"', () => {
    const result = selectCatalogueCandidates([
      product(1, { name: '860х2050 Регіон (плівка мат)' }),
      product(2, { name: '960х2050 Регіон VINARIT' }),
      product(3, { name: '860х2050 Авангард VINARIT' }),
    ], tenantId, 'Які ще моделі дверей Регіон є в наявності?', [], 8);

    expect(result.map((item) => item.sku)).toEqual(['DOOR-1', 'DOOR-2']);
  });

  it('offers the requested model and size from a natural two-message options request', () => {
    const latestInbound = 'потрібен розмір 860х2050';
    const recentContext = ['покажіть двері Регіон'];
    const sources = selectCatalogueCandidates([
      product(1, { name: '860х2050 Регіон (плівка мат)', size: '860х2050' }),
      product(2, { name: '960х2050 Регіон VINARIT', size: '960х2050' }),
      product(3, { name: '860х2050 Авангард VINARIT', size: '860х2050' }),
    ], tenantId, latestInbound, recentContext, 8);

    expect(selectRequestedModelSources(sources, latestInbound, recentContext).map((item) => item.sku))
      .toEqual(['DOOR-1']);
  });

  it('keeps availability intent from an earlier message when the latest message only gives a size', () => {
    const latestInbound = 'Цікавить 860х2050';
    const recentContext = ['Які двері Регіон є в наявності?'];
    const sources = selectCatalogueCandidates([
      product(1, { name: '860х2050 Вигаданий Регіон А', size: '860х2050', stockQuantity: 3 }),
      product(2, { name: '960х2050 Вигаданий Регіон Б', size: '960х2050', stockQuantity: null }),
    ], tenantId, latestInbound, recentContext, 8);

    expect(selectRequestedModelSources(sources, latestInbound, recentContext).map((item) => item.sku))
      .toEqual(['DOOR-1']);
  });

  it('does not carry an old availability request into a new explicit price question', () => {
    const latestInbound = 'Яка ціна DOOR-1?';
    const recentContext = ['Чи є DOOR-1 в наявності?'];

    expect(asksForConfirmedAvailability(latestInbound, recentContext)).toBe(false);
    expect(extractCatalogueSearchIntent(latestInbound, recentContext).asksForOptions).toBe(false);
  });
});

describe('extractCatalogueSearchIntent', () => {
  it('keeps a bounded exact SKU and the latest explicit model', () => {
    const intent = extractCatalogueSearchIntent('Покажіть модель Регіон, SKU DOOR-7', ['модель Авангард']);
    expect(intent.explicitModels).toEqual(['регіон']);
    expect(intent.exactTerms).toContain('door-7');
    expect(intent.asksForOptions).toBe(true);
  });

  it('falls back to only the last three contextual messages for an explicit model', () => {
    const intent = extractCatalogueSearchIntent('Який розмір?', [
      'модель Перший', 'модель Регіон', 'Потрібні двері', '860х2050',
    ]);
    expect(intent.explicitModels).toEqual(['регіон']);
    expect(intent.query).not.toContain('перший');
  });

  it('caps distinct tokens and drops overlong terms instead of truncating them', () => {
    const longTerm = 'x'.repeat(65);
    const intent = extractCatalogueSearchIntent(
      `${longTerm} ${Array.from({ length: 13 }, (_, index) => `term${index}`).join(' ')} TERM0`, [],
    );
    expect(intent.tokens).toHaveLength(12);
    expect(intent.tokens).not.toContain(longTerm);
    expect(intent.exactTerms).not.toContain(longTerm.slice(0, 64));
    expect(intent.tokens.filter((term) => term === 'term0')).toHaveLength(1);
  });

  it('returns no searchable terms for punctuation and whitespace', () => {
    expect(extractCatalogueSearchIntent(' ? !! ', [])).toMatchObject({
      tokens: [], exactTerms: [], explicitModels: [], asksForOptions: false,
    });
  });

  it('does not spend the term budget on common Ukrainian and English request words', () => {
    const intent = extractCatalogueSearchIntent('Чи доступна Коронна серія Регіон? Please show', []);
    expect(intent.tokens).toEqual(['коронна', 'серія', 'регіон']);
  });
});
