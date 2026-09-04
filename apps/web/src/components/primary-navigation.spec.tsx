import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrimaryNavigation } from './primary-navigation';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PrimaryNavigation', () => {
  it('shows settings but hides team management from managers', () => {
    render(<PrimaryNavigation active="orders" session={{ name: 'Іван', email: 'manager@example.com', membershipRole: 'MANAGER' }} />);
    expect(screen.queryByRole('link', { name: 'Команда' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Каталог' })).toHaveAttribute('href', '/catalogue');
  });

  it('leaves profile actions to the application header', () => {
    render(<PrimaryNavigation active="conversations" session={{ name: 'Олена', email: 'owner@example.com', membershipRole: 'OWNER' }} />);
    expect(screen.queryByRole('button', { name: 'Вийти' })).not.toBeInTheDocument();
    expect(screen.queryByText('Власник')).not.toBeInTheDocument();
  });
});
