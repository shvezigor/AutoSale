import { describe, expect, it } from 'vitest';
import { mapNovaPoshtaStatus } from './shipment-status.service.js';

describe('mapNovaPoshtaStatus', () => {
  it('maps known lifecycle codes and preserves unknown provider codes', () => {
    expect(mapNovaPoshtaStatus('1')).toBe('CREATED');
    expect(mapNovaPoshtaStatus('5')).toBe('IN_TRANSIT');
    expect(mapNovaPoshtaStatus('9')).toBe('DELIVERED');
    expect(mapNovaPoshtaStatus('106')).toBe('RETURNING');
    expect(mapNovaPoshtaStatus('108')).toBe('RETURNED');
    expect(mapNovaPoshtaStatus('new-code')).toBeNull();
  });
});
