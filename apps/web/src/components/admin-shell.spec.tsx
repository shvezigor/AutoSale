import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminShell } from './admin-shell';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/tenants',
  useRouter: () => ({ refresh }),
}));

afterEach(cleanup);

describe('AdminShell', () => {
  it('renders separate platform navigation and marks the active route', () => {
    render(<AdminShell session={{ name: 'Fictional Admin', email: 'admin@example.test' }}><p>Content</p></AdminShell>);

    expect(screen.getByRole('link', { name: 'Огляд' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Клієнти' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Операції' })).toHaveAttribute('href', '/admin/operations');
    expect(screen.queryByRole('link', { name: /діалоги|замовлення/i })).not.toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('opens and closes the mobile navigation drawer', () => {
    render(<AdminShell session={{ name: 'Fictional Admin', email: 'admin@example.test' }}><p>Content</p></AdminShell>);

    fireEvent.click(screen.getByRole('button', { name: 'Відкрити меню' }));
    expect(screen.getByRole('dialog', { name: 'Навігація адміністратора' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрити меню' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
