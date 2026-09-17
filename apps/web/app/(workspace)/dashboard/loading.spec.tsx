import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DashboardLoading from './loading';

describe('DashboardLoading', () => {
  afterEach(cleanup);

  it('preserves the dashboard structure without presenting fake values', () => {
    const { container } = render(<DashboardLoading />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Завантаження…')).toHaveClass('sr-only');
    expect(container.querySelectorAll('[data-dashboard-skeleton="metric"]')).toHaveLength(4);
    expect(container).not.toHaveTextContent(/₴|%|замовлен/i);
  });
});
