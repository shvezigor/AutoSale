import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { LoadingButton } from './loading-button';

afterEach(cleanup);

describe('LoadingButton', () => {
  it('uses a pointer cursor while the action is available', () => {
    render(<LoadingButton>Підключити Нову Пошту</LoadingButton>);

    expect(screen.getByRole('button', { name: 'Підключити Нову Пошту' })).toBeEnabled();
    const stylesheet = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    expect(stylesheet).toMatch(/\.loading-button:not\(:disabled\)\s*\{[^}]*cursor:\s*pointer/);
  });

  it('announces and blocks a pending action', () => {
    render(<LoadingButton pending pendingLabel="Перевіряємо…">Перевірити</LoadingButton>);
    expect(screen.getByRole('button', { name: 'Перевіряємо…' })).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Перевірити')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Перевіряємо…').closest('.loading-button-pending')).not.toHaveAttribute('aria-hidden');
  });
});
