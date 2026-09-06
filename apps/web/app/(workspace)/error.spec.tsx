import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkspaceError from './error';

afterEach(cleanup);

describe('WorkspaceError', () => {
  it('shows safe recovery UI and retries the failed route', () => {
    const reset = vi.fn();

    render(<WorkspaceError error={new Error('private backend details')} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторити' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося завантажити розділ');
    expect(screen.queryByText('private backend details')).not.toBeInTheDocument();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
