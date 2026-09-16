import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/auth/session', () => ({
  getServerSession: vi.fn().mockResolvedValue({ locale: 'uk' }),
}));

import DashboardPage from './page';

describe('DashboardPage', () => {
  it('presents the reference dashboard as an explicitly demo-backed overview', async () => {
    render(await DashboardPage());

    expect(screen.getByRole('heading', { name: 'Огляд роботи' })).toBeInTheDocument();
    expect(screen.getByText('Демонстраційні дані')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити чергу' })).toHaveAttribute(
      'href',
      '/orders?status=NEEDS_REVIEW',
    );
    expect(screen.getByRole('heading', { name: 'Виторг по місяцях' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Джерела замовлень' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Черга на перевірку' })).toBeInTheDocument();
  });
});
