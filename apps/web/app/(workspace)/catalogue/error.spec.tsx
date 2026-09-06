import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CatalogueError from './error';

afterEach(cleanup);

describe('CatalogueError', () => {
  it('shows safe recovery copy and retries without exposing backend details', () => {
    const reset = vi.fn();

    render(<CatalogueError error={new Error('tenant=abc raw stack trace from upstream')} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Не вдалося завантажити каталог' })).toBeInTheDocument();
    expect(screen.getByText('Перевірте з’єднання та спробуйте ще раз.')).toBeInTheDocument();
    expect(screen.queryByText(/tenant=abc/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторити' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
