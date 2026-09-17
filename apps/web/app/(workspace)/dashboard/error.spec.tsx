import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DashboardError from './error';

describe('DashboardError', () => {
  afterEach(cleanup);

  it('explains the failure without exposing technical details and retries', () => {
    const reset = vi.fn();
    render(<DashboardError error={new Error('secret upstream failure')} reset={reset} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося завантажити дашборд');
    expect(screen.queryByText(/secret upstream/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторити' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
