import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DataDeletionPage from './page';

describe('DataDeletionPage', () => {
  it('shows a safe receipt without claiming that the whole AutoSale account was deleted', async () => {
    render(await DataDeletionPage({
      searchParams: Promise.resolve({ code: 'abc123' }),
    }));

    expect(screen.getByRole('heading', { name: 'Запит на видалення даних прийнято' })).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByText(/Instagram-підключення від’єднано/)).toBeInTheDocument();
    expect(screen.queryByText(/обліковий запис AutoSale видалено/)).not.toBeInTheDocument();
  });
});
