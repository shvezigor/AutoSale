import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LoadingButton } from './loading-button';

describe('LoadingButton', () => {
  it('announces and blocks a pending action', () => {
    render(<LoadingButton pending pendingLabel="Перевіряємо…">Перевірити</LoadingButton>);
    expect(screen.getByRole('button', { name: 'Перевіряємо…' })).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});
