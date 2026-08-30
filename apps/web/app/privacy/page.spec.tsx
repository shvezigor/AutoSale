import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PrivacyPage from './page';

describe('PrivacyPage', () => {
  it('describes the Instagram data flow and provides deletion instructions', () => {
    render(<PrivacyPage />);

    expect(screen.getByRole('heading', { name: 'Політика конфіденційності AutoSale' })).toBeInTheDocument();
    expect(screen.getByText(/повідомлення та вкладення з підключеного Instagram/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Запит на видалення даних' })).toHaveAttribute('href', '/privacy/data-deletion');
    expect(screen.getByText('shvezigor@gmail.com')).toBeInTheDocument();
  });
});
