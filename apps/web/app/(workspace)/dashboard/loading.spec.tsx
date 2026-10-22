import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DashboardLoading from './loading';

describe('DashboardLoading', () => {
  afterEach(cleanup);

  it('preserves the dashboard structure without presenting fake values', () => {
    const { container } = render(<DashboardLoading />);
    expect(screen.getByRole('heading', { name: 'Операційний огляд' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Завантажуємо показники…');
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-dashboard-skeleton="metric"]')).toHaveLength(4);
    expect(container).not.toHaveTextContent(/₴|%|замовлен/i);
  });
});
