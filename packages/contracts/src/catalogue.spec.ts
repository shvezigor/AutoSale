import { describe, expect, it } from 'vitest';
import { catalogueMappingProposalSchema, catalogueProductSchema } from './catalogue.js';

describe('catalogue contracts', () => {
  it('accepts a typed product and rejects an invented mapping target', () => {
    expect(catalogueProductSchema.parse({ sku: 'LUNA-01', name: 'Luna', aliases: [], active: true }).sku).toBe('LUNA-01');
    expect(() => catalogueMappingProposalSchema.parse({ columns: [{ source: 'Назва', target: 'magic', confidence: 0.8 }] })).toThrow();
  });
});
