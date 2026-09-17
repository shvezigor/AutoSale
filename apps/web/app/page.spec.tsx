import { describe, expect, it, vi } from 'vitest';

import HomePage from './page';

const redirect = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_REDIRECT'); }));
vi.mock('next/navigation', () => ({ redirect }));

describe('HomePage', () => {
  it('redirects the public root to the Ukrainian marketing page', () => {
    expect(() => HomePage()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/uk');
  });
});
