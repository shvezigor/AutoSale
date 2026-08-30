import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TermsPage from './page';

describe('TermsPage', () => {
  it('states the service scope and customer responsibility for connected systems', () => {
    render(<TermsPage />);

    expect(screen.getByRole('heading', { name: 'Умови використання AutoSale' })).toBeInTheDocument();
    expect(screen.getByText(/автоматизації обробки замовлень/)).toBeInTheDocument();
    expect(screen.getByText(/відповідає за законність обробки даних своїх клієнтів/)).toBeInTheDocument();
  });
});
