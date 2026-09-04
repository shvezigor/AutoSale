import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RouteSkeleton } from './route-skeleton';

afterEach(cleanup);

describe('RouteSkeleton', () => {
  it.each(['table', 'settings', 'conversation', 'detail'] as const)('renders a non-interactive %s loading state', (variant) => {
    const { container } = render(<RouteSkeleton variant={variant} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Завантажуємо дані…')).toHaveClass('sr-only');
    expect(container.querySelectorAll('button, a, input')).toHaveLength(0);
    expect(container.querySelector(`[data-variant="${variant}"]`)).toBeInTheDocument();
  });
});
