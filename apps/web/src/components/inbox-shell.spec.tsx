import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { InboxShell } from './inbox-shell';

afterEach(cleanup);

describe('InboxShell', () => {
  it('renders inbox content without nesting the global navigation', () => {
    render(<InboxShell conversations={[]}><div>Порожній діалог</div></InboxShell>);

    expect(screen.getByRole('heading', { name: 'Діалоги' })).toBeInTheDocument();
    expect(screen.getByText('Порожній діалог')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AutoSale' })).not.toBeInTheDocument();
  });
});
