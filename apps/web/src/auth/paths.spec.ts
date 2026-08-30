import { describe, expect, it } from 'vitest';

import { safeNextPath } from './paths';

describe('safeNextPath', () => {
  it('accepts only local application paths', () => {
    expect(safeNextPath('/orders/123')).toBe('/orders/123');
    expect(safeNextPath('//evil.example')).toBe('/conversations');
    expect(safeNextPath('https://evil.example')).toBe('/conversations');
    expect(safeNextPath(null)).toBe('/conversations');
  });
});
