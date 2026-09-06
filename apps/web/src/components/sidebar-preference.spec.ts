import { afterEach, describe, expect, it } from 'vitest';

import { SIDEBAR_PREFERENCE_SCRIPT } from './sidebar-preference';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.sidebarState;
});

describe('sidebar preference bootstrap', () => {
  it('applies only a valid collapsed preference before the application renders', () => {
    localStorage.setItem('autosale.sidebar', 'collapsed');

    window.eval(SIDEBAR_PREFERENCE_SCRIPT);

    expect(document.documentElement).toHaveAttribute('data-sidebar-state', 'collapsed');
  });

  it('falls back to expanded for an unknown value', () => {
    localStorage.setItem('autosale.sidebar', 'broken-value');

    window.eval(SIDEBAR_PREFERENCE_SCRIPT);

    expect(document.documentElement).toHaveAttribute('data-sidebar-state', 'expanded');
  });
});
