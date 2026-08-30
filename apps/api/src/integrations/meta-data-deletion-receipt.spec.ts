import { describe, expect, it } from 'vitest';

import { MetaDataDeletionReceipt } from './meta-data-deletion-receipt.js';

describe('MetaDataDeletionReceipt', () => {
  it('creates a privacy-safe confirmation URL without exposing the provider account id', () => {
    const receipts = new MetaDataDeletionReceipt(
      'meta-app-secret-value',
      'https://autosale.example.com',
    );

    const result = receipts.create('17841400000000000');

    expect(result.confirmation_code).toMatch(/^[a-f0-9]{32}$/);
    expect(result.url).toBe(`https://autosale.example.com/privacy/data-deletion?code=${result.confirmation_code}`);
    expect(JSON.stringify(result)).not.toContain('17841400000000000');
  });

  it('returns the same receipt when Meta retries the same account request', () => {
    const receipts = new MetaDataDeletionReceipt(
      'meta-app-secret-value',
      'https://autosale.example.com/',
    );

    expect(receipts.create('account-a')).toEqual(receipts.create('account-a'));
    expect(receipts.create('account-a')).not.toEqual(receipts.create('account-b'));
  });
});
