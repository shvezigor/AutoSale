import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import WorkspaceTemplate from './template';

afterEach(cleanup);

describe('WorkspaceTemplate', () => {
  it('wraps only changing route content in the transition boundary', () => {
    render(<WorkspaceTemplate><h1>Каталог</h1></WorkspaceTemplate>);

    expect(screen.getByRole('heading', { name: 'Каталог' }).parentElement).toHaveClass('workspace-route-transition');
    expect(screen.queryByRole('link', { name: 'AutoSale' })).not.toBeInTheDocument();
  });
});
