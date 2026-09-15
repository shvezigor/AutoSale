import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import CatalogueError from './error';
import { I18nProvider } from '../../../src/i18n/i18n-provider';

afterEach(cleanup);

describe('CatalogueError', () => {
  it('shows safe recovery copy and retries without exposing backend details', () => {
    const reset = vi.fn();

    render(<CatalogueError error={new Error('tenant=abc raw stack trace from upstream')} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Не вдалося завантажити каталог' })).toBeInTheDocument();
    expect(screen.getByText('Перевірте з’єднання та спробуйте ще раз.')).toBeInTheDocument();
    expect(screen.queryByText(/tenant=abc/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторити' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('shows English recovery copy when English is selected', () => {
    render(<I18nProvider locale="en" authenticated><CatalogueError error={new Error('private upstream detail')} reset={vi.fn()} /></I18nProvider>);

    expect(screen.getByRole('heading', { name: 'Could not load catalogue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/private upstream detail/i)).not.toBeInTheDocument();
  });
});
