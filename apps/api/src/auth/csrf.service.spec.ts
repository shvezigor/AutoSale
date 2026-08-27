import { describe, expect, it } from 'vitest';

import { CsrfService } from './csrf.service.js';

describe('CsrfService', () => {
  it('binds a token to one authenticated session', () => {
    const csrf = new CsrfService('c'.repeat(32));
    const token = csrf.issue('session-a');
    expect(csrf.verify('session-a', token)).toBe(true);
    expect(csrf.verify('session-b', token)).toBe(false);
    expect(csrf.verify('session-a', `${token}x`)).toBe(false);
  });
});
